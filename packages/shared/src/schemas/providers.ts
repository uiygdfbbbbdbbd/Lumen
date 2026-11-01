import { z } from 'zod';
import { patchOf } from './common.js';

export const PROVIDER_TYPE_VALUES = ['openai', 'anthropic', 'gemini', 'ollama', 'cohere', 'mistral', 'openrouter', 'vllm', 'lmstudio', 'custom', 'stability', 'replicate', 'comfyui'] as const;
export const MODEL_VISIBILITY = ['everyone', 'verified', 'admins', 'beta'] as const;

const headerName = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, 'Invalid header name');
/** Headers that would let an admin break auth or smuggle requests are refused. */
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'cookie']);

export const providerInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(PROVIDER_TYPE_VALUES),
  description: z.string().trim().max(500).default(''),
  baseUrl: z.string().trim().url().max(500),
  apiKey: z.string().trim().max(4096).optional(),
  headers: z
    .record(headerName, z.string().max(2048))
    .refine((h) => Object.keys(h).every((k) => !FORBIDDEN_HEADERS.has(k.toLowerCase())), 'Header not allowed')
    .refine((h) => Object.keys(h).length <= 20, 'Too many headers')
    .optional(),
  organization: z.string().trim().max(200).nullable().optional(),
  project: z.string().trim().max(200).nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
  maxRetries: z.number().int().min(0).max(5).default(2),
  region: z.string().trim().max(64).nullable().optional(),
  allowPrivateNetwork: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  notes: z.string().max(4000).default(''),
  iconUrl: z.string().url().max(1000).optional(),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;
export const providerPatchSchema = patchOf(
  providerInputSchema.extend({
    /** Explicit null removes the stored key. Omitted keeps it. */
    apiKey: z.string().trim().max(4096).nullable(),
    headers: z
      .record(headerName, z.string().max(2048))
      .refine((h) => Object.keys(h).every((k) => !FORBIDDEN_HEADERS.has(k.toLowerCase())), 'Header not allowed')
      .nullable(),
  }),
);
export type ProviderPatch = z.infer<typeof providerPatchSchema>;

export const providerKeyInputSchema = z.object({
  label: z.string().trim().min(1).max(60).default('Key'),
  apiKey: z.string().trim().min(1).max(4096),
  weight: z.number().int().min(1).max(100).default(1),
  monthlySpendCapUsd: z.number().min(0).max(1_000_000).nullable().default(null),
  enabled: z.boolean().default(true),
});
export const providerKeyPatchSchema = patchOf(providerKeyInputSchema.omit({ apiKey: true }));

export const capabilitiesSchema = z.object({
  vision: z.boolean().default(false),
  tools: z.boolean().default(false),
  json: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  audio: z.boolean().default(false),
  imageGen: z.boolean().default(false),
});

export const modelInputSchema = z.object({
  providerModelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(''),
  contextWindow: z.number().int().min(256).max(10_000_000).default(8192),
  maxOutputTokens: z.number().int().min(16).max(1_000_000).default(4096),
  capabilities: capabilitiesSchema.default({ vision: false, tools: false, json: false, reasoning: false, audio: false, imageGen: false }),
  pricing: z.object({ inputPer1M: z.number().min(0), outputPer1M: z.number().min(0), cachedInputPer1M: z.number().min(0).optional() }).nullable().default(null),
  systemPromptPrefix: z.string().max(8000).default(''),
  defaultParams: z
    .object({ temperature: z.number().min(0).max(2).optional(), topP: z.number().min(0).max(1).optional(), maxTokens: z.number().int().min(1).max(1_000_000).optional() })
    .default({}),
  enabled: z.boolean().default(true),
  visibility: z.enum(MODEL_VISIBILITY).default('everyone'),
  tags: z.array(z.string().trim().min(1).max(24)).max(10).default([]),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  recommended: z.boolean().default(false),
  rpmLimit: z.number().int().min(1).max(100_000).nullable().default(null),
  dailyTokenCap: z.number().int().min(1).nullable().default(null),
  fallbackModelIds: z.array(z.string().uuid()).max(5).default([]),
  deprecationDate: z.string().date().nullable().default(null),
  deprecationMessage: z.string().max(500).nullable().default(null),
  replacementModelId: z.string().uuid().nullable().default(null),
  iconUrl: z.string().url().max(1000).optional(),
});
export type ModelInput = z.infer<typeof modelInputSchema>;
export const modelPatchSchema = patchOf(modelInputSchema);

export const aliasInputSchema = z.object({
  alias: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,47}$/, 'Lowercase letters, digits, dot, dash, underscore'),
  modelId: z.string().uuid(),
  description: z.string().max(200).default(''),
});

/** What end users see in the model picker. */
export interface ModelSummary {
  id: string;
  displayName: string;
  description: string;
  providerId: string;
  providerName: string;
  providerType: string;
  iconUrl: string | null;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: z.infer<typeof capabilitiesSchema>;
  tags: string[];
  recommended: boolean;
  available: boolean;
  lockedReason: 'EMAIL_UNVERIFIED' | 'ADMINS_ONLY' | 'BETA_ONLY' | 'PROVIDER_DOWN' | null;
  deprecation: { date: string; message: string | null; replacementModelId: string | null } | null;
  aliases: string[];
}
