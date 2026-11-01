import { joinUrl, jsonHeaders, request } from '../http.js';
import { parseNdjson } from '../streams.js';
import { LlmError, type ChatMessage, type ChatRequest, type ModelInfo, type ProviderAdapter, type ProviderConfig, type StreamEvent } from '../types.js';

interface OllamaChunk {
  message?: { content?: string; thinking?: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/** Ollama native /api/chat (NDJSON streaming). */
export class OllamaAdapter implements ProviderAdapter {
  readonly type = 'ollama' as const;
  constructor(private readonly cfg: ProviderConfig) {}

  private headers() {
    return jsonHeaders({ authorization: this.cfg.apiKey ? `Bearer ${this.cfg.apiKey}` : null }, this.cfg.headers);
  }

  static toMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => {
      if (m.role === 'user' && Array.isArray(m.content)) {
        return {
          role: 'user',
          content: m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n'),
          images: m.content.filter((p) => p.type === 'image').map((p) => (p as { data: string }).data),
        };
      }
      if (m.role === 'assistant') {
        return { role: 'assistant', content: m.content, ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) } : {}) };
      }
      if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.name };
      return { role: m.role, content: m.content };
    });
  }

  buildBody(req: ChatRequest): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    if (req.temperature !== undefined) options.temperature = req.temperature;
    if (req.topP !== undefined) options.top_p = req.topP;
    if (req.maxTokens !== undefined) options.num_predict = req.maxTokens;
    if (req.stop?.length) options.stop = req.stop;
    return {
      model: req.model,
      messages: OllamaAdapter.toMessages(req.messages),
      stream: true,
      options,
      ...(req.responseFormat === 'json' ? { format: 'json' } : {}),
      ...(req.thinking ? { think: req.thinking !== 'off' } : {}),
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
    };
  }

  async *stream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'api/chat'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req)),
      signal,
    });
    yield* OllamaAdapter.parse(res.body!, signal);
  }

  static async *parse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    let n = 0;
    let sawTools = false;
    for await (const c of parseNdjson<OllamaChunk>(body, signal)) {
      if (c.error) throw new LlmError('server', c.error);
      if (c.message?.thinking) yield { type: 'reasoning-delta', text: c.message.thinking };
      if (c.message?.content) yield { type: 'text-delta', text: c.message.content };
      for (const tc of c.message?.tool_calls ?? []) {
        const id = `call_${n++}`;
        sawTools = true;
        yield { type: 'tool-call-start', id, name: tc.function.name };
        yield { type: 'tool-call', call: { id, name: tc.function.name, arguments: tc.function.arguments ?? {} } };
      }
      if (c.done) {
        yield { type: 'usage', usage: { inputTokens: c.prompt_eval_count ?? 0, outputTokens: c.eval_count ?? 0 } };
        yield { type: 'finish', reason: sawTools ? 'tool_calls' : c.done_reason === 'length' ? 'length' : 'stop' };
        return;
      }
    }
    yield { type: 'finish', reason: sawTools ? 'tool_calls' : 'stop' };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'api/tags'), { headers: this.headers(), signal });
    const j = (await res.json()) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => ({ id: m.name, displayName: m.name }));
  }
}
