import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const providerTypeEnum = pgEnum('provider_type', ['openai', 'anthropic', 'gemini', 'ollama', 'cohere', 'mistral', 'openrouter', 'vllm', 'lmstudio', 'custom', 'stability', 'replicate', 'comfyui']);
export const healthStatusEnum = pgEnum('health_status', ['unknown', 'healthy', 'degraded', 'down']);
export const modelVisibilityEnum = pgEnum('model_visibility', ['everyone', 'verified', 'admins', 'beta']);

export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: providerTypeEnum('type').notNull(),
  description: text('description').notNull().default(''),
  iconKey: text('icon_key'),
  baseUrl: text('base_url').notNull(),
  /** Encrypted JSON object of extra headers (may contain secrets). */
  headersEnc: text('headers_enc'),
  organization: text('organization'),
  project: text('project'),
  timeoutMs: integer('timeout_ms').notNull().default(120_000),
  maxRetries: integer('max_retries').notNull().default(2),
  region: text('region'),
  /** Admin opt-in for private/loopback targets (e.g. local Ollama). Also requires ALLOW_PRIVATE_PROVIDER_URLS. */
  allowPrivateNetwork: boolean('allow_private_network').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  notes: text('notes').notNull().default(''),
  healthStatus: healthStatusEnum('health_status').notNull().default('unknown'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastLatencyMs: integer('last_latency_ms'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Several keys per provider enable weighted round-robin, failover and per-key spend caps. */
export const providerKeys = pgTable(
  'provider_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default('Primary'),
    keyEnc: text('key_enc').notNull(),
    keyPreview: text('key_preview').notNull(),
    weight: integer('weight').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),
    monthlySpendCapUsd: numeric('monthly_spend_cap_usd', { precision: 12, scale: 4, mode: 'number' }),
    spentUsd: numeric('spent_usd', { precision: 14, scale: 6, mode: 'number' }).notNull().default(0),
    spendMonth: text('spend_month'),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('provider_keys_provider_idx').on(t.providerId)],
);

export interface ModelCapabilitiesRow {
  vision: boolean;
  tools: boolean;
  json: boolean;
  reasoning: boolean;
  audio: boolean;
  imageGen: boolean;
}

export const models = pgTable(
  'models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    providerModelId: text('provider_model_id').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull().default(''),
    iconKey: text('icon_key'),
    contextWindow: integer('context_window').notNull().default(8192),
    maxOutputTokens: integer('max_output_tokens').notNull().default(4096),
    capabilities: jsonb('capabilities').$type<ModelCapabilitiesRow>().notNull(),
    pricing: jsonb('pricing').$type<{ inputPer1M: number; outputPer1M: number; cachedInputPer1M?: number } | null>(),
    systemPromptPrefix: text('system_prompt_prefix').notNull().default(''),
    defaultParams: jsonb('default_params').$type<{ temperature?: number; topP?: number; maxTokens?: number }>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    visibility: modelVisibilityEnum('visibility').notNull().default('everyone'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    recommended: boolean('recommended').notNull().default(false),
    rpmLimit: integer('rpm_limit'),
    dailyTokenCap: integer('daily_token_cap'),
    fallbackModelIds: jsonb('fallback_model_ids').$type<string[]>().notNull().default([]),
    deprecationDate: date('deprecation_date'),
    deprecationMessage: text('deprecation_message'),
    replacementModelId: uuid('replacement_model_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('models_provider_model_unique').on(t.providerId, t.providerModelId), index('models_enabled_idx').on(t.enabled)],
);

/** Stable names ("smart", "fast") that admins can repoint without breaking users or API clients. */
export const modelAliases = pgTable('model_aliases', {
  alias: text('alias').primaryKey(),
  modelId: uuid('model_id')
    .notNull()
    .references(() => models.id, { onDelete: 'cascade' }),
  description: text('description').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ProviderRow = typeof providers.$inferSelect;
export type ProviderKeyRow = typeof providerKeys.$inferSelect;
export type ModelRow = typeof models.$inferSelect;
