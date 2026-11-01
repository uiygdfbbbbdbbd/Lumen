import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { conversations } from './chat.js';
import { projects } from './files.js';
import { tsvector, vector } from './columns.js';

export const memoryCategoryEnum = pgEnum('memory_category', ['profile', 'preferences', 'projects', 'people', 'tasks', 'other']);
export const memorySourceEnum = pgEnum('memory_source', ['ai', 'user', 'import', 'consolidation']);

/** Durable facts the assistant keeps about a user. Hard-deleted on "forget" (no tombstones). */
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Null = global; otherwise only used inside this project (deleted with it). */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    category: memoryCategoryEnum('category').notNull().default('other'),
    content: text('content').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    source: memorySourceEnum('source').notNull().default('ai'),
    /** Provenance: where it was learned. */
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    messageId: uuid('message_id'),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(sql`to_tsvector('simple', coalesce(content, ''))`),
    useCount: integer('use_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('memories_user_idx').on(t.userId, t.updatedAt), index('memories_project_idx').on(t.userId, t.projectId)],
);

/** One readable summary per user, rewritten by consolidation. */
export const memorySummaries = pgTable('memory_summaries', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull().default(''),
  memoryCount: integer('memory_count').notNull().default(0),
  /** Writes since the last consolidation; consolidation is queued when this passes a threshold. */
  pendingWrites: integer('pending_writes').notNull().default(0),
  consolidatedAt: timestamp('consolidated_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MemoryRow = typeof memories.$inferSelect;
