import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { complete, estimateCost, estimateMessages, LlmError, type ChatMessage, type ToolCall, type Usage } from '@lumen/llm';
import { LumenError, type ChatStreamEvent, type ErrorCode } from '@lumen/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/client.js';
import { compactions, conversations, messages, usageEvents, type MessagePart, type MessageRow, type UserRow } from '../../db/schema/index.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import type { EventBus } from '../../lib/realtime/event-bus.js';
import type { StreamHub } from '../../lib/realtime/stream-hub.js';
import type { EntitlementService } from '../entitlements/entitlements.service.js';
import type { ModelCatalogService, ResolvedModel } from '../models/catalog.service.js';
import type { ProviderService } from '../providers/provider.service.js';
import type { ToolRegistry } from '../tools/registry.js';
import { toChatMessages } from './prompt.js';

const MAX_TOOL_ROUNDS = 8;
const FLUSH_MS = 1500;

export interface GenerationJob {
  user: UserRow;
  conversationId: string;
  incognito: boolean;
  assistant: MessageRow;
  /** Branch ending in the user message being answered. */
  path: MessageRow[];
  model: ResolvedModel;
  systemPrompt: string;
  thinking: 'off' | 'low' | 'medium' | 'high' | undefined;
  temperature: number | undefined;
  toolNames: string[];
  /** Project of the conversation (memory tool scope). */
  projectId?: string | null;
  /** Memories injected into this turn's system prompt (shown as "Memory used"). */
  memoryIds?: string[];
  /** Attachment/knowledge context computed for this turn. */
  files?: { citations: import('../files/context.js').Citation[]; images: import('@lumen/llm').ContentPart[]; scope: { fileIds: string[]; projectId: string | null } | null };
  onFinished?: (ok: boolean) => Promise<void> | void;
}

export interface GenerationDeps {
  db: Database;
  hub: StreamHub;
  bus: EventBus;
  providers: ProviderService;
  catalog: ModelCatalogService;
  entitlements: EntitlementService;
  tools: ToolRegistry;
  rateLimiter: RateLimiter;
  log: Logger;
  now: () => Date;
}

/** Map provider errors onto stable API error codes and decide whether to try a fallback model. */
export function classifyError(err: unknown): { code: ErrorCode; message: string; retryable: boolean; resetAt?: string } {
  if (err instanceof LumenError) return { code: err.code, message: err.message, retryable: err.code === 'PROVIDER_UNAVAILABLE', resetAt: err.resetAt };
  if (err instanceof LlmError) {
    const resetAt = err.retryAfterMs ? new Date(Date.now() + err.retryAfterMs).toISOString() : undefined;
    switch (err.kind) {
      case 'rate_limit':
        return { code: 'RATE_LIMITED', message: 'The model provider is rate limiting requests. Try again shortly or pick another model.', retryable: true, resetAt };
      case 'content_filter':
        return { code: 'CONTENT_BLOCKED', message: 'The provider blocked this request or response.', retryable: false };
      case 'overloaded':
      case 'server':
      case 'network':
      case 'timeout':
        return { code: 'PROVIDER_UNAVAILABLE', message: 'The model provider is having trouble right now.', retryable: true };
      case 'quota':
        return { code: 'PROVIDER_ERROR', message: 'The model provider’s quota for this instance is exhausted.', retryable: true };
      default:
        return { code: 'PROVIDER_ERROR', message: `The model provider returned an error: ${err.message}`, retryable: false };
    }
  }
  if ((err as Error)?.name === 'AbortError') return { code: 'INTERNAL', message: 'Cancelled', retryable: false };
  return { code: 'INTERNAL', message: 'Something went wrong while generating a response.', retryable: false };
}

export class GenerationRunner {
  private readonly active = new Map<string, { controller: AbortController; userId: string }>();

  constructor(private readonly d: GenerationDeps) {}

  isActive(messageId: string) {
    return this.active.has(messageId);
  }

  cancel(userId: string, messageId: string): boolean {
    const a = this.active.get(messageId);
    if (!a || a.userId !== userId) return false;
    a.controller.abort();
    return true;
  }

  /** Candidate models: the chosen one followed by its admin-configured fallback chain. */
  private async candidates(job: GenerationJob): Promise<ResolvedModel[]> {
    const out = [job.model];
    for (const id of job.model.model.fallbackModelIds) {
      try {
        out.push(await this.d.catalog.resolve(id, job.user));
      } catch {
        /* unavailable fallback: skip */
      }
    }
    return out;
  }

  private async checkModelLimits(m: ResolvedModel) {
    if (m.model.rpmLimit) {
      const r = await this.d.rateLimiter.hit(`model-rpm:${m.model.id}`, m.model.rpmLimit, 60_000);
      if (!r.allowed) throw new LumenError('PROVIDER_UNAVAILABLE', `${m.model.displayName} is busy. Try again in a minute or pick another model.`);
    }
    if (m.model.dailyTokenCap) {
      const start = new Date(Date.UTC(this.d.now().getUTCFullYear(), this.d.now().getUTCMonth(), this.d.now().getUTCDate()));
      const [row] = await this.d.db
        .select({ n: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)::int` })
        .from(usageEvents)
        .where(and(eq(usageEvents.modelId, m.model.id), gte(usageEvents.createdAt, start)));
      if ((row?.n ?? 0) >= m.model.dailyTokenCap) throw new LumenError('PROVIDER_UNAVAILABLE', `${m.model.displayName} reached its daily limit on this instance.`);
    }
  }

  /** Summarize older turns when the branch no longer fits the model's context window. */
  private async maybeCompact(job: GenerationJob, publish: (e: ChatStreamEvent) => Promise<void>): Promise<{ throughMessageId: string; summary: string } | null> {
    const ids = job.path.map((m) => m.id);
    const existing = (await this.d.db.select().from(compactions).where(eq(compactions.conversationId, job.conversationId)))
      .filter((c) => ids.includes(c.throughMessageId))
      .sort((a, b) => ids.indexOf(b.throughMessageId) - ids.indexOf(a.throughMessageId))[0];
    let current = existing ? { throughMessageId: existing.throughMessageId, summary: existing.summary } : null;
    const budget = Math.max(1024, job.model.model.contextWindow - job.model.model.maxOutputTokens - 512);
    const measure = (c: typeof current) => estimateMessages([{ role: 'system', content: job.systemPrompt }, ...toChatMessages(job.path, c)]);
    const before = measure(current);
    if (before <= budget) return current;
    // Keep the newest ~40% of the budget verbatim; summarize everything before it.
    let keepFrom = job.path.length - 1;
    let kept = 0;
    while (keepFrom > 0 && kept + estimateMessages(toChatMessages([job.path[keepFrom]!], null)) < budget * 0.4) {
      kept += estimateMessages(toChatMessages([job.path[keepFrom]!], null));
      keepFrom--;
    }
    const through = job.path[Math.max(0, keepFrom - 1)];
    if (!through || through.id === job.path[job.path.length - 1]!.id) return current;
    const older = toChatMessages(job.path.slice(0, job.path.indexOf(through) + 1), current);
    const transcript = older.map((m) => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : ''}`).join('\n\n').slice(-120_000);
    const runtime = await this.d.providers.runtime(job.model.provider.id);
    const res = await complete(runtime.adapter, {
      model: job.model.model.providerModelId,
      maxTokens: 1500,
      messages: [
        { role: 'system', content: 'Summarize the conversation so far for your own future reference. Keep facts, decisions, open questions, code identifiers and user preferences. Be concise but complete.' },
        { role: 'user', content: transcript },
      ],
    });
    // Cap the summary so compaction always frees room, even if the model is verbose.
    const maxChars = Math.floor(budget * 0.3) * 4;
    let summary = res.text.trim() || '(empty summary)';
    if (summary.length > maxChars) summary = `${summary.slice(0, maxChars)}…`;
    const candidate = { throughMessageId: through.id, summary };
    const after = measure(candidate);
    await this.recordUsage(job, job.model, runtime.keyId, res.usage, 'compaction', 0, null, 'ok');
    if (after >= before) return current;
    current = candidate;
    await this.d.db.insert(compactions).values({ conversationId: job.conversationId, throughMessageId: through.id, summary: current.summary, tokensBefore: before, tokensAfter: after });
    await publish({ type: 'compacted', tokensBefore: before, tokensAfter: after });
    return current;
  }

  private async recordUsage(job: GenerationJob, m: ResolvedModel, keyId: string | null, usage: Usage, source: string, latencyMs: number, firstTokenMs: number | null, status: string, errorCode?: string) {
    const costUsd = estimateCost(usage, m.model.pricing);
    await this.d.db.insert(usageEvents).values({
      userId: job.user.id,
      source,
      conversationId: job.incognito ? null : job.conversationId,
      messageId: job.assistant.id,
      modelId: m.model.id,
      providerId: m.provider.id,
      providerKeyId: keyId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      latencyMs,
      firstTokenMs,
      status,
      errorCode: errorCode ?? null,
    });
    if (usage.inputTokens + usage.outputTokens > 0) await this.d.entitlements.add(job.user.id, 'tokens', usage.inputTokens + usage.outputTokens);
    return costUsd;
  }

  /** Runs to completion even if every client disconnects; clients re-attach through the stream hub. */
  async run(job: GenerationJob): Promise<void> {
    const controller = new AbortController();
    this.active.set(job.assistant.id, { controller, userId: job.user.id });
    const streamId = job.assistant.id;
    const publish = async (e: ChatStreamEvent) => {
      await this.d.hub.publish(streamId, e);
    };
    const started = this.d.now().getTime();
    let content = '';
    const parts: MessagePart[] = [];
    let reasoning = '';
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let used: ResolvedModel = job.model;
    let firstTokenMs: number | null = null;
    let finishReason = 'stop';
    let status: MessageRow['status'] = 'complete';
    let error: MessageRow['error'] = null;
    let lastFlush = Date.now();

    const flush = async (final = false) => {
      const allParts = reasoning ? [{ type: 'reasoning' as const, text: reasoning }, ...parts] : parts;
      await this.d.db
        .update(messages)
        .set({ content, parts: allParts, updatedAt: this.d.now(), ...(final ? { status, error, usage: { ...usage, latencyMs: this.d.now().getTime() - started, firstTokenMs: firstTokenMs ?? undefined }, modelId: used.model.id, modelName: used.model.displayName } : {}) })
        .where(eq(messages.id, job.assistant.id));
      lastFlush = Date.now();
    };

    try {
      await publish({ type: 'start', messageId: job.assistant.id, model: { id: job.model.model.id, name: job.model.model.displayName } });
      const compaction = await this.maybeCompact(job, publish);
      const history: ChatMessage[] = [{ role: 'system', content: job.systemPrompt }, ...toChatMessages(job.path, compaction)];
      // Images attached to the newest user message go to vision models as content parts.
      const lastUser = [...history].reverse().find((m) => m.role === 'user');
      if (lastUser && job.files?.images.length) lastUser.content = [{ type: 'text', text: typeof lastUser.content === 'string' ? lastUser.content : '' }, ...job.files.images];
      if (job.memoryIds?.length) {
        await publish({ type: 'memory', ids: job.memoryIds });
        parts.push({ type: 'memory', ids: job.memoryIds });
      }
      if (job.files?.citations.length) {
        await publish({ type: 'citations', items: job.files.citations });
        parts.push(...job.files.citations.map((c) => ({ type: 'citation' as const, ...c })));
      }
      const candidates = await this.candidates(job);
      let firstError: unknown = null;
      const toolDefs = job.toolNames.length && job.model.model.capabilities.tools ? this.d.tools.definitions(job.toolNames) : [];

      for (let ci = 0; ci < candidates.length; ci++) {
        const m = candidates[ci]!;
        used = m;
        let keyId: string | null = null;
        const attemptStart = this.d.now().getTime();
        try {
          await this.checkModelLimits(m);
          const runtime = await this.d.providers.runtime(m.provider.id);
          keyId = runtime.keyId;
          const convo = [...history];
          for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
            const calls: ToolCall[] = [];
            let roundText = '';
            let roundFinish = 'stop';
            const stream = runtime.adapter.stream(
              {
                model: m.model.providerModelId,
                messages: convo,
                ...(toolDefs.length ? { tools: toolDefs, toolChoice: round === MAX_TOOL_ROUNDS ? 'none' : 'auto' } : {}),
                ...(m.model.capabilities.reasoning && job.thinking ? { thinking: job.thinking } : {}),
                temperature: job.temperature ?? m.model.defaultParams.temperature,
                topP: m.model.defaultParams.topP,
                maxTokens: m.model.defaultParams.maxTokens ?? m.model.maxOutputTokens,
                user: job.user.id,
              },
              controller.signal,
            );
            for await (const ev of stream) {
              if (ev.type === 'text-delta') {
                firstTokenMs ??= this.d.now().getTime() - started;
                content += ev.text;
                roundText += ev.text;
                await publish({ type: 'text', text: ev.text });
              } else if (ev.type === 'reasoning-delta') {
                firstTokenMs ??= this.d.now().getTime() - started;
                reasoning += ev.text;
                await publish({ type: 'reasoning', text: ev.text });
              } else if (ev.type === 'tool-call') calls.push(ev.call);
              else if (ev.type === 'usage') usage = { inputTokens: usage.inputTokens + ev.usage.inputTokens, outputTokens: usage.outputTokens + ev.usage.outputTokens };
              else if (ev.type === 'finish') roundFinish = ev.reason;
              if (Date.now() - lastFlush > FLUSH_MS) await flush();
            }
            finishReason = roundFinish;
            if (roundFinish === 'content_filter') throw new LlmError('content_filter', 'Blocked by provider');
            if (!calls.length || round === MAX_TOOL_ROUNDS) {
              if (parts.some((p) => p.type === 'tool_call')) parts.push({ type: 'text_segment', round, text: roundText });
              break;
            }
            if (roundText) parts.push({ type: 'text_segment', round, text: roundText });
            convo.push({ role: 'assistant', content: roundText, toolCalls: calls });
            for (const call of calls) {
              parts.push({ type: 'tool_call', round, id: call.id, name: call.name, arguments: call.arguments });
              await publish({ type: 'tool_call', id: call.id, name: call.name, arguments: call.arguments });
              const r = await this.d.tools.execute(call.name, call.arguments, { user: job.user, conversationId: job.conversationId, signal: controller.signal, fileScope: job.files?.scope ?? undefined, projectId: job.projectId ?? null, messageId: job.assistant.id, emit: publish });
              parts.push({ type: 'tool_result', round, id: call.id, name: call.name, content: r.content, isError: r.isError });
              await publish({ type: 'tool_result', id: call.id, name: call.name, content: r.content, isError: r.isError });
              convo.push({ role: 'tool', toolCallId: call.id, name: call.name, content: r.content, isError: r.isError });
            }
            await flush();
          }
          const cost = await this.recordUsage(job, m, keyId, usage, 'chat', this.d.now().getTime() - attemptStart, firstTokenMs, 'ok');
          await this.d.providers.reportSuccess(m.provider.id, keyId, cost);
          break;
        } catch (err) {
          if (controller.signal.aborted) throw err;
          const cls = classifyError(err);
          await this.d.providers.reportFailure(m.provider.id, keyId, err);
          await this.recordUsage(job, m, keyId, usage, 'chat', this.d.now().getTime() - attemptStart, firstTokenMs, 'error', cls.code).catch(() => undefined);
          const next = candidates[ci + 1];
          firstError ??= err;
          // Only fall back if nothing was streamed yet, otherwise the user would see two different answers.
          if (cls.retryable && next && !content && !parts.some((p) => p.type === 'tool_call')) {
            await publish({ type: 'fallback', from: m.model.displayName, to: next.model.displayName, reason: cls.message });
            continue;
          }
          // If a fallback merely found its pool unavailable, the original failure is the useful one to show.
          throw cls.code === 'PROVIDER_UNAVAILABLE' && err instanceof LumenError && firstError !== err ? firstError : err;
        }
      }
      status = 'complete';
    } catch (err) {
      if (controller.signal.aborted) {
        status = 'cancelled';
        finishReason = 'cancelled';
      } else {
        const cls = classifyError(err);
        status = 'error';
        error = { code: cls.code, message: cls.message, ...(cls.resetAt ? { resetAt: cls.resetAt } : {}) };
        if (cls.code === 'INTERNAL') this.d.log.error({ err: (err as Error).message, stack: (err as Error).stack }, 'generation failed');
      }
    } finally {
      try {
        await flush(true);
        await this.d.db.update(conversations).set({ lastMessageAt: this.d.now(), updatedAt: this.d.now() }).where(eq(conversations.id, job.conversationId));
        const ctx = estimateMessages([{ role: 'system', content: job.systemPrompt }, ...toChatMessages(job.path, null)]) + usage.outputTokens;
        await publish({ type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, contextTokens: ctx, contextWindow: used.model.contextWindow });
        if (status === 'error' && error) await publish({ type: 'error', code: error.code, message: error.message, resetAt: error.resetAt, retryable: classifyError(new LumenError(error.code as ErrorCode)).retryable || error.code === 'RATE_LIMITED' });
        else await publish({ type: 'done', status: status === 'cancelled' ? 'cancelled' : 'complete', finishReason });
      } finally {
        await this.d.hub.end(streamId);
        this.active.delete(job.assistant.id);
        if (!job.incognito) await this.d.bus.publish(job.user.id, { type: 'stream.finished', conversationId: job.conversationId, messageId: job.assistant.id });
        await job.onFinished?.(status === 'complete');
      }
    }
  }

  /** Mark generations orphaned by a crashed/restarted server (no heartbeat for 2 minutes) as interrupted. */
  async recoverStale(): Promise<number> {
    const cutoff = new Date(this.d.now().getTime() - 2 * 60_000);
    const res = await this.d.db
      .update(messages)
      .set({ status: 'error', error: { code: 'PROVIDER_UNAVAILABLE', message: 'The response was interrupted. Regenerate to try again.' } })
      .where(and(eq(messages.status, 'streaming'), lt(messages.updatedAt, cutoff)))
      .returning({ id: messages.id });
    return res.length;
  }
}
