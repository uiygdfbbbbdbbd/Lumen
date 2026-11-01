/** Provider-neutral request/response model. Every adapter converts to and from these shapes. */

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'cohere' | 'mistral' | 'openrouter' | 'vllm' | 'lmstudio' | 'custom';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string } // base64
  | { type: 'image_url'; url: string };

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; reasoning?: string }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high';

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  thinking?: ThinkingEffort;
  responseFormat?: 'text' | 'json';
  /** End-user id forwarded to providers that support abuse attribution. */
  user?: string;
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | 'cancelled';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-delta'; id: string; argumentsDelta: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'usage'; usage: Usage }
  | { type: 'finish'; reason: FinishReason };

export interface ModelInfo {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: Partial<ModelCapabilities>;
}

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  json: boolean;
  reasoning: boolean;
  audio: boolean;
  imageGen: boolean;
}

export interface ProviderConfig {
  type: ProviderType;
  baseUrl: string;
  apiKey?: string | null;
  headers?: Record<string, string>;
  organization?: string | null;
  project?: string | null;
  timeoutMs?: number;
  /** Injected fetch (the server passes an SSRF-safe one). */
  fetch?: typeof fetch;
}

export interface EmbeddingResult {
  vectors: number[][];
  inputTokens: number;
}

export interface ProviderAdapter {
  readonly type: ProviderType;
  stream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  /** Text embeddings. Providers without an embeddings API throw LlmError('invalid_request'). */
  embed(model: string, inputs: string[], signal?: AbortSignal): Promise<EmbeddingResult>;
}

/** Errors are normalized so the UI can show "rate limited", "quota", "provider down" etc. */
export type LlmErrorKind = 'auth' | 'rate_limit' | 'quota' | 'invalid_request' | 'not_found' | 'content_filter' | 'overloaded' | 'timeout' | 'network' | 'server' | 'unknown';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }

  /** Whether trying again (same or fallback provider) can help. */
  get retryable(): boolean {
    return ['rate_limit', 'overloaded', 'timeout', 'network', 'server'].includes(this.kind);
  }
}

export function errorKindForStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 422 || status === 400) return 'invalid_request';
  if (status === 429) return 'rate_limit';
  if (status === 529 || status === 503) return 'overloaded';
  if (status >= 500) return 'server';
  return 'unknown';
}
