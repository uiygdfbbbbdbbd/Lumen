import { AnthropicAdapter } from './adapters/anthropic.js';
import { CohereAdapter } from './adapters/cohere.js';
import { GeminiAdapter } from './adapters/gemini.js';
import { OllamaAdapter } from './adapters/ollama.js';
import { OpenAIAdapter } from './adapters/openai.js';
import type { ChatRequest, FinishReason, ProviderAdapter, ProviderConfig, ProviderType, ToolCall, Usage } from './types.js';

/** Sensible defaults shown in the admin "add provider" form. */
export const PROVIDER_PRESETS: Record<ProviderType, { label: string; baseUrl: string; needsKey: boolean; description: string }> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true, description: 'OpenAI Chat Completions API.' },
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true, description: 'Anthropic Messages API.' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', needsKey: true, description: 'Gemini API (AI Studio key).' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', needsKey: true, description: 'Mistral (OpenAI-compatible).' },
  cohere: { label: 'Cohere', baseUrl: 'https://api.cohere.com', needsKey: true, description: 'Cohere Chat API v2.' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, description: 'Many models through one key.' },
  ollama: { label: 'Ollama', baseUrl: 'http://localhost:11434', needsKey: false, description: 'Local models via Ollama.' },
  vllm: { label: 'vLLM', baseUrl: 'http://localhost:8000/v1', needsKey: false, description: 'Self-hosted vLLM (OpenAI-compatible).' },
  lmstudio: { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', needsKey: false, description: 'LM Studio local server.' },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: 'https://', needsKey: false, description: 'Any OpenAI-compatible endpoint.' },
};

export const PROVIDER_TYPES = Object.keys(PROVIDER_PRESETS) as ProviderType[];

export function createAdapter(cfg: ProviderConfig): ProviderAdapter {
  switch (cfg.type) {
    case 'anthropic':
      return new AnthropicAdapter(cfg);
    case 'gemini':
      return new GeminiAdapter(cfg);
    case 'ollama':
      return new OllamaAdapter(cfg);
    case 'cohere':
      return new CohereAdapter(cfg);
    default:
      return new OpenAIAdapter(cfg, cfg.type);
  }
}

export interface Completion {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason: FinishReason;
}

/** Drain a stream into a single result (non-streaming API calls, titles, tests). */
export async function complete(adapter: ProviderAdapter, req: ChatRequest, signal?: AbortSignal): Promise<Completion> {
  const out: Completion = { text: '', reasoning: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'stop' };
  for await (const ev of adapter.stream(req, signal)) {
    if (ev.type === 'text-delta') out.text += ev.text;
    else if (ev.type === 'reasoning-delta') out.reasoning += ev.text;
    else if (ev.type === 'tool-call') out.toolCalls.push(ev.call);
    else if (ev.type === 'usage') out.usage = ev.usage;
    else if (ev.type === 'finish') out.finishReason = ev.reason;
  }
  return out;
}
