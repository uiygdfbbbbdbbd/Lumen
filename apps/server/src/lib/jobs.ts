import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Logger } from 'pino';

export type JobHandler<T = unknown> = (data: T, attempt: number) => Promise<void>;

export interface EnqueueOptions {
  /** Same id = same job (idempotency): enqueueing twice runs once. */
  jobId?: string;
  attempts?: number;
  delayMs?: number;
}

export interface JobQueue {
  register<T>(name: string, handler: JobHandler<T>, opts?: { concurrency?: number }): void;
  enqueue<T>(name: string, data: T, opts?: EnqueueOptions): Promise<void>;
  /** Resolve when nothing is queued or running (tests, graceful shutdown). */
  drain(): Promise<void>;
  close(): Promise<void>;
}

/**
 * In-process queue for single-node installs and tests. Exponential backoff retries; jobs with the same
 * jobId are de-duplicated while pending.
 */
export class MemoryJobQueue implements JobQueue {
  private readonly handlers = new Map<string, { fn: JobHandler; concurrency: number; running: number }>();
  private readonly pending: { name: string; data: unknown; attempt: number; attempts: number; jobId?: string; runAt: number }[] = [];
  private readonly ids = new Set<string>();
  private idleWaiters: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly log?: Logger, private readonly baseBackoffMs = 500) {}

  register<T>(name: string, handler: JobHandler<T>, opts: { concurrency?: number } = {}) {
    this.handlers.set(name, { fn: handler as JobHandler, concurrency: opts.concurrency ?? 2, running: 0 });
  }

  async enqueue<T>(name: string, data: T, opts: EnqueueOptions = {}) {
    if (opts.jobId) {
      if (this.ids.has(opts.jobId)) return;
      this.ids.add(opts.jobId);
    }
    this.pending.push({ name, data, attempt: 1, attempts: opts.attempts ?? 3, jobId: opts.jobId, runAt: Date.now() + (opts.delayMs ?? 0) });
    this.pump();
  }

  private busy() {
    return this.pending.length > 0 || [...this.handlers.values()].some((h) => h.running > 0);
  }

  private pump() {
    if (this.closed) return;
    const now = Date.now();
    for (let i = 0; i < this.pending.length; i++) {
      const job = this.pending[i]!;
      const h = this.handlers.get(job.name);
      if (!h || h.running >= h.concurrency || job.runAt > now) continue;
      this.pending.splice(i--, 1);
      h.running++;
      void h
        .fn(job.data, job.attempt)
        .then(() => {
          if (job.jobId) this.ids.delete(job.jobId);
        })
        .catch((err: Error) => {
          if (job.attempt < job.attempts) {
            this.pending.push({ ...job, attempt: job.attempt + 1, runAt: Date.now() + this.baseBackoffMs * 2 ** (job.attempt - 1) });
          } else {
            if (job.jobId) this.ids.delete(job.jobId);
            this.log?.error({ job: job.name, err: err.message }, 'job failed permanently');
          }
        })
        .finally(() => {
          h.running--;
          this.pump();
          if (!this.busy()) {
            const w = this.idleWaiters;
            this.idleWaiters = [];
            w.forEach((r) => r());
          }
        });
    }
    const next = this.pending.reduce((min, j) => Math.min(min, j.runAt), Infinity);
    if (this.timer) clearTimeout(this.timer);
    if (Number.isFinite(next)) this.timer = setTimeout(() => this.pump(), Math.max(5, next - Date.now()));
  }

  drain(): Promise<void> {
    if (!this.busy()) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  async close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

/** BullMQ-backed queue: durable, multi-instance. Workers run here when `runWorkers` is true (else in apps/worker). */
export class BullJobQueue implements JobQueue {
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(
    private readonly connection: ConnectionOptions,
    private readonly runWorkers: boolean,
    private readonly log?: Logger,
    private readonly prefix = 'lumen',
  ) {}

  private queue(name: string) {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, prefix: this.prefix });
      this.queues.set(name, q);
    }
    return q;
  }

  register<T>(name: string, handler: JobHandler<T>, opts: { concurrency?: number } = {}) {
    if (!this.runWorkers) return;
    const w = new Worker(name, async (job) => handler(job.data as T, job.attemptsMade + 1), { connection: this.connection, prefix: this.prefix, concurrency: opts.concurrency ?? 2 });
    w.on('failed', (job, err) => this.log?.warn({ job: name, id: job?.id, err: err.message }, 'job attempt failed'));
    this.workers.push(w);
  }

  async enqueue<T>(name: string, data: T, opts: EnqueueOptions = {}) {
    await this.queue(name).add(name, data, {
      jobId: opts.jobId,
      attempts: opts.attempts ?? 3,
      delay: opts.delayMs,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async drain() {
    for (const q of this.queues.values()) {
      for (;;) {
        const counts = await q.getJobCounts('waiting', 'active', 'delayed');
        if (!counts.waiting && !counts.active && !counts.delayed) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
