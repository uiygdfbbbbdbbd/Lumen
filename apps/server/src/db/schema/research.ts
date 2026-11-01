import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { conversations, messages } from './chat.js';

export const researchStatusEnum = pgEnum('research_status', ['queued', 'running', 'done', 'failed', 'cancelled']);

export interface ResearchSource {
  n: number;
  url: string;
  title: string;
  siteName: string;
  snippet: string;
}

/** A Deep Research run: a durable background job that ends in a cited report artifact. */
export const researchRuns = pgTable(
  'research_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    /** Assistant message that shows progress and, at the end, the summary. */
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    depth: text('depth').$type<'quick' | 'standard' | 'deep'>().notNull().default('standard'),
    modelRef: text('model_ref'),
    status: researchStatusEnum('status').notNull().default('queued'),
    step: text('step').$type<'queued' | 'planning' | 'searching' | 'reading' | 'writing' | 'done'>().notNull().default('queued'),
    plan: jsonb('plan').$type<string[]>().notNull().default([]),
    sources: jsonb('sources').$type<ResearchSource[]>().notNull().default([]),
    progress: jsonb('progress').$type<{ message: string; done: number; total: number }>().notNull().default({ message: 'Queued', done: 0, total: 0 }),
    blockedDomains: jsonb('blocked_domains').$type<string[]>().notNull().default([]),
    artifactId: uuid('artifact_id'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('research_runs_user_idx').on(t.userId, t.createdAt), index('research_runs_status_idx').on(t.status)],
);

export type ResearchRunRow = typeof researchRuns.$inferSelect;
