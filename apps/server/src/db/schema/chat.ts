import { sql } from 'drizzle-orm';
import { boolean, customType, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);
export const messageStatusEnum = pgEnum('message_status', ['complete', 'streaming', 'error', 'cancelled']);

export interface ConversationSettings {
  thinkingEffort?: 'off' | 'low' | 'medium' | 'high';
  temperature?: number;
  styleId?: string;
  useMemory?: boolean;
}

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New chat'),
    titleSource: text('title_source').notNull().default('default'),
    modelId: text('model_id'),
    instructions: text('instructions').notNull().default(''),
    settings: jsonb('settings').$type<ConversationSettings>().notNull().default({}),
    pinned: boolean('pinned').notNull().default(false),
    starred: boolean('starred').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    incognito: boolean('incognito').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    activeLeafId: uuid('active_leaf_id'),
    /** Project the chat belongs to (FK added in the files migration to avoid a circular import). */
    projectId: uuid('project_id'),
    messageCount: integer('message_count').notNull().default(0),
    /** Soft delete enables "undo"; a cleanup job purges after the undo window. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    titleTsv: tsvector('title_tsv').generatedAlwaysAs(sql`to_tsvector('simple', coalesce(title, ''))`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversations_user_recent_idx').on(t.userId, t.lastMessageAt),
    index('conversations_title_tsv_idx').using('gin', t.titleTsv),
    index('conversations_expires_idx').on(t.expiresAt),
    index('conversations_project_idx').on(t.projectId),
  ],
);

export interface MessagePart {
  type: 'reasoning' | 'tool_call' | 'tool_result' | 'text_segment' | 'citation' | 'attachment' | 'compaction';
  [key: string]: unknown;
}

export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  firstTokenMs?: number;
}

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull().default(''),
    parts: jsonb('parts').$type<MessagePart[]>().notNull().default([]),
    status: messageStatusEnum('status').notNull().default('complete'),
    error: jsonb('error').$type<{ code: string; message: string; resetAt?: string } | null>(),
    /** Model actually used (after alias resolution / fallback). */
    modelId: uuid('model_id'),
    modelName: text('model_name'),
    usage: jsonb('usage').$type<MessageUsage | null>(),
    rating: smallint('rating'),
    ratingReason: text('rating_reason'),
    /** Groups assistant siblings created together by compare mode. */
    compareGroup: uuid('compare_group'),
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(sql`to_tsvector('simple', coalesce(content, ''))`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    index('messages_parent_idx').on(t.parentId),
    index('messages_content_tsv_idx').using('gin', t.contentTsv),
  ],
);

/** Summary of older turns that replaces them in the model context once a conversation grows too long. */
export const compactions = pgTable(
  'compactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** The summary covers the path up to and including this message. */
    throughMessageId: uuid('through_message_id').notNull(),
    summary: text('summary').notNull(),
    tokensBefore: integer('tokens_before').notNull(),
    tokensAfter: integer('tokens_after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('compactions_conversation_idx').on(t.conversationId)],
);

export const styles = pgTable(
  'styles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('styles_user_idx').on(t.userId)],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
