import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { complete, estimateTokens } from '@lumen/llm';
import { LumenError, MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS, MEMORY_MAX_CHARS, userPreferencesSchema, type MemoryCategory } from '@lumen/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/client.js';
import { memories, memorySummaries, usageEvents, users, type MemoryRow, type UserRow } from '../../db/schema/index.js';
import type { JobQueue } from '../../lib/jobs.js';
import { detectSecret } from '../../lib/sensitive.js';
import type { EntitlementService } from '../entitlements/entitlements.service.js';
import type { EmbeddingService } from '../files/embedding.service.js';
import { contentTerms } from '../files/stopwords.js';
import type { ModelCatalogService } from '../models/catalog.service.js';
import type { ProjectService } from '../projects/project.service.js';
import type { ProviderService } from '../providers/provider.service.js';
import type { SettingsService } from '../settings/settings.service.js';

export const MEMORY_CONSOLIDATE_JOB = 'memory.consolidate';
type Source = MemoryRow['source'];

export function serializeMemory(m: MemoryRow) {
  return {
    id: m.id,
    content: m.content,
    category: m.category,
    projectId: m.projectId,
    pinned: m.pinned,
    source: m.source,
    conversationId: m.conversationId,
    messageId: m.messageId,
    useCount: m.useCount,
    lastUsedAt: m.lastUsedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Same fact said twice: identical after normalization, near-identical wording, or near-identical embedding. */
export function isDuplicate(a: Pick<MemoryRow, 'content' | 'embedding' | 'embeddingModel'>, b: Pick<MemoryRow, 'content' | 'embedding' | 'embeddingModel'>): boolean {
  if (normalize(a.content) === normalize(b.content)) return true;
  const ta = contentTerms(a.content);
  const tb = contentTerms(b.content);
  if (ta.length >= 3 && tb.length >= 3 && jaccard(ta, tb) >= 0.8) return true;
  return Boolean(a.embedding && b.embedding && a.embeddingModel === b.embeddingModel && cosine(a.embedding, b.embedding) >= 0.95);
}

/** Best-guess category for imported lines. */
export function guessCategory(text: string): MemoryCategory {
  const t = text.toLowerCase();
  if (/\b(prefer|prefers|like|likes|love|loves|hate|hates|dislike|dislikes|favorite|favourite|always|never|wants? (?:answers|responses|replies))\b/.test(t)) return 'preferences';
  if (/\b(my|his|her|their)\s+(wife|husband|partner|son|daughter|kids?|children|mom|mother|dad|father|sister|brother|friend|boss|manager|colleague|coworker|team)\b|\b(wife|husband|partner|daughter|son)\b/.test(t)) return 'people';
  if (/\b(project|building|working on|startup|thesis|app|launch|research)\b/.test(t)) return 'projects';
  if (/\b(todo|to-do|remind|deadline|due|plan to|planning|goal|by (?:monday|tuesday|wednesday|thursday|friday|next week|the end))\b/.test(t)) return 'tasks';
  if (/\b(name is|named|i am|i'm|is a|works as|works at|job|lives in|based in|years old|born|speaks|studies|student|engineer|developer|designer|teacher|doctor)\b/.test(t)) return 'profile';
  return 'other';
}

/** Split a pasted memory export (JSON or text/Markdown list) into candidate entries. */
export function parseMemoryExport(text: string): { content: string; category: MemoryCategory }[] {
  const out: { content: string; category: MemoryCategory }[] = [];
  const push = (content: unknown, category?: unknown) => {
    if (typeof content !== 'string') return;
    const c = content.replace(/\s+/g, ' ').trim();
    if (c.length < 3) return;
    out.push({ content: c.slice(0, MEMORY_MAX_CHARS), category: MEMORY_CATEGORIES.includes(category as MemoryCategory) ? (category as MemoryCategory) : guessCategory(c) });
  };
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(data) ? data : ((data as Record<string, unknown>).memories ?? (data as Record<string, unknown>).items ?? (data as Record<string, unknown>).entries);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === 'string') push(item);
          else if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>;
            push(o.content ?? o.text ?? o.memory ?? o.value, o.category);
          }
        }
        return dedupeList(out);
      }
    } catch {
      /* not JSON: fall through to line parsing */
    }
  }
  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '')
      .replace(/^\s*\[?\d{4}-\d{2}-\d{2}(?:[ T][\d:.]+Z?)?\]?\s*[-:–]?\s*/, '')
      .trim();
    if (!line || /^#{1,6}\s/.test(line) || /^(memories|saved memories|here (?:is|are)|what i (?:know|remember))\b/i.test(line)) continue;
    push(line);
  }
  return dedupeList(out);
}

function dedupeList<T extends { content: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = normalize(e.content);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** First balanced JSON object in a model reply. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface MemoryDeps {
  db: Database;
  settings: SettingsService;
  embeddings: EmbeddingService;
  projects: ProjectService;
  catalog: ModelCatalogService;
  providers: ProviderService;
  entitlements: EntitlementService;
  jobs: JobQueue;
  log: Logger;
  now: () => Date;
}

export class MemoryService {
  constructor(private readonly d: MemoryDeps) {
    this.d.jobs.register<{ userId: string }>(MEMORY_CONSOLIDATE_JOB, async ({ userId }) => {
      await this.consolidateById(userId);
    });
  }

  /** Memory is on unless the user paused it or an admin disabled the feature. */
  async enabledFor(user: UserRow): Promise<boolean> {
    const prefs = userPreferencesSchema.safeParse(user.preferences ?? {});
    if (prefs.success && prefs.data.memoryEnabled === false) return false;
    const ent = await this.d.entitlements.forUser(user);
    return ent.features.memory.allowed;
  }

  private scopeCondition(userId: string, projectId: string | null | undefined): SQL {
    return projectId ? and(eq(memories.userId, userId), or(isNull(memories.projectId), eq(memories.projectId, projectId)))! : and(eq(memories.userId, userId), isNull(memories.projectId))!;
  }

  async list(user: UserRow, q: { q?: string; category?: MemoryCategory; scope: string; limit: number }) {
    const conds: SQL[] = [eq(memories.userId, user.id)];
    if (q.category) conds.push(eq(memories.category, q.category));
    if (q.scope === 'global') conds.push(isNull(memories.projectId));
    else if (q.scope !== 'all') conds.push(eq(memories.projectId, q.scope));
    if (q.q) conds.push(or(ilike(memories.content, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`), sql`${memories.contentTsv} @@ websearch_to_tsquery('simple', ${q.q})`)!);
    const rows = await this.d.db.select().from(memories).where(and(...conds)).orderBy(desc(memories.pinned), desc(memories.updatedAt)).limit(q.limit);
    return rows.map(serializeMemory);
  }

  async get(user: Pick<UserRow, 'id'>, id: string): Promise<MemoryRow> {
    const [m] = await this.d.db.select().from(memories).where(and(eq(memories.id, id), eq(memories.userId, user.id)));
    if (!m) throw new LumenError('NOT_FOUND', 'Memory not found.');
    return m;
  }

  async byIds(user: Pick<UserRow, 'id'>, ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.d.db.select().from(memories).where(and(eq(memories.userId, user.id), inArray(memories.id, ids.slice(0, 100))));
    return rows.map(serializeMemory);
  }

  private validate(content: string): string {
    const c = content.replace(/\s+/g, ' ').trim();
    if (!c) throw new LumenError('VALIDATION_FAILED', 'A memory can’t be empty.');
    if (c.length > MEMORY_MAX_CHARS) throw new LumenError('VALIDATION_FAILED', `Keep memories under ${MEMORY_MAX_CHARS} characters.`);
    const secret = detectSecret(c);
    if (secret) throw new LumenError('VALIDATION_FAILED', `This looks like ${secret}. Secrets are never saved to memory.`);
    return c;
  }

  private async embed(content: string, userId: string): Promise<{ embedding: number[] | null; embeddingModel: string | null }> {
    try {
      const r = await this.d.embeddings.embedOne(content, userId);
      return r ? { embedding: r.vector, embeddingModel: r.model } : { embedding: null, embeddingModel: null };
    } catch (err) {
      // Embeddings improve recall but aren't required: lexical matching still works.
      this.d.log.warn({ err }, 'memory embedding failed');
      return { embedding: null, embeddingModel: null };
    }
  }

  private async noteWrites(userId: string, n = 1) {
    const [row] = await this.d.db
      .insert(memorySummaries)
      .values({ userId, pendingWrites: n })
      .onConflictDoUpdate({ target: memorySummaries.userId, set: { pendingWrites: sql`${memorySummaries.pendingWrites} + ${n}` } })
      .returning({ pending: memorySummaries.pendingWrites });
    const { consolidateAfterWrites } = await this.d.settings.get('memory');
    if ((row?.pending ?? 0) >= consolidateAfterWrites) await this.d.jobs.enqueue(MEMORY_CONSOLIDATE_JOB, { userId }, { jobId: `memory-consolidate:${userId}`, delayMs: 30_000 });
  }

  /**
   * Save a memory. Near-duplicates of an existing memory (same scope) update it instead of adding a copy,
   * so "remember X" twice never yields two entries.
   */
  async create(
    user: UserRow,
    input: { content: string; category?: MemoryCategory; projectId?: string | null; pinned?: boolean },
    provenance: { source: Source; conversationId?: string | null; messageId?: string | null } = { source: 'user' },
  ): Promise<{ memory: ReturnType<typeof serializeMemory>; deduplicated: boolean }> {
    const content = this.validate(input.content);
    const projectId = input.projectId ?? null;
    if (projectId) await this.d.projects.require(user, projectId, 'viewer');
    const vec = await this.embed(content, user.id);
    const sameScope = await this.d.db.select().from(memories).where(and(eq(memories.userId, user.id), projectId ? eq(memories.projectId, projectId) : isNull(memories.projectId)));
    const dup = sameScope.find((m) => isDuplicate(m, { content, ...vec }));
    if (dup) {
      const [row] = await this.d.db
        .update(memories)
        .set({ content, category: input.category ?? dup.category, pinned: input.pinned ?? dup.pinned, ...vec, updatedAt: this.d.now() })
        .where(eq(memories.id, dup.id))
        .returning();
      return { memory: serializeMemory(row!), deduplicated: true };
    }
    const { maxPerUser } = await this.d.settings.get('memory');
    const [{ n } = { n: 0 }] = await this.d.db.select({ n: sql<number>`count(*)::int` }).from(memories).where(eq(memories.userId, user.id));
    if (n >= maxPerUser) throw new LumenError('QUOTA_EXCEEDED', `You have ${maxPerUser} memories, the maximum. Delete some in Settings → Memory.`);
    const [row] = await this.d.db
      .insert(memories)
      .values({ userId: user.id, projectId, category: input.category ?? 'other', content, pinned: input.pinned ?? false, source: provenance.source, conversationId: provenance.conversationId ?? null, messageId: provenance.messageId ?? null, ...vec, createdAt: this.d.now(), updatedAt: this.d.now() })
      .returning();
    await this.noteWrites(user.id);
    return { memory: serializeMemory(row!), deduplicated: false };
  }

  async update(user: UserRow, id: string, patch: { content?: string; category?: MemoryCategory; projectId?: string | null; pinned?: boolean }) {
    const m = await this.get(user, id);
    const content = patch.content !== undefined ? this.validate(patch.content) : undefined;
    if (patch.projectId) await this.d.projects.require(user, patch.projectId, 'viewer');
    const vec = content && content !== m.content ? await this.embed(content, user.id) : {};
    const [row] = await this.d.db
      .update(memories)
      .set({ ...(content ? { content } : {}), ...(patch.category ? { category: patch.category } : {}), ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}), ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}), ...vec, updatedAt: this.d.now() })
      .where(eq(memories.id, m.id))
      .returning();
    if (content) await this.noteWrites(user.id);
    return serializeMemory(row!);
  }

  async delete(user: UserRow, id: string) {
    const m = await this.get(user, id);
    await this.d.db.delete(memories).where(eq(memories.id, m.id));
    return serializeMemory(m);
  }

  /** "Forget everything": hard-deletes memories and the summary. */
  async deleteAll(user: UserRow): Promise<number> {
    const rows = await this.d.db.delete(memories).where(eq(memories.userId, user.id)).returning({ id: memories.id });
    await this.d.db.delete(memorySummaries).where(eq(memorySummaries.userId, user.id));
    return rows.length;
  }

  /**
   * Memories for one turn: pinned first, then by relevance (embedding similarity + keyword overlap) with
   * a small recency boost and a base weight for profile/preferences, within a token budget.
   */
  async retrieve(user: UserRow, input: { query: string; projectId: string | null }): Promise<MemoryRow[]> {
    const { tokenBudget, maxPerTurn } = await this.d.settings.get('memory');
    if (!tokenBudget || !maxPerTurn) return [];
    const rows = await this.d.db.select().from(memories).where(this.scopeCondition(user.id, input.projectId)).orderBy(desc(memories.updatedAt)).limit(2000);
    if (!rows.length) return [];
    const total = rows.reduce((s, m) => s + estimateTokens(m.content) + 6, 0);
    let ranked: { m: MemoryRow; score: number }[];
    if (rows.length <= maxPerTurn && total <= tokenBudget) {
      ranked = rows.map((m) => ({ m, score: 1 }));
    } else {
      const qTerms = contentTerms(input.query);
      const needsVector = rows.some((m) => m.embedding);
      const q = needsVector && input.query.trim() ? await this.embed(input.query.slice(0, 2000), user.id) : null;
      const now = this.d.now().getTime();
      ranked = rows.map((m) => {
        const mTerms = contentTerms(m.content);
        const overlap = qTerms.filter((t) => mTerms.includes(t)).length;
        const lexical = qTerms.length && mTerms.length ? overlap / Math.min(qTerms.length, mTerms.length) : 0;
        const semantic = q?.embedding && m.embedding && q.embeddingModel === m.embeddingModel ? Math.max(0, (cosine(q.embedding, m.embedding) - 0.2) / 0.8) : 0;
        const ageDays = (now - Math.max(m.updatedAt.getTime(), m.lastUsedAt?.getTime() ?? 0)) / 86_400_000;
        const recency = Math.exp(-ageDays / 60);
        const base = m.category === 'profile' ? 0.15 : m.category === 'preferences' ? 0.1 : 0;
        return { m, score: 0.5 * semantic + 0.35 * lexical + 0.1 * recency + base };
      });
      ranked = ranked.filter((r) => r.m.pinned || r.score >= 0.2);
    }
    ranked.sort((a, b) => Number(b.m.pinned) - Number(a.m.pinned) || b.score - a.score);
    const picked: MemoryRow[] = [];
    let used = 0;
    for (const { m } of ranked) {
      const cost = estimateTokens(m.content) + 6;
      if (picked.length >= maxPerTurn || used + cost > tokenBudget) continue;
      picked.push(m);
      used += cost;
    }
    if (picked.length) {
      await this.d.db
        .update(memories)
        .set({ useCount: sql`${memories.useCount} + 1`, lastUsedAt: this.d.now() })
        .where(inArray(memories.id, picked.map((m) => m.id)));
    }
    return picked;
  }

  /** Keyword/semantic search used by the memory_search tool and the settings page. */
  async search(user: UserRow, query: string, projectId: string | null, limit = 10) {
    const rows = await this.d.db.select().from(memories).where(this.scopeCondition(user.id, projectId)).limit(2000);
    const qTerms = contentTerms(query);
    const q = rows.some((m) => m.embedding) ? await this.embed(query, user.id) : null;
    const nq = normalize(query);
    return rows
      .map((m) => {
        const mTerms = contentTerms(m.content);
        const lexical = qTerms.length ? qTerms.filter((t) => mTerms.includes(t)).length / qTerms.length : 0;
        const semantic = q?.embedding && m.embedding && q.embeddingModel === m.embeddingModel ? cosine(q.embedding, m.embedding) : 0;
        const substring = nq && normalize(m.content).includes(nq) ? 1 : 0;
        return { m, score: Math.max(lexical, semantic, substring) };
      })
      .filter((r) => r.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.m);
  }

  async summary(user: UserRow) {
    const [s] = await this.d.db.select().from(memorySummaries).where(eq(memorySummaries.userId, user.id));
    return { content: s?.content ?? '', memoryCount: s?.memoryCount ?? 0, consolidatedAt: s?.consolidatedAt?.toISOString() ?? null, pendingWrites: s?.pendingWrites ?? 0 };
  }

  async exportAll(user: UserRow) {
    const rows = await this.d.db.select().from(memories).where(eq(memories.userId, user.id)).orderBy(memories.category, desc(memories.updatedAt));
    return {
      version: 1,
      exportedAt: this.d.now().toISOString(),
      memories: rows.map((m) => ({ content: m.content, category: m.category, projectId: m.projectId, pinned: m.pinned, source: m.source, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() })),
    };
  }

  /** Preview an import: parsed entries flagged as duplicates or rejected (secrets) before anything is saved. */
  async previewImport(user: UserRow, text: string) {
    const parsed = parseMemoryExport(text).slice(0, 1000);
    const existing = await this.d.db.select({ content: memories.content, embedding: memories.embedding, embeddingModel: memories.embeddingModel }).from(memories).where(eq(memories.userId, user.id));
    return parsed.map((e) => {
      const secret = detectSecret(e.content);
      return { ...e, duplicate: existing.some((m) => isDuplicate(m, { content: e.content, embedding: null, embeddingModel: null })), rejected: secret ? `Looks like ${secret}` : null };
    });
  }

  async importEntries(user: UserRow, entries: { content: string; category: MemoryCategory }[], projectId: string | null) {
    let created = 0;
    let merged = 0;
    const skipped: { content: string; reason: string }[] = [];
    for (const e of entries) {
      try {
        const r = await this.create(user, { ...e, projectId }, { source: 'import' });
        if (r.deduplicated) merged++;
        else created++;
      } catch (err) {
        skipped.push({ content: e.content.slice(0, 120), reason: err instanceof LumenError ? err.message : 'Failed' });
        if (err instanceof LumenError && err.code === 'QUOTA_EXCEEDED') break;
      }
    }
    return { created, merged, skipped };
  }

  private async consolidateById(userId: string) {
    const [user] = await this.d.db.select().from(users).where(eq(users.id, userId));
    if (user) await this.consolidate(user);
  }

  /**
   * Tidy memory: merge duplicates, let the model merge related entries and drop ones contradicted by newer
   * ones, and rewrite the readable summary. Pinned memories are never removed.
   */
  async consolidate(user: UserRow): Promise<{ merged: number; removed: number; total: number }> {
    let rows = await this.d.db.select().from(memories).where(eq(memories.userId, user.id)).orderBy(desc(memories.updatedAt));
    let merged = 0;
    let removed = 0;

    // 1. Deterministic duplicate clusters (same scope); keep the newest (or pinned) wording.
    const gone = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i]!;
      if (gone.has(a.id)) continue;
      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j]!;
        if (gone.has(b.id) || a.projectId !== b.projectId || !isDuplicate(a, b)) continue;
        const [keep, drop] = b.pinned && !a.pinned ? [b, a] : [a, b];
        await this.d.db.update(memories).set({ pinned: keep.pinned || drop.pinned, useCount: keep.useCount + drop.useCount }).where(eq(memories.id, keep.id));
        await this.d.db.delete(memories).where(eq(memories.id, drop.id));
        gone.add(drop.id);
        merged++;
        if (drop === a) break;
      }
    }
    rows = rows.filter((r) => !gone.has(r.id));

    // 2. Model pass: merge related facts and resolve contradictions (newer wins). Best effort.
    let summary: string | null = null;
    const model = rows.length >= 2 ? await this.d.catalog.defaultFor(user).catch(() => null) : null;
    if (model) {
      try {
        const list = rows.slice(0, 300).map((m, i) => `[${i + 1}] (${m.category}${m.pinned ? ', pinned' : ''}, ${m.updatedAt.toISOString().slice(0, 10)}) ${m.content}`).join('\n');
        const runtime = await this.d.providers.runtime(model.provider.id);
        const r = await complete(runtime.adapter, {
          model: model.model.providerModelId,
          maxTokens: 2000,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'You maintain an assistant\'s memory about one user. Given numbered memories, reply with JSON only: {"merge":[{"items":[numbers],"content":"one concise sentence combining them"}],"remove":[numbers],"summary":"a short Markdown profile of the user grouped by topic"}. Merge only entries about the same fact. Remove an entry only when a newer entry contradicts it. Never include secrets. Use [] when nothing applies.',
            },
            { role: 'user', content: list },
          ],
        });
        await this.d.db.insert(usageEvents).values({ userId: user.id, source: 'memory', modelId: model.model.id, providerId: model.provider.id, providerKeyId: runtime.keyId, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, status: 'ok' });
        const plan = extractJson(r.text) as { merge?: { items?: unknown; content?: unknown }[]; remove?: unknown; summary?: unknown } | null;
        if (plan) {
          const byIndex = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) ? rows[n - 1] : undefined);
          const removedIds = new Set<string>();
          for (const g of Array.isArray(plan.merge) ? plan.merge.slice(0, 100) : []) {
            const items = (Array.isArray(g.items) ? g.items : []).map(byIndex).filter((m): m is MemoryRow => Boolean(m) && !removedIds.has(m!.id));
            if (items.length < 2 || typeof g.content !== 'string' || new Set(items.map((m) => m.projectId)).size > 1) continue;
            let content: string;
            try {
              content = this.validate(g.content);
            } catch {
              continue;
            }
            const [keep, ...rest] = [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.getTime() - a.updatedAt.getTime());
            await this.d.db.update(memories).set({ content, source: 'consolidation', pinned: items.some((m) => m.pinned), ...(await this.embed(content, user.id)), updatedAt: this.d.now() }).where(eq(memories.id, keep!.id));
            for (const m of rest) {
              await this.d.db.delete(memories).where(eq(memories.id, m.id));
              removedIds.add(m.id);
              merged++;
            }
          }
          for (const n of Array.isArray(plan.remove) ? plan.remove.slice(0, 100) : []) {
            const m = byIndex(n);
            if (!m || m.pinned || removedIds.has(m.id)) continue;
            await this.d.db.delete(memories).where(eq(memories.id, m.id));
            removedIds.add(m.id);
            removed++;
          }
          if (typeof plan.summary === 'string' && plan.summary.trim() && !detectSecret(plan.summary)) summary = plan.summary.trim().slice(0, 8000);
        }
      } catch (err) {
        this.d.log.warn({ err, userId: user.id }, 'memory consolidation model pass failed');
      }
    }

    // 3. Summary document (deterministic fallback grouped by category).
    const final = await this.d.db.select().from(memories).where(eq(memories.userId, user.id)).orderBy(desc(memories.pinned), desc(memories.updatedAt));
    if (!summary) {
      summary = MEMORY_CATEGORIES.map((c) => {
        const items = final.filter((m) => m.category === c);
        return items.length ? `## ${MEMORY_CATEGORY_LABELS[c]}\n${items.map((m) => `- ${m.content}`).join('\n')}` : '';
      })
        .filter(Boolean)
        .join('\n\n');
    }
    await this.d.db
      .insert(memorySummaries)
      .values({ userId: user.id, content: summary, memoryCount: final.length, pendingWrites: 0, consolidatedAt: this.d.now(), updatedAt: this.d.now() })
      .onConflictDoUpdate({ target: memorySummaries.userId, set: { content: summary, memoryCount: final.length, pendingWrites: 0, consolidatedAt: this.d.now(), updatedAt: this.d.now() } });
    return { merged, removed, total: final.length };
  }
}
