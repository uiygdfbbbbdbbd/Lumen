import { and, eq, sql } from 'drizzle-orm';
import { complete } from '@lumen/llm';
import { LumenError, userPreferencesSchema, type Entitlements } from '@lumen/shared';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Database } from '../../db/client.js';
import { conversations, messages, styles, type ConversationRow, type MessageRow, type UserRow } from '../../db/schema/index.js';
import type { ConcurrencyLimiter } from '../../lib/realtime/concurrency.js';
import type { EventBus } from '../../lib/realtime/event-bus.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import type { EntitlementService } from '../entitlements/entitlements.service.js';
import type { ModelCatalogService, ResolvedModel } from '../models/catalog.service.js';
import type { ProviderService } from '../providers/provider.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { FileContextBuilder } from '../files/context.js';
import type { FileService } from '../files/file.service.js';
import type { ProjectService } from '../projects/project.service.js';
import { pathTo, serializeMessage, type ConversationService } from './conversation.service.js';
import type { GenerationRunner } from './generation.js';
import { buildSystemPrompt, builtinStyle } from './prompt.js';

export const DEFAULT_TOOLS = ['calculator', 'current_datetime'];

export interface ChatDeps {
  db: Database;
  conversations: ConversationService;
  catalog: ModelCatalogService;
  providers: ProviderService;
  entitlements: EntitlementService;
  settings: SettingsService;
  runner: GenerationRunner;
  concurrency: ConcurrencyLimiter;
  rateLimiter: RateLimiter;
  bus: EventBus;
  log: Logger;
  now: () => Date;
  files: FileService;
  fileContext: FileContextBuilder;
  projects: ProjectService;
}

type Thinking = 'off' | 'low' | 'medium' | 'high';

export class ChatService {
  constructor(private readonly d: ChatDeps) {}

  private prefs(user: UserRow) {
    const p = userPreferencesSchema.safeParse(user.preferences ?? {});
    return p.success ? p.data : {};
  }

  private async resolveModel(user: UserRow, conv: ConversationRow, requested?: string): Promise<ResolvedModel> {
    let projectModel: string | null = null;
    if (conv.projectId) projectModel = (await this.d.projects.require(user, conv.projectId, 'viewer').catch(() => null))?.project.defaultModelId ?? null;
    const ref = requested ?? conv.modelId ?? projectModel ?? this.prefs(user).defaultModel;
    if (ref && ref !== 'auto') return this.d.catalog.resolve(ref, user);
    const def = await this.d.catalog.defaultFor(user);
    if (!def) throw new LumenError('PROVIDER_UNAVAILABLE', 'No AI models are available yet. Ask an administrator to add a provider.');
    return def;
  }

  /** Daily message + token quotas, tokens-per-minute, and the concurrent stream cap. Returns a lease release fn. */
  private async admit(user: UserRow, ent: Entitlements, generations: number): Promise<() => Promise<void>> {
    if (!ent.features.chat.allowed) throw new LumenError('ACCOUNT_SUSPENDED', 'Chat is not available for your account.');
    const tokensUsed = await this.d.entitlements.usage(user.id, 'tokens');
    if (tokensUsed >= ent.limits.tokensPerDay) {
      const resetAt = new Date(Date.UTC(this.d.now().getUTCFullYear(), this.d.now().getUTCMonth(), this.d.now().getUTCDate() + 1)).toISOString();
      throw new LumenError('QUOTA_EXCEEDED', 'You’ve used today’s token allowance.', { resetAt, details: { metric: 'tokens', limit: ent.limits.tokensPerDay } });
    }
    // One slot per request: compare mode's 2-4 parallel answers count as a single "chat generating".
    const lease = await this.d.concurrency.acquire(`streams:${user.id}`, ent.limits.concurrentStreams);
    if (!lease) throw new LumenError('RATE_LIMITED', `You can have ${ent.limits.concurrentStreams} chat(s) generating at once. Wait for one to finish.`);
    try {
      await this.d.entitlements.consumeOrThrow(user, ent, 'messages', 'messagesPerDay', generations);
    } catch (e) {
      await lease();
      throw e;
    }
    return lease;
  }

  private async systemPrompt(user: UserRow, conv: ConversationRow, model: ResolvedModel, extra: { title: string; body: string }[] = []): Promise<string> {
    const branding = await this.d.settings.get('branding');
    const prefs = this.prefs(user);
    const project = conv.projectId ? (await this.d.projects.require(user, conv.projectId, 'viewer').catch(() => null))?.project : null;
    const styleId = conv.settings.styleId ?? project?.defaultStyleId ?? prefs.defaultStyle;
    let styleText = builtinStyle(styleId);
    if (!styleText && styleId && /^[0-9a-f-]{36}$/.test(styleId)) {
      const [s] = await this.d.db.select().from(styles).where(and(eq(styles.id, styleId), eq(styles.userId, user.id)));
      styleText = s?.instructions;
    }
    return buildSystemPrompt({
      productName: branding.productName,
      now: this.d.now(),
      timezone: user.timezone,
      modelPrefix: model.model.systemPromptPrefix,
      userInstructions: prefs.customInstructions,
      conversationInstructions: conv.instructions,
      styleInstructions: styleText,
      extraSections: [...(project?.instructions.trim() ? [{ title: `Project "${project.name}" instructions`, body: project.instructions.trim() }] : []), ...extra],
    });
  }

  /** Create assistant placeholders and start generations; returns immediately. */
  private async launch(user: UserRow, conv: ConversationRow, parent: MessageRow, models: ResolvedModel[], opts: { thinking?: Thinking; release: () => Promise<void> }) {
    const all = await this.d.conversations.messagesOf(conv.id);
    const ids = pathTo(all, parent.id);
    const byId = new Map(all.map((m) => [m.id, m]));
    const path = ids.map((id) => byId.get(id)!);
    const group = models.length > 1 ? randomUUID() : null;
    const created: MessageRow[] = [];
    for (const m of models) {
      const [a] = await this.d.db
        .insert(messages)
        .values({ conversationId: conv.id, parentId: parent.id, role: 'assistant', status: 'streaming', modelId: m.model.id, modelName: m.model.displayName, compareGroup: group, createdAt: this.d.now() })
        .returning();
      created.push(a!);
    }
    await this.d.db
      .update(conversations)
      .set({ activeLeafId: created[0]!.id, messageCount: sql`${conversations.messageCount} + ${created.length}`, lastMessageAt: this.d.now(), updatedAt: this.d.now() })
      .where(eq(conversations.id, conv.id));
    if (!conv.incognito) {
      await this.d.bus.publish(user.id, { type: 'conversation.upsert', conversationId: conv.id });
      for (const a of created) await this.d.bus.publish(user.id, { type: 'stream.started', conversationId: conv.id, messageId: a.id });
    }
    let remaining = created.length;
    const prefs = this.prefs(user);
    const query = parent.role === 'user' ? parent.content : '';
    for (const [i, a] of created.entries()) {
      const model = models[i]!;
      const fctx = await this.d.fileContext.build({ conversationId: conv.id, projectId: conv.projectId, latestUserMessageId: parent.id, query, vision: model.model.capabilities.vision, userId: user.id });
      void this.d.runner.run({
        user,
        conversationId: conv.id,
        incognito: conv.incognito,
        assistant: a,
        path,
        model,
        systemPrompt: await this.systemPrompt(user, conv, model, fctx.sections),
        files: { citations: fctx.citations, images: fctx.images, scope: fctx.offerSearch || conv.projectId ? { fileIds: fctx.fileIds, projectId: conv.projectId } : null },
        thinking: opts.thinking ?? conv.settings.thinkingEffort ?? prefs.thinkingEffort,
        temperature: conv.settings.temperature,
        toolNames: fctx.offerSearch || conv.projectId ? [...DEFAULT_TOOLS, 'file_search'] : DEFAULT_TOOLS,
        onFinished: async (ok) => {
          remaining -= 1;
          if (remaining === 0) await opts.release();
          if (ok && i === 0 && conv.titleSource === 'default' && prefs.autoTitle !== false && !conv.incognito) await this.autoTitle(user, conv.id, model).catch(() => undefined);
        },
      });
    }
    return created;
  }

  async send(user: UserRow, ent: Entitlements, conversationId: string, input: { content: string; parentId?: string | null; modelId?: string; compareModelIds?: string[]; thinkingEffort?: Thinking; attachments?: string[] }) {
    const conv = await this.d.conversations.get(user, conversationId);
    if (!input.content.trim() && !input.attachments?.length) throw new LumenError('VALIDATION_FAILED', 'Message is empty.');
    const attached = await this.d.files.byIds(user, [...new Set(input.attachments ?? [])]);
    const notReady = attached.find((f) => f.status !== 'ready');
    if (notReady) throw new LumenError('CONFLICT', notReady.status === 'failed' || notReady.status === 'quarantined' ? `“${notReady.name}” can’t be used: ${notReady.error ?? notReady.status}.` : `“${notReady.name}” is still processing. Try again in a moment.`);
    const refs = input.compareModelIds ?? [input.modelId];
    const models = await Promise.all(refs.map((r) => this.resolveModel(user, conv, r)));
    const release = await this.admit(user, ent, models.length);
    try {
      const parentId = input.parentId === undefined ? conv.activeLeafId : input.parentId;
      if (parentId) {
        const [p] = await this.d.db.select({ id: messages.id, status: messages.status }).from(messages).where(and(eq(messages.id, parentId), eq(messages.conversationId, conv.id)));
        if (!p) throw new LumenError('VALIDATION_FAILED', 'Parent message not found in this conversation.');
        if (p.status === 'streaming') throw new LumenError('CONFLICT', 'Wait for the current response to finish, or stop it.');
      }
      const [userMsg] = await this.d.db
        .insert(messages)
        .values({
          conversationId: conv.id,
          parentId: parentId ?? null,
          role: 'user',
          content: input.content,
          parts: attached.map((f) => ({ type: 'attachment' as const, fileId: f.id, name: f.name, kind: f.kind, mimeType: f.mimeType, sizeBytes: f.sizeBytes })),
          createdAt: this.d.now(),
        })
        .returning();
      await this.d.fileContext.attach(conv.id, userMsg!.id, attached.map((f) => f.id));
      await this.d.db.update(conversations).set({ messageCount: sql`${conversations.messageCount} + 1`, ...(input.modelId && !input.compareModelIds ? { modelId: input.modelId } : {}) }).where(eq(conversations.id, conv.id));
      const assistants = await this.launch(user, conv, userMsg!, models, { thinking: input.thinkingEffort, release });
      return { userMessage: serializeMessage(userMsg!), assistantMessages: assistants.map(serializeMessage) };
    } catch (e) {
      await release();
      throw e;
    }
  }

  /** New assistant sibling for the same user message (optionally with a different model). */
  async regenerate(user: UserRow, ent: Entitlements, conversationId: string, messageId: string, input: { modelId?: string; thinkingEffort?: Thinking }) {
    const conv = await this.d.conversations.get(user, conversationId);
    const [target] = await this.d.db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.conversationId, conv.id)));
    if (!target || target.role !== 'assistant' || !target.parentId) throw new LumenError('NOT_FOUND', 'Response not found.');
    if (target.status === 'streaming') throw new LumenError('CONFLICT', 'This response is still generating.');
    const [parent] = await this.d.db.select().from(messages).where(eq(messages.id, target.parentId));
    const model = await this.resolveModel(user, conv, input.modelId ?? target.modelId ?? undefined);
    const release = await this.admit(user, ent, 1);
    try {
      const [a] = await this.launch(user, conv, parent!, [model], { thinking: input.thinkingEffort, release });
      return { assistantMessage: serializeMessage(a!) };
    } catch (e) {
      await release();
      throw e;
    }
  }

  /** Editing a user message creates a sibling branch; the original stays reachable via branch arrows. */
  async edit(user: UserRow, ent: Entitlements, conversationId: string, messageId: string, input: { content: string; modelId?: string }) {
    const conv = await this.d.conversations.get(user, conversationId);
    const [orig] = await this.d.db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.conversationId, conv.id)));
    if (!orig || orig.role !== 'user') throw new LumenError('NOT_FOUND', 'Message not found.');
    return this.send(user, ent, conversationId, { content: input.content, parentId: orig.parentId, modelId: input.modelId });
  }

  async feedback(user: UserRow, conversationId: string, messageId: string, rating: -1 | 0 | 1, reason?: string) {
    await this.d.conversations.get(user, conversationId);
    const res = await this.d.db
      .update(messages)
      .set({ rating: rating === 0 ? null : rating, ratingReason: rating === 0 ? null : (reason ?? null) })
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId), eq(messages.role, 'assistant')))
      .returning({ id: messages.id });
    if (!res.length) throw new LumenError('NOT_FOUND', 'Response not found.');
  }

  /** Short title from the first exchange using the conversation's model. */
  async autoTitle(user: UserRow, conversationId: string, model: ResolvedModel): Promise<string | null> {
    const all = await this.d.conversations.messagesOf(conversationId);
    const firstUser = all.find((m) => m.role === 'user');
    if (!firstUser) return null;
    const runtime = await this.d.providers.runtime(model.provider.id);
    const r = await complete(runtime.adapter, {
      model: model.model.providerModelId,
      maxTokens: 24,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'Write a short, specific title (3-6 words) for a chat that starts with the message below. Reply with the title only, no quotes or punctuation at the end.' },
        { role: 'user', content: firstUser.content.slice(0, 2000) },
      ],
    });
    const title = r.text.replace(/^["'\s]+|["'.\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 80);
    if (!title) return null;
    const res = await this.d.db
      .update(conversations)
      .set({ title, titleSource: 'auto' })
      .where(and(eq(conversations.id, conversationId), eq(conversations.titleSource, 'default')))
      .returning({ id: conversations.id });
    if (res.length) await this.d.bus.publish(user.id, { type: 'conversation.upsert', conversationId });
    return title;
  }
}
