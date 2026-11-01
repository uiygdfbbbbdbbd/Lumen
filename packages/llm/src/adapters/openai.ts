import { openAiImages, type ImageRequest, type ImageResult } from '../images.js';
import { joinUrl, jsonHeaders, request } from '../http.js';
import { parseSse, parseToolArguments } from '../streams.js';
import { LlmError, type ChatMessage, type EmbeddingResult, type ChatRequest, type FinishReason, type ModelInfo, type ProviderAdapter, type ProviderConfig, type ProviderType, type StreamEvent } from '../types.js';

/** OpenAI Chat Completions, also used for OpenAI-compatible servers (Mistral, OpenRouter, vLLM, LM Studio, Ollama /v1...). */
export class OpenAIAdapter implements ProviderAdapter {
  constructor(private readonly cfg: ProviderConfig, readonly type: ProviderType = 'openai') {}

  private headers() {
    return jsonHeaders(
      {
        authorization: this.cfg.apiKey ? `Bearer ${this.cfg.apiKey}` : null,
        'openai-organization': this.cfg.organization,
        'openai-project': this.cfg.project,
      },
      this.cfg.headers,
    );
  }

  static toMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => {
      switch (m.role) {
        case 'system':
          return { role: 'system', content: m.content };
        case 'user':
          return {
            role: 'user',
            content:
              typeof m.content === 'string'
                ? m.content
                : m.content.map((p) =>
                    p.type === 'text'
                      ? { type: 'text', text: p.text }
                      : { type: 'image_url', image_url: { url: p.type === 'image_url' ? p.url : `data:${p.mediaType};base64,${p.data}` } },
                  ),
          };
        case 'assistant':
          return {
            role: 'assistant',
            content: m.content || (m.toolCalls?.length ? null : ''),
            ...(m.toolCalls?.length
              ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
              : {}),
          };
        case 'tool':
          return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
      }
    });
  }

  buildBody(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: OpenAIAdapter.toMessages(req.messages),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.maxTokens !== undefined) body[this.type === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens;
    if (req.stop?.length) body.stop = req.stop;
    if (req.user) body.user = req.user;
    if (req.responseFormat === 'json') body.response_format = { type: 'json_object' };
    if (req.thinking && req.thinking !== 'off') body.reasoning_effort = req.thinking;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      if (req.toolChoice) body.tool_choice = typeof req.toolChoice === 'string' ? req.toolChoice : { type: 'function', function: { name: req.toolChoice.name } };
    }
    return body;
  }

  async *stream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req)),
      signal,
    });
    yield* OpenAIAdapter.parse(res.body!, signal);
  }

  static async *parse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finish: FinishReason | null = null;
    for await (const msg of parseSse(body, signal)) {
      if (msg.data === '[DONE]') break;
      const chunk = JSON.parse(msg.data) as {
        error?: { message?: string };
        choices?: { delta?: { content?: string | null; reasoning_content?: string; reasoning?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } } | null;
      };
      if (chunk.error) throw new LlmError('server', chunk.error.message ?? 'Provider stream error');
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (reasoning) yield { type: 'reasoning-delta', text: reasoning };
      if (delta?.content) yield { type: 'text-delta', text: delta.content };
      for (const tc of delta?.tool_calls ?? []) {
        let entry = calls.get(tc.index);
        if (!entry) {
          entry = { id: tc.id ?? `call_${tc.index}`, name: tc.function?.name ?? '', args: '' };
          calls.set(tc.index, entry);
          yield { type: 'tool-call-start', id: entry.id, name: entry.name };
        } else if (tc.function?.name) entry.name += tc.function.name;
        if (tc.function?.arguments) {
          entry.args += tc.function.arguments;
          yield { type: 'tool-call-delta', id: entry.id, argumentsDelta: tc.function.arguments };
        }
      }
      if (choice?.finish_reason) finish = mapFinish(choice.finish_reason);
      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            ...(chunk.usage.completion_tokens_details?.reasoning_tokens ? { reasoningTokens: chunk.usage.completion_tokens_details.reasoning_tokens } : {}),
            ...(chunk.usage.prompt_tokens_details?.cached_tokens ? { cachedInputTokens: chunk.usage.prompt_tokens_details.cached_tokens } : {}),
          },
        };
      }
    }
    for (const c of calls.values()) yield { type: 'tool-call', call: { id: c.id, name: c.name, arguments: parseToolArguments(c.args) } };
    yield { type: 'finish', reason: finish ?? (calls.size ? 'tool_calls' : 'stop') };
  }

  async embed(model: string, inputs: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'embeddings'), { method: 'POST', headers: this.headers(), body: JSON.stringify({ model, input: inputs }), signal });
    const j = (await res.json()) as { data: { index: number; embedding: number[] }[]; usage?: { prompt_tokens?: number } };
    return { vectors: [...j.data].sort((a, b) => a.index - b.index).map((d) => d.embedding), inputTokens: j.usage?.prompt_tokens ?? 0 };
  }

  async generateImages(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
    return openAiImages(this.cfg, this.headers(), req, signal);
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'models'), { headers: this.headers(), signal });
    const j = (await res.json()) as { data?: { id: string; context_length?: number; name?: string }[] };
    return (j.data ?? []).map((m) => ({ id: m.id, ...(m.name ? { displayName: m.name } : {}), ...(m.context_length ? { contextWindow: m.context_length } : {}) }));
  }
}

function mapFinish(r: string): FinishReason {
  if (r === 'length') return 'length';
  if (r === 'tool_calls' || r === 'function_call') return 'tool_calls';
  if (r === 'content_filter') return 'content_filter';
  return 'stop';
}
