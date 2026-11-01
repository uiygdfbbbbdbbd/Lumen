import { joinUrl, jsonHeaders, request } from '../http.js';
import { parseSse } from '../streams.js';
import { LlmError, type ChatMessage, type EmbeddingResult, type ChatRequest, type FinishReason, type ModelInfo, type ProviderAdapter, type ProviderConfig, type StreamEvent } from '../types.js';

const THINKING_BUDGET = { low: 1024, medium: 8192, high: 24576 } as const;
type Part = Record<string, unknown>;
interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

/** Google Gemini generateContent API (v1beta) with SSE streaming. */
export class GeminiAdapter implements ProviderAdapter {
  readonly type = 'gemini' as const;
  constructor(private readonly cfg: ProviderConfig) {}

  private headers() {
    return jsonHeaders({ 'x-goog-api-key': this.cfg.apiKey }, this.cfg.headers);
  }

  static toContents(messages: ChatMessage[]): { systemInstruction?: { parts: Part[] }; contents: { role: 'user' | 'model'; parts: Part[] }[] } {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content as string).join('\n\n');
    const contents: { role: 'user' | 'model'; parts: Part[] }[] = [];
    const push = (role: 'user' | 'model', parts: Part[]) => {
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts.push(...parts);
      else contents.push({ role, parts });
    };
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'user') {
        const parts = typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content;
        push(
          'user',
          parts.map((p) =>
            p.type === 'text' ? { text: p.text } : p.type === 'image' ? { inlineData: { mimeType: p.mediaType, data: p.data } } : { fileData: { fileUri: p.url } },
          ),
        );
      } else if (m.role === 'assistant') {
        const parts: Part[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.arguments } });
        push('model', parts.length ? parts : [{ text: '' }]);
      } else {
        push('user', [{ functionResponse: { name: m.name, response: m.isError ? { error: m.content } : { content: m.content } } }]);
      }
    }
    return { ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}), contents };
  }

  buildBody(req: ChatRequest): Record<string, unknown> {
    const gen: Record<string, unknown> = {};
    if (req.temperature !== undefined) gen.temperature = req.temperature;
    if (req.topP !== undefined) gen.topP = req.topP;
    if (req.maxTokens !== undefined) gen.maxOutputTokens = req.maxTokens;
    if (req.stop?.length) gen.stopSequences = req.stop;
    if (req.responseFormat === 'json') gen.responseMimeType = 'application/json';
    if (req.thinking) gen.thinkingConfig = req.thinking === 'off' ? { thinkingBudget: 0 } : { thinkingBudget: THINKING_BUDGET[req.thinking], includeThoughts: true };
    const body: Record<string, unknown> = { ...GeminiAdapter.toContents(req.messages), generationConfig: gen };
    if (req.tools?.length) {
      body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })) }];
      if (req.toolChoice) {
        const mode = req.toolChoice === 'auto' ? 'AUTO' : req.toolChoice === 'none' ? 'NONE' : 'ANY';
        body.toolConfig = { functionCallingConfig: { mode, ...(typeof req.toolChoice === 'object' ? { allowedFunctionNames: [req.toolChoice.name] } : {}) } };
      }
    }
    return body;
  }

  async *stream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const model = req.model.replace(/^models\//, '');
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, `v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(req)),
      signal,
    });
    yield* GeminiAdapter.parse(res.body!, signal);
  }

  static async *parse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    let finish: FinishReason = 'stop';
    let usage = null as GeminiUsage | null;
    let calls = 0;
    for await (const msg of parseSse(body, signal)) {
      const chunk = JSON.parse(msg.data) as {
        error?: { message?: string };
        candidates?: { content?: { parts?: { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: Record<string, unknown> } }[] }; finishReason?: string }[];
        usageMetadata?: GeminiUsage;
        promptFeedback?: { blockReason?: string };
      };
      if (chunk.error) throw new LlmError('server', chunk.error.message ?? 'Provider stream error');
      if (chunk.promptFeedback?.blockReason) {
        finish = 'content_filter';
        break;
      }
      const cand = chunk.candidates?.[0];
      for (const p of cand?.content?.parts ?? []) {
        if (p.functionCall) {
          const id = p.functionCall.id ?? `call_${calls++}`;
          yield { type: 'tool-call-start', id, name: p.functionCall.name };
          yield { type: 'tool-call', call: { id, name: p.functionCall.name, arguments: p.functionCall.args ?? {} } };
          finish = 'tool_calls';
        } else if (p.text) yield p.thought ? { type: 'reasoning-delta', text: p.text } : { type: 'text-delta', text: p.text };
      }
      if (cand?.finishReason && finish !== 'tool_calls') finish = mapFinish(cand.finishReason);
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
    }
    if (usage) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          ...(usage.thoughtsTokenCount ? { reasoningTokens: usage.thoughtsTokenCount } : {}),
          ...(usage.cachedContentTokenCount ? { cachedInputTokens: usage.cachedContentTokenCount } : {}),
        },
      };
    }
    yield { type: 'finish', reason: finish };
  }

  async embed(model: string, inputs: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
    const m = model.replace(/^models\//, '');
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, `v1beta/models/${encodeURIComponent(m)}:batchEmbedContents`), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ requests: inputs.map((text) => ({ model: `models/${m}`, content: { parts: [{ text }] } })) }),
      signal,
    });
    const j = (await res.json()) as { embeddings: { values: number[] }[] };
    return { vectors: j.embeddings.map((e) => e.values), inputTokens: 0 };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.cfg, joinUrl(this.cfg.baseUrl, 'v1beta/models?pageSize=1000'), { headers: this.headers(), signal });
    const j = (await res.json()) as { models?: { name: string; displayName?: string; inputTokenLimit?: number; outputTokenLimit?: number; supportedGenerationMethods?: string[] }[] };
    return (j.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        displayName: m.displayName ?? m.name,
        ...(m.inputTokenLimit ? { contextWindow: m.inputTokenLimit } : {}),
        ...(m.outputTokenLimit ? { maxOutputTokens: m.outputTokenLimit } : {}),
        capabilities: { vision: true, tools: true },
      }));
  }
}

function mapFinish(r: string): FinishReason {
  if (r === 'MAX_TOKENS') return 'length';
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(r)) return 'content_filter';
  return 'stop';
}
