import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { buildPage, decodeCursor, LumenError, type Page } from '@lumen/shared';
import type { z } from 'zod';
import type { conversationPatchSchema, createConversationSchema, searchQuerySchema } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { compactions, conversations, messages, type ConversationRow, type MessageRow, type UserRow } from '../../db/schema/index.js';
import type { EventBus } from '../../lib/realtime/event-bus.js';

const INCOGNITO_TTL_MS = 24 * 3600_000;
export const UNDO_WINDOW_MS = 10 * 60_000;

export interface ConversationSummary {
  id: string;
  projectId: string | null;
  title: string;
  modelId: string | null;
  pinned: boolean;
  starred: boolean;
  archived: boolean;
  incognito: boolean;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
}

export function summarize(c: ConversationRow): ConversationSummary {
  return {
    id: c.id,
    projectId: c.projectId,
    title: c.title,
    modelId: c.modelId,
    pinned: c.pinned,
    starred: c.starred,
    archived: c.archived,
    incognito: c.incognito,
    messageCount: c.messageCount,
    lastMessageAt: c.lastMessageAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  };
}

export function serializeMessage(m: MessageRow) {
  return {
    id: m.id,
    parentId: m.parentId,
    role: m.role,
    content: m.content,
    parts: m.parts,
    status: m.status,
    error: m.error,
    modelId: m.modelId,
    modelName: m.modelName,
    usage: m.usage,
    rating: m.rating,
    compareGroup: m.compareGroup,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Path from the root to `leafId` given all messages of a conversation. */
export function pathTo(all: Pick<MessageRow, 'id' | 'parentId'>[], leafId: string | null): string[] {
  if (!leafId) return [];
  const byId = new Map(all.map((m) => [m.id, m]));
  const path: string[] = [];
  let cur = byId.get(leafId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path.reverse();
}

/** Follow the most recent child repeatedly to find the leaf of a branch. */
export function deepestLeaf(all: Pick<MessageRow, 'id' | 'parentId' | 'createdAt'>[], fromId: string): string {
  const children = new Map<string, Pick<MessageRow, 'id' | 'createdAt'>[]>();
  for (const m of all) if (m.parentId) children.set(m.parentId, [...(children.get(m.parentId) ?? []), m]);
  let cur = fromId;
  for (let guard = 0; guard < 100_000; guard++) {
    const kids = children.get(cur);
    if (!kids?.length) return cur;
    cur = kids.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).id;
  }
  return cur;
}

export class ConversationService {
  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(user: UserRow, input: z.infer<typeof createConversationSchema>): Promise<ConversationRow> {
    const [c] = await this.db
      .insert(conversations)
      .values({
        userId: user.id,
        title: input.title || (input.incognito ? 'Temporary chat' : 'New chat'),
        titleSource: input.title ? 'user' : 'default',
        modelId: input.modelId ?? null,
        incognito: input.incognito,
        instructions: input.instructions,
        settings: input.settings,
        projectId: input.projectId ?? null,
        expiresAt: input.incognito ? new Date(this.now().getTime() + INCOGNITO_TTL_MS) : null,
        createdAt: this.now(),
        updatedAt: this.now(),
        lastMessageAt: this.now(),
      })
      .returning();
    if (!input.incognito) await this.bus.publish(user.id, { type: 'conversation.upsert', conversationId: c!.id });
    return c!;
  }

  /** Owner-scoped fetch: other users' conversations are indistinguishable from missing ones (no IDOR). */
  async get(user: Pick<UserRow, 'id'>, id: string, opts: { includeDeleted?: boolean } = {}): Promise<ConversationRow> {
    const [c] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id), opts.includeDeleted ? undefined : isNull(conversations.deletedAt)));
    if (!c) throw new LumenError('NOT_FOUND', 'Conversation not found.');
    return c;
  }

  async list(user: UserRow, q: { limit: number; cursor?: string; archived?: 'true' | 'false'; starred?: 'true' | 'false' }): Promise<Page<ConversationSummary>> {
    const cursor = decodeCursor(q.cursor);
    const conds: SQL[] = [eq(conversations.userId, user.id), isNull(conversations.deletedAt), eq(conversations.incognito, false)];
    conds.push(eq(conversations.archived, q.archived === 'true'));
    if (q.starred) conds.push(eq(conversations.starred, q.starred === 'true'));
    if (cursor) {
      const at = new Date(String(cursor.v));
      conds.push(or(lt(conversations.lastMessageAt, at), and(eq(conversations.lastMessageAt, at), lt(conversations.id, cursor.id)))!);
    }
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(...conds))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(q.limit + 1);
    const page = buildPage(rows, q.limit, (r) => ({ v: r.lastMessageAt.toISOString(), id: r.id }));
    return { items: page.items.map(summarize), nextCursor: page.nextCursor };
  }

  async messagesOf(conversationId: string): Promise<MessageRow[]> {
    return this.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt), asc(messages.id));
  }

  async tree(user: UserRow, id: string) {
    const c = await this.get(user, id);
    const all = await this.messagesOf(id);
    const comps = await this.db.select().from(compactions).where(eq(compactions.conversationId, id)).orderBy(asc(compactions.createdAt));
    return {
      conversation: { ...summarize(c), instructions: c.instructions, settings: c.settings, activeLeafId: c.activeLeafId, expiresAt: c.expiresAt?.toISOString() ?? null },
      messages: all.map(serializeMessage),
      activePath: pathTo(all, c.activeLeafId),
      compactions: comps.map((x) => ({ id: x.id, throughMessageId: x.throughMessageId, summary: x.summary, tokensBefore: x.tokensBefore, tokensAfter: x.tokensAfter, createdAt: x.createdAt.toISOString() })),
    };
  }

  async patch(user: UserRow, id: string, patch: z.infer<typeof conversationPatchSchema>): Promise<ConversationRow> {
    const c = await this.get(user, id);
    const set: Partial<ConversationRow> = { updatedAt: this.now() };
    if (patch.title !== undefined) {
      set.title = patch.title;
      set.titleSource = 'user';
    }
    if (patch.modelId !== undefined) set.modelId = patch.modelId;
    if (patch.projectId !== undefined) set.projectId = patch.projectId;
    if (patch.instructions !== undefined) set.instructions = patch.instructions;
    if (patch.settings !== undefined) set.settings = { ...c.settings, ...patch.settings };
    for (const k of ['pinned', 'starred', 'archived'] as const) if (patch[k] !== undefined) set[k] = patch[k];
    if (patch.activeLeafId !== undefined) {
      const all = await this.messagesOf(id);
      if (!all.some((m) => m.id === patch.activeLeafId)) throw new LumenError('VALIDATION_FAILED', 'That message is not part of this conversation.');
      // Selecting any message in a branch shows that branch down to its newest leaf.
      set.activeLeafId = deepestLeaf(all, patch.activeLeafId);
    }
    const [row] = await this.db.update(conversations).set(set).where(eq(conversations.id, id)).returning();
    if (!c.incognito) await this.bus.publish(user.id, { type: 'conversation.upsert', conversationId: id });
    return row!;
  }

  async softDelete(user: UserRow, ids: string[]): Promise<number> {
    const res = await this.db
      .update(conversations)
      .set({ deletedAt: this.now() })
      .where(and(inArray(conversations.id, ids), eq(conversations.userId, user.id), isNull(conversations.deletedAt)))
      .returning({ id: conversations.id });
    for (const r of res) await this.bus.publish(user.id, { type: 'conversation.deleted', conversationId: r.id });
    return res.length;
  }

  async restore(user: UserRow, id: string): Promise<ConversationRow> {
    const c = await this.get(user, id, { includeDeleted: true });
    if (!c.deletedAt) return c;
    if (this.now().getTime() - c.deletedAt.getTime() > UNDO_WINDOW_MS) throw new LumenError('CONFLICT', 'This chat can no longer be restored.');
    const [row] = await this.db.update(conversations).set({ deletedAt: null }).where(eq(conversations.id, id)).returning();
    await this.bus.publish(user.id, { type: 'conversation.upsert', conversationId: id });
    return row!;
  }

  /** Worker job: permanently remove soft-deleted chats after the undo window, and expired temporary chats. */
  async purge(): Promise<{ deleted: number; expired: number }> {
    const cutoff = new Date(this.now().getTime() - UNDO_WINDOW_MS);
    const deleted = await this.db.delete(conversations).where(and(isNotNull(conversations.deletedAt), lt(conversations.deletedAt, cutoff))).returning({ id: conversations.id });
    const expired = await this.db.delete(conversations).where(and(isNotNull(conversations.expiresAt), lt(conversations.expiresAt, this.now()))).returning({ id: conversations.id });
    return { deleted: deleted.length, expired: expired.length };
  }

  async bulk(user: UserRow, ids: string[], action: 'archive' | 'unarchive' | 'delete' | 'star' | 'unstar' | 'pin' | 'unpin'): Promise<number> {
    if (action === 'delete') return this.softDelete(user, ids);
    const set =
      action === 'archive' ? { archived: true } : action === 'unarchive' ? { archived: false } : action === 'star' ? { starred: true } : action === 'unstar' ? { starred: false } : action === 'pin' ? { pinned: true } : { pinned: false };
    const res = await this.db
      .update(conversations)
      .set({ ...set, updatedAt: this.now() })
      .where(and(inArray(conversations.id, ids), eq(conversations.userId, user.id), isNull(conversations.deletedAt)))
      .returning({ id: conversations.id });
    for (const r of res) await this.bus.publish(user.id, { type: 'conversation.upsert', conversationId: r.id });
    return res.length;
  }

  /** Copy the active branch into a new conversation. */
  async duplicate(user: UserRow, id: string): Promise<ConversationRow> {
    const c = await this.get(user, id);
    const all = await this.messagesOf(id);
    const path = pathTo(all, c.activeLeafId);
    const byId = new Map(all.map((m) => [m.id, m]));
    return this.db.transaction(async (tx) => {
      const [copy] = await tx
        .insert(conversations)
        .values({ userId: user.id, title: `${c.title} (copy)`, titleSource: 'user', modelId: c.modelId, instructions: c.instructions, settings: c.settings, messageCount: path.length })
        .returning();
      let parentId: string | null = null;
      for (const mid of path) {
        const m = byId.get(mid)!;
        const [n]: { id: string }[] = await tx
          .insert(messages)
          .values({ conversationId: copy!.id, parentId, role: m.role, content: m.content, parts: m.parts, status: m.status === 'streaming' ? 'cancelled' : m.status, modelId: m.modelId, modelName: m.modelName, usage: m.usage, createdAt: m.createdAt })
          .returning({ id: messages.id });
        parentId = n!.id;
      }
      const [done] = await tx.update(conversations).set({ activeLeafId: parentId }).where(eq(conversations.id, copy!.id)).returning();
      await this.bus.publish(user.id, { type: 'conversation.upsert', conversationId: copy!.id });
      return done!;
    });
  }

  /** Delete a message and everything below it; the conversation falls back to the parent's newest branch. */
  async deleteMessage(user: UserRow, conversationId: string, messageId: string): Promise<void> {
    const c = await this.get(user, conversationId);
    const all = await this.messagesOf(conversationId);
    const target = all.find((m) => m.id === messageId);
    if (!target) throw new LumenError('NOT_FOUND', 'Message not found.');
    if (target.status === 'streaming') throw new LumenError('CONFLICT', 'Stop the response before deleting it.');
    const doomed = new Set([messageId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of all) if (m.parentId && doomed.has(m.parentId) && !doomed.has(m.id)) {
        doomed.add(m.id);
        grew = true;
      }
    }
    await this.db.delete(messages).where(inArray(messages.id, [...doomed]));
    const remaining = all.filter((m) => !doomed.has(m.id));
    let leaf: string | null = c.activeLeafId && !doomed.has(c.activeLeafId) ? c.activeLeafId : null;
    if (!leaf && target.parentId) leaf = deepestLeaf(remaining, target.parentId);
    if (!leaf && remaining.length) leaf = deepestLeaf(remaining, remaining.find((m) => !m.parentId)!.id);
    await this.db.update(conversations).set({ activeLeafId: leaf, messageCount: remaining.length, updatedAt: this.now() }).where(eq(conversations.id, conversationId));
    if (!c.incognito) await this.bus.publish(user.id, { type: 'conversation.upsert', conversationId });
  }

  async search(user: UserRow, q: z.infer<typeof searchQuerySchema>) {
    const conds: SQL[] = [sql`c.user_id = ${user.id}`, sql`c.deleted_at IS NULL`, sql`c.incognito = false`];
    if (q.archived !== 'any') conds.push(sql`c.archived = ${q.archived === 'true'}`);
    if (q.modelId) conds.push(sql`m.model_id = ${q.modelId}`);
    if (q.from) conds.push(sql`m.created_at >= ${q.from}`);
    if (q.to) conds.push(sql`m.created_at <= ${q.to}`);
    const where = sql.join(conds, sql` AND `);
    // Hits on message content and on titles, best hit per conversation, ranked.
    const rows = (await this.db.execute(sql`
      WITH query AS (SELECT websearch_to_tsquery('simple', ${q.q}) AS tsq),
      hits AS (
        SELECT c.id AS conversation_id, c.title, c.last_message_at, m.id AS message_id, m.role,
               ts_rank(m.content_tsv, query.tsq) + CASE WHEN c.title_tsv @@ query.tsq THEN 0.5 ELSE 0 END AS rank,
               ts_headline('simple', m.content, query.tsq, 'MaxWords=24, MinWords=8, StartSel=<<, StopSel=>>, MaxFragments=1') AS snippet
        FROM messages m JOIN conversations c ON c.id = m.conversation_id, query
        WHERE ${where} AND (m.content_tsv @@ query.tsq OR c.title_tsv @@ query.tsq)
      ),
      best AS (SELECT DISTINCT ON (conversation_id) * FROM hits ORDER BY conversation_id, rank DESC)
      SELECT * FROM best ORDER BY rank DESC, last_message_at DESC LIMIT ${q.limit}
    `)) as unknown as { conversation_id: string; title: string; last_message_at: string | Date; message_id: string; role: string; rank: number; snippet: string }[];
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      title: r.title,
      messageId: r.message_id,
      role: r.role,
      snippet: r.snippet,
      rank: Number(r.rank),
      lastMessageAt: new Date(r.last_message_at).toISOString(),
    }));
  }
}
