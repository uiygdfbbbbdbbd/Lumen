export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'cohere' | 'mistral' | 'openrouter' | 'vllm' | 'lmstudio' | 'custom';

export interface ProviderKeyView {
  id: string;
  label: string;
  keyPreview: string;
  weight: number;
  enabled: boolean;
  monthlySpendCapUsd: number | null;
  spentUsd: number;
  cooldownUntil: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
}

export interface ProviderView {
  id: string;
  name: string;
  type: ProviderType;
  description: string;
  iconUrl: string | null;
  baseUrl: string;
  headerNames: string[];
  organization: string | null;
  project: string | null;
  timeoutMs: number;
  maxRetries: number;
  region: string | null;
  allowPrivateNetwork: boolean;
  enabled: boolean;
  sortOrder: number;
  notes: string;
  health: { status: 'unknown' | 'healthy' | 'degraded' | 'down'; lastCheckedAt: string | null; latencyMs: number | null; error: string | null; circuit: string };
  keys: ProviderKeyView[];
  modelCount: number;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  modelCount: number;
  sampleModels: string[];
  completion: string | null;
  error: { kind: string; message: string } | null;
}

export interface Presets {
  presets: Record<ProviderType, { label: string; baseUrl: string; needsKey: boolean; description: string }>;
  allowPrivate: boolean;
}
