import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { conversations } from './chat.js';
import { projects } from './files.js';

export const ARTIFACT_TYPES = ['markdown', 'code', 'html', 'react', 'svg', 'mermaid', 'chart', 'table', 'slides', 'spreadsheet', 'latex'] as const;
export const artifactTypeEnum = pgEnum('artifact_type', ARTIFACT_TYPES);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    type: artifactTypeEnum('type').notNull(),
    title: text('title').notNull(),
    language: text('language'),
    currentVersion: integer('current_version').notNull().default(1),
    /** Set when published: public, unguessable link. */
    publicSlug: text('public_slug'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    forkedFrom: uuid('forked_from'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('artifacts_user_idx').on(t.userId, t.updatedAt), index('artifacts_conversation_idx').on(t.conversationId), uniqueIndex('artifacts_public_slug_unique').on(t.publicSlug)],
);

export const artifactVersions = pgTable(
  'artifact_versions',
  {
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    /** 'ai' | 'user' | 'restore' | 'fork' */
    source: text('source').notNull(),
    label: text('label'),
    basedOn: integer('based_on'),
    messageId: uuid('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.artifactId, t.version] })],
);

/** Small persistent key-value store per artifact and viewer, for AI-powered mini-apps. */
export const artifactStorage = pgTable(
  'artifact_storage',
  {
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    shared: boolean('shared').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.artifactId, t.userId, t.key] })],
);

export type ArtifactRow = typeof artifacts.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersions.$inferSelect;
