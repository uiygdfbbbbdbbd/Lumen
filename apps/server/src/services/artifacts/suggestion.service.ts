import { and, desc, eq } from 'drizzle-orm';
import { complete } from '@lumen/llm';
import { LumenError, type Entitlements } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { artifactSuggestions, usageEvents, type ArtifactSuggestionRow, type UserRow } from '../../db/schema/index.js';
import type { EntitlementService } from '../entitlements/entitlements.service.js';
import type { ModelCatalogService } from '../models/catalog.service.js';
import type { ProviderService } from '../providers/provider.service.js';
import type { ArtifactService } from './artifact.service.js';

export const QUICK_ACTIONS = ['polish', 'shorten', 'lengthen', 'tone', 'translate', 'comments', 'fix_bugs', 'port'] as const;
export type QuickAction = (typeof QUICK_ACTIONS)[number];

/** Instruction for each quick action (`option` is a tone or target language). */
export function quickActionInstruction(action: QuickAction, option: string | undefined, isCode: boolean): string {
  const opt = (option ?? '').replace(/[^\p{L}\p{N} +#.-]/gu, '').slice(0, 40);
  switch (action) {
    case 'polish':
      return isCode ? 'Clean up this code: clearer names, consistent formatting, remove dead code. Keep behavior identical.' : 'Polish the writing: fix grammar, spelling and awkward phrasing. Keep the meaning, voice and structure.';
    case 'shorten':
      return 'Make it about 30-50% shorter while keeping the essential points.';
    case 'lengthen':
      return 'Expand it by about 50% with useful detail, examples or explanation. Don’t add filler.';
    case 'tone':
      return `Rewrite it in a ${opt || 'more professional'} tone. Keep the content and structure.`;
    case 'translate':
      if (!opt) throw new LumenError('VALIDATION_FAILED', 'Choose a language to translate to.');
      return `Translate it into ${opt}. Keep formatting, code and names unchanged.`;
    case 'comments':
      return 'Add concise, helpful comments explaining non-obvious parts. Don’t change the code itself.';
    case 'fix_bugs':
      return 'Find and fix bugs (logic errors, edge cases, crashes). Keep everything else the same and add a short comment at each fix.';
    case 'port':
      if (!opt) throw new LumenError('VALIDATION_FAILED', 'Choose a language to port to.');
      return `Port this code to idiomatic ${opt} with the same behavior.`;
  }
}

/** Models often wrap a whole document in a code fence; unwrap a single outer fence. */
export function unfence(text: string): string {
  const m = /^\s*```[\w+-]*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? m[1]! : text.trim();
}

export function serializeSuggestion(s: ArtifactSuggestionRow) {
  return { id: s.id, artifactId: s.artifactId, baseVersion: s.baseVersion, content: s.content, note: s.note, source: s.source, status: s.status, createdAt: s.createdAt.toISOString() };
}

export class SuggestionService {
  constructor(
    private readonly db: Database,
    private readonly artifacts: ArtifactService,
    private readonly catalog: ModelCatalogService,
    private readonly providers: ProviderService,
    private readonly entitlements: EntitlementService,
  ) {}

  async create(user: UserRow, artifactId: string, input: { content: string; note?: string; source?: string; messageId?: string | null }) {
    await this.artifacts.get(user, artifactId, true);
    const cur = await this.artifacts.content(artifactId);
    if (input.content === cur.content) throw new LumenError('VALIDATION_FAILED', 'The suggestion doesn’t change anything.');
    if (Buffer.byteLength(input.content) > 1024 * 1024) throw new LumenError('PAYLOAD_TOO_LARGE', 'Artifacts can be at most 1 MB.');
    const [row] = await this.db
      .insert(artifactSuggestions)
      .values({ artifactId, userId: user.id, baseVersion: cur.version, content: input.content, note: (input.note ?? '').slice(0, 500), source: input.source ?? 'ai', messageId: input.messageId ?? null })
      .returning();
    return serializeSuggestion(row!);
  }

  /** Exact, unique replacement against the current content, proposed instead of applied. */
  async createFromReplace(user: UserRow, artifactId: string, oldStr: string, newStr: string, note: string, messageId?: string | null) {
    const { content } = await this.artifacts.content(artifactId);
    const first = content.indexOf(oldStr);
    if (!oldStr || first < 0) throw new LumenError('VALIDATION_FAILED', 'old_str was not found in the artifact.');
    if (content.indexOf(oldStr, first + 1) >= 0) throw new LumenError('VALIDATION_FAILED', 'old_str matches more than once. Include more surrounding text.');
    return this.create(user, artifactId, { content: content.slice(0, first) + newStr + content.slice(first + oldStr.length), note, messageId });
  }

  async list(user: UserRow, artifactId: string, status: 'pending' | 'all' = 'pending') {
    await this.artifacts.get(user, artifactId);
    const rows = await this.db
      .select()
      .from(artifactSuggestions)
      .where(status === 'pending' ? and(eq(artifactSuggestions.artifactId, artifactId), eq(artifactSuggestions.status, 'pending')) : eq(artifactSuggestions.artifactId, artifactId))
      .orderBy(desc(artifactSuggestions.createdAt))
      .limit(50);
    return rows.map(serializeSuggestion);
  }

  async resolve(user: UserRow, artifactId: string, suggestionId: string, status: 'accepted' | 'rejected') {
    await this.artifacts.get(user, artifactId, true);
    const rows = await this.db
      .update(artifactSuggestions)
      .set({ status, resolvedAt: new Date() })
      .where(and(eq(artifactSuggestions.id, suggestionId), eq(artifactSuggestions.artifactId, artifactId), eq(artifactSuggestions.status, 'pending')))
      .returning();
    if (!rows.length) throw new LumenError('NOT_FOUND', 'Suggestion not found or already resolved.');
    return serializeSuggestion(rows[0]!);
  }

  /** Run a quick action (on the whole artifact or an exact selection) and return it as a suggestion. */
  async quickAction(user: UserRow, ent: Entitlements, artifactId: string, input: { action: QuickAction; option?: string; selection?: string }) {
    const a = await this.artifacts.get(user, artifactId, true);
    if (!['markdown', 'code', 'latex', 'html', 'react', 'slides'].includes(a.type)) throw new LumenError('VALIDATION_FAILED', 'Quick actions work on documents and code.');
    const isCode = ['code', 'html', 'react'].includes(a.type);
    if (!isCode && ['comments', 'fix_bugs', 'port'].includes(input.action)) throw new LumenError('VALIDATION_FAILED', 'That action is for code.');
    const { content } = await this.artifacts.content(artifactId);
    let target = content;
    let start = 0;
    if (input.selection) {
      start = content.indexOf(input.selection);
      if (start < 0 || content.indexOf(input.selection, start + 1) >= 0) throw new LumenError('VALIDATION_FAILED', 'The selection must match exactly one place in the artifact.');
      target = input.selection;
    }
    await this.entitlements.consumeOrThrow(user, ent, 'messages', 'messagesPerDay', 1);
    const model = await this.catalog.defaultFor(user);
    if (!model) throw new LumenError('PROVIDER_UNAVAILABLE', 'No AI model is available.');
    const runtime = await this.providers.runtime(model.provider.id);
    const instruction = quickActionInstruction(input.action, input.option, isCode);
    const r = await complete(
      runtime.adapter,
      {
        model: model.model.providerModelId,
        maxTokens: Math.min(8000, Math.ceil(target.length / 2) + 1000),
        temperature: 0.3,
        messages: [
          { role: 'system', content: `You edit ${isCode ? `${a.language ?? 'source'} code` : 'documents'}. ${instruction} Reply with only the full revised text${input.selection ? ' of the excerpt' : ''}, no explanations or code fences.` },
          { role: 'user', content: target },
        ],
      },
      AbortSignal.timeout(180_000),
    );
    await this.db.insert(usageEvents).values({ userId: user.id, source: 'artifact', modelId: model.model.id, providerId: model.provider.id, providerKeyId: runtime.keyId, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, status: 'ok' });
    await this.entitlements.add(user.id, 'tokens', r.usage.inputTokens + r.usage.outputTokens);
    const revised = unfence(r.text);
    if (!revised) throw new LumenError('PROVIDER_ERROR', 'The model returned nothing. Try again.');
    const next = input.selection ? content.slice(0, start) + revised + content.slice(start + target.length) : revised;
    const label = input.action === 'tone' || input.action === 'translate' || input.action === 'port' ? `${input.action.replace('_', ' ')}: ${input.option}` : input.action.replace('_', ' ');
    return this.create(user, artifactId, { content: next, note: `Quick action — ${label}${input.selection ? ' (selection)' : ''}`, source: 'quick_action' });
  }
}
