import { joinUrl, jsonHeaders, request } from '../http.js';
import { parseSse, parseToolArguments } from '../streams.js';
import { LlmError, type ChatMessage, type ChatRequest, type FinishReason, type ModelInfo, type ProviderAdapter, type ProviderConfig, type StreamEvent } from '../types.js';

/** Cohere Chat API v2 (SSE). */
export class CohereAdapter implements ProviderAdapter {
  readonly type = 'cohere' as const;
  constructor(private readonly cfg: ProviderConfig) {}

  private headers() {
    return jsonHeaders({ authorization: this.cfg.apiKey ? `Bearer ${this.cfg.apiKey}` : null }, this.cfg.headers);
  }

  static toMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => {
      if (m.role === 'user') {
        return { role: 'user', content: typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: p.type === 'image_url' ? p.url : `data:${p.mediaType};base64,${p.data}` } })) };
      }
      if (m.role === 'assistant') {
        return {
          role: 'assistant',
          ...(m.content ? { content: m.content } : {}),
          ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}),
        };
      }
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
      return { role: 'system', content: m.content };
    });
  }

  buildBody(req: ChatRequest): Record<string, unknown> {
    return {
      model: req.model,
      messages: CohereAdapter.toMessages(req.messages),
      stream: true,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.topP !== undefined ? { p: req.topP } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.stop?.length ? { stop_sequences: req.stop } : {}),
      ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
    };
  }

  async *stream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'v2/chat'), { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildBody(req)), signal });
    yield* CohereAdapter.parse(res.body!, signal);
  }

  static async *parse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finish: FinishReason = 'stop';
    for await (const msg of parseSse(body, signal)) {
      const ev = JSON.parse(msg.data) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- provider event union
      const tc = ev.delta?.message?.tool_calls;
      switch (ev.type) {
        case 'content-delta':
          if (ev.delta?.message?.content?.text) yield { type: 'text-delta', text: ev.delta.message.content.text };
          break;
        case 'tool-call-start':
          calls.set(ev.index ?? calls.size, { id: tc.id, name: tc.function.name, args: tc.function.arguments ?? '' });
          yield { type: 'tool-call-start', id: tc.id, name: tc.function.name };
          break;
        case 'tool-call-delta': {
          const c = calls.get(ev.index ?? calls.size - 1);
          if (c && tc?.function?.arguments) {
            c.args += tc.function.arguments;
            yield { type: 'tool-call-delta', id: c.id, argumentsDelta: tc.function.arguments };
          }
          break;
        }
        case 'tool-call-end': {
          const c = calls.get(ev.index ?? calls.size - 1);
          if (c) yield { type: 'tool-call', call: { id: c.id, name: c.name, arguments: parseToolArguments(c.args) } };
          break;
        }
        case 'message-end': {
          const r = ev.delta?.finish_reason as string | undefined;
          finish = r === 'MAX_TOKENS' ? 'length' : r === 'TOOL_CALL' ? 'tool_calls' : r === 'ERROR' ? 'error' : 'stop';
          const u = ev.delta?.usage?.billed_units ?? ev.delta?.usage?.tokens;
          if (u) yield { type: 'usage', usage: { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } };
          break;
        }
        case 'error':
          throw new LlmError('server', ev.message ?? 'Provider stream error');
        default:
          break;
      }
    }
    yield { type: 'finish', reason: finish };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'v1/models?endpoint=chat'), { headers: this.headers(), signal });
    const j = (await res.json()) as { models?: { name: string; context_length?: number }[] };
    return (j.models ?? []).map((m) => ({ id: m.name, ...(m.context_length ? { contextWindow: m.context_length } : {}) }));
  }
}
