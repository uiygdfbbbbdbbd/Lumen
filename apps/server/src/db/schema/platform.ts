import { bigint, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Feature, TierLimits } from '@lumen/shared';
import { users } from './users.js';

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

export const tiers = pgTable('tiers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  features: jsonb('features').$type<Partial<Record<Feature, boolean>>>().notNull(),
  limits: jsonb('limits').$type<TierLimits>().notNull(),
  builtin: boolean('builtin').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inviteCodes = pgTable('invite_codes', {
  code: text('code').primaryKey(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  maxUses: integer('max_uses').notNull().default(1),
  uses: integer('uses').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailLogs = pgTable(
  'email_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    to: text('to').notNull(),
    template: text('template').notNull(),
    subject: text('subject').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    providerMessageId: text('provider_message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_logs_created_idx').on(t.createdAt), index('email_logs_to_idx').on(t.to, t.createdAt)],
);

/** Per-user daily counters used for quota enforcement (messages, tokens, images, sandbox seconds...). */
export const usageCounters = pgTable(
  'usage_counters',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    metric: text('metric').notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.metric] })],
);
