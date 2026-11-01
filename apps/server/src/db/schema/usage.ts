import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** One row per model call. Source of truth for quotas per model, cost tracking and analytics. */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),
    source: text('source').notNull(),
    conversationId: uuid('conversation_id'),
    messageId: uuid('message_id'),
    modelId: uuid('model_id'),
    providerId: uuid('provider_id'),
    providerKeyId: uuid('provider_key_id'),
    apiKeyId: uuid('api_key_id'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 14, scale: 8, mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms'),
    firstTokenMs: integer('first_token_ms'),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_events_created_idx').on(t.createdAt),
    index('usage_events_model_idx').on(t.modelId, t.createdAt),
    index('usage_events_user_idx').on(t.userId, t.createdAt),
  ],
);
