import { joinUrl, jsonHeaders, request } from '../http.js';
import { parseSse, parseToolArguments } from '../streams.js';
import { LlmError, type ChatMessage, type EmbeddingResult, type ChatRequest, type FinishReason, type ModelInfo, type ProviderAdapter, type ProviderConfig, type StreamEvent } from '../types.js';

const THINKING_BUDGET = { low: 2048, medium: 8192, high: 24576 } as const;
const API_VERSION = '2023-06-01';

type Block = Record<string, unknown>;

/** Anthropic Messages API (native format). */
export class AnthropicAdapter implements ProviderAdapter {
  readonly type = 'anthropic' as const;
  constructor(private readonly cfg: ProviderConfig) {}

  private headers() {
    return jsonHeaders({ 'x-api-key': this.cfg.apiKey, 'anthropic-version': API_VERSION }, this.cfg.headers);
  }

  /** Converts to Anthropic's alternating user/assistant turns; tool results become user tool_result blocks. */
  static toMessages(messages: ChatMessage[]): { system: string | undefined; messages: { role: 'user' | 'assistant'; content: Block[] }[] } {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content as string).join('\n\n') || undefined;
    const out: { role: 'user' | 'assistant'; content: Block[] }[] = [];
    const push = (role: 'user' | 'assistant', blocks: Block[]) => {
      const last = out[out.length - 1];
      if (last && last.role === role) last.content.push(...blocks);
      else out.push({ role, content: blocks });
    };
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'user') {
        const parts = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
        push(
          'user',
          parts.map((p) =>
            p.type === 'text'
              ? { type: 'text', text: p.text }
              : p.type === 'image'
                ? { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }
                : { type: 'image', source: { type: 'url', url: p.url } },
          ),
        );
      } else if (m.role === 'assistant') {
        const blocks: Block[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
        push('assistant', blocks.length ? blocks : [{ type: 'text', text: '' }]);
      } else {
        push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content, ...(m.isError ? { is_error: true } : {}) }]);
      }
    }
    return { system, messages: out };
  }

  buildBody(req: ChatRequest): Record<string, unknown> {
    const { system, messages } = AnthropicAdapter.toMessages(req.messages);
    const thinking = req.thinking && req.thinking !== 'off' ? THINKING_BUDGET[req.thinking] : 0;
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: Math.max(req.maxTokens ?? 4096, thinking + 1024),
      stream: true,
    };
    if (system) body.system = system;
    if (thinking) body.thinking = { type: 'enabled', budget_tokens: thinking };
    else {
      if (req.temperature !== undefined) body.temperature = Math.min(1, req.temperature);
      if (req.topP !== undefined) body.top_p = req.topP;
    }
    if (req.stop?.length) body.stop_sequences = req.stop;
    if (req.user) body.metadata = { user_id: req.user };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
      if (req.toolChoice && req.toolChoice !== 'none') {
        body.tool_choice =
          req.toolChoice === 'auto' ? { type: 'auto' } : req.toolChoice === 'required' ? { type: 'any' } : { type: 'tool', name: req.toolChoice.name };
      }
    }
    return body;
  }

  async *stream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'v1/messages'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req)),
      signal,
    });
    yield* AnthropicAdapter.parse(res.body!, signal);
  }

  static async *parse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();
    let inputTokens = 0;
    let cached = 0;
    let finish: FinishReason = 'stop';
    for await (const msg of parseSse(body, signal)) {
      const ev = JSON.parse(msg.data) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- provider event union
      switch (ev.type) {
        case 'message_start':
          inputTokens = ev.message?.usage?.input_tokens ?? 0;
          cached = (ev.message?.usage?.cache_read_input_tokens ?? 0) as number;
          break;
        case 'content_block_start': {
          const b = ev.content_block;
          blocks.set(ev.index, { type: b.type, id: b.id, name: b.name, json: '' });
          if (b.type === 'tool_use') yield { type: 'tool-call-start', id: b.id, name: b.name };
          break;
        }
        case 'content_block_delta': {
          const d = ev.delta;
          const b = blocks.get(ev.index);
          if (d.type === 'text_delta') yield { type: 'text-delta', text: d.text };
          else if (d.type === 'thinking_delta') yield { type: 'reasoning-delta', text: d.thinking };
          else if (d.type === 'input_json_delta' && b) {
            b.json += d.partial_json;
            yield { type: 'tool-call-delta', id: b.id!, argumentsDelta: d.partial_json };
          }
          break;
        }
        case 'content_block_stop': {
          const b = blocks.get(ev.index);
          if (b?.type === 'tool_use') yield { type: 'tool-call', call: { id: b.id!, name: b.name!, arguments: parseToolArguments(b.json) } };
          break;
        }
        case 'message_delta':
          if (ev.delta?.stop_reason) finish = mapStop(ev.delta.stop_reason);
          if (ev.usage) {
            yield {
              type: 'usage',
              usage: { inputTokens: inputTokens + cached, outputTokens: ev.usage.output_tokens ?? 0, ...(cached ? { cachedInputTokens: cached } : {}) },
            };
          }
          break;
        case 'error':
          throw new LlmError(ev.error?.type === 'overloaded_error' ? 'overloaded' : 'server', ev.error?.message ?? 'Provider stream error');
        default:
          break;
      }
    }
    yield { type: 'finish', reason: finish };
  }

  async embed(): Promise<EmbeddingResult> {
    throw new LlmError('invalid_request', 'Anthropic does not offer an embeddings API. Choose another embedding provider.');
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'v1/models?limit=1000'), { headers: this.headers(), signal });
    const j = (await res.json()) as { data?: { id: string; display_name?: string }[] };
    return (j.data ?? []).map((m) => ({ id: m.id, displayName: m.display_name ?? m.id, capabilities: { vision: true, tools: true } }));
  }
}

function mapStop(r: string): FinishReason {
  if (r === 'max_tokens') return 'length';
  if (r === 'tool_use') return 'tool_calls';
  if (r === 'refusal') return 'content_filter';
  return 'stop';
}
