import type { Redis } from 'ioredis';
import type { ChatStreamEvent } from '@lumen/shared';

export interface SeqEvent {
  seq: number;
  event: ChatStreamEvent;
}

/**
 * Buffers every event of a generation so clients can (re)connect at any point and replay from a
 * sequence number (SSE Last-Event-ID). Generation keeps running if all clients disconnect.
 */
export interface StreamHub {
  publish(streamId: string, event: ChatStreamEvent): Promise<number>;
  /** Replays events after `afterSeq`, then delivers live ones until the stream ends. Returns unsubscribe. */
  subscribe(streamId: string, afterSeq: number, onEvent: (e: SeqEvent) => void, onEnd: () => void): Promise<() => void>;
  end(streamId: string): Promise<void>;
  exists(streamId: string): Promise<boolean>;
}

const isTerminal = (e: ChatStreamEvent) => e.type === 'done' || e.type === 'error';

interface MemStream {
  events: SeqEvent[];
  ended: boolean;
  listeners: Set<{ onEvent: (e: SeqEvent) => void; onEnd: () => void }>;
  endedAt: number | null;
}

export class MemoryStreamHub implements StreamHub {
  private readonly streams = new Map<string, MemStream>();
  constructor(private readonly retainMs = 10 * 60_000) {}

  private get(id: string): MemStream {
    let s = this.streams.get(id);
    if (!s) {
      s = { events: [], ended: false, listeners: new Set(), endedAt: null };
      this.streams.set(id, s);
    }
    return s;
  }

  async publish(id: string, event: ChatStreamEvent): Promise<number> {
    const s = this.get(id);
    const seq = s.events.length + 1;
    const e = { seq, event };
    s.events.push(e);
    for (const l of s.listeners) l.onEvent(e);
    return seq;
  }

  async subscribe(id: string, afterSeq: number, onEvent: (e: SeqEvent) => void, onEnd: () => void) {
    const s = this.get(id);
    for (const e of s.events) if (e.seq > afterSeq) onEvent(e);
    if (s.ended) {
      onEnd();
      return () => {};
    }
    const l = { onEvent, onEnd };
    s.listeners.add(l);
    return () => s.listeners.delete(l);
  }

  async end(id: string) {
    const s = this.get(id);
    s.ended = true;
    s.endedAt = Date.now();
    for (const l of s.listeners) l.onEnd();
    s.listeners.clear();
    this.sweep();
  }

  async exists(id: string) {
    return this.streams.has(id);
  }

  private sweep() {
    const cutoff = Date.now() - this.retainMs;
    for (const [id, s] of this.streams) if (s.endedAt && s.endedAt < cutoff) this.streams.delete(id);
  }
}

/** Redis Streams implementation: works across server instances and survives client reconnects to another node. */
export class RedisStreamHub implements StreamHub {
  constructor(
    private readonly redis: Redis,
    private readonly createReader: () => Redis,
    private readonly retainSeconds = 600,
  ) {}

  private key(id: string) {
    return `lumen:stream:${id}`;
  }

  async publish(id: string, event: ChatStreamEvent): Promise<number> {
    const seq = await this.redis.incr(`${this.key(id)}:seq`);
    await this.redis.xadd(this.key(id), 'MAXLEN', '~', '20000', `${seq}-1`, 'e', JSON.stringify(event));
    await this.redis.expire(this.key(id), this.retainSeconds * 6);
    await this.redis.expire(`${this.key(id)}:seq`, this.retainSeconds * 6);
    return seq;
  }

  async subscribe(id: string, afterSeq: number, onEvent: (e: SeqEvent) => void, onEnd: () => void) {
    const reader = this.createReader();
    let stopped = false;
    let last = `${afterSeq}-1`;
    const loop = async () => {
      try {
        while (!stopped) {
          const res = (await reader.xread('BLOCK', 15_000, 'STREAMS', this.key(id), last)) as [string, [string, string[]][]][] | null;
          if (stopped) break;
          if (!res) {
            if (await this.redis.exists(`${this.key(id)}:ended`)) break;
            continue;
          }
          for (const [, entries] of res) {
            for (const [entryId, fields] of entries) {
              last = entryId;
              const event = JSON.parse(fields[1]!) as ChatStreamEvent;
              onEvent({ seq: Number(entryId.split('-')[0]), event });
              if (isTerminal(event)) stopped = true;
            }
          }
        }
      } finally {
        reader.disconnect();
        onEnd();
      }
    };
    void loop();
    return () => {
      stopped = true;
      reader.disconnect();
    };
  }

  async end(id: string) {
    await this.redis.set(`${this.key(id)}:ended`, '1', 'EX', this.retainSeconds);
    await this.redis.expire(this.key(id), this.retainSeconds);
  }

  async exists(id: string) {
    return (await this.redis.exists(this.key(id))) === 1;
  }
}
