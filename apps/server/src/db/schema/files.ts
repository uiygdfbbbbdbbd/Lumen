import { sql } from 'drizzle-orm';
import { bigint, boolean, customType, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { conversations, messages } from './chat.js';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
/** Dimension-less pgvector column: any embedding model can be used; searches are owner-scoped exact scans. */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: (v) => `[${v.join(',')}]`,
  fromDriver: (v) => JSON.parse(v) as number[],
});

export const fileStatusEnum = pgEnum('file_status', ['uploading', 'queued', 'processing', 'ready', 'failed', 'quarantined']);
export const fileKindEnum = pgEnum('file_kind', ['image', 'pdf', 'document', 'presentation', 'spreadsheet', 'text', 'code', 'html', 'ebook', 'data', 'audio', 'video', 'archive', 'url', 'note', 'other']);
export const projectRoleEnum = pgEnum('project_role', ['viewer', 'editor', 'owner']);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default('folder'),
    color: text('color').notNull().default('#5b4bdb'),
    instructions: text('instructions').notNull().default(''),
    defaultModelId: text('default_model_id'),
    defaultStyleId: text('default_style_id'),
    templateId: text('template_id'),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('projects_owner_idx').on(t.ownerId)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user_idx').on(t.userId)],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    kind: fileKindEnum('kind').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key'),
    /** For URL knowledge sources. */
    sourceUrl: text('source_url'),
    recrawlHours: integer('recrawl_hours'),
    lastCrawledAt: timestamp('last_crawled_at', { withTimezone: true }),
    status: fileStatusEnum('status').notNull().default('queued'),
    error: text('error'),
    /** Extracted plain text (bounded) for inlining small files and previews. */
    text: text('text'),
    tokenCount: integer('token_count').notNull().default(0),
    pageCount: integer('page_count'),
    chunkCount: integer('chunk_count').notNull().default(0),
    embedded: boolean('embedded').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('files_user_idx').on(t.userId, t.createdAt), index('files_project_idx').on(t.projectId), index('files_user_sha_idx').on(t.userId, t.sha256)],
);

export const fileChunks = pgTable(
  'file_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    projectId: uuid('project_id'),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    location: jsonb('location').$type<{ page?: number; section?: string; startLine?: number }>().notNull().default({}),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(sql`to_tsvector('simple', coalesce(content, ''))`),
  },
  (t) => [
    index('file_chunks_file_idx').on(t.fileId, t.ordinal),
    index('file_chunks_user_idx').on(t.userId),
    index('file_chunks_project_idx').on(t.projectId),
    index('file_chunks_tsv_idx').using('gin', t.contentTsv),
  ],
);

/** Resumable (tus-like) uploads: chunks are appended at an offset until complete. */
export const uploadSessions = pgTable('upload_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id'),
  name: text('name').notNull(),
  declaredMime: text('declared_mime').notNull(),
  totalBytes: bigint('total_bytes', { mode: 'number' }).notNull(),
  receivedBytes: bigint('received_bytes', { mode: 'number' }).notNull().default(0),
  partCount: integer('part_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversationFiles = pgTable(
  'conversation_files',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    /** 'auto' inlines small files and retrieves from big ones; 'inline' / 'retrieval' force a mode. */
    mode: text('mode').notNull().default('auto'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('conversation_files_unique').on(t.conversationId, t.fileId)],
);

export type FileRow = typeof files.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
