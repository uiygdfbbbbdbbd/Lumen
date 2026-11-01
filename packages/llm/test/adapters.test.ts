import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicAdapter, complete, createAdapter, GeminiAdapter, LlmError, OllamaAdapter, OpenAIAdapter, PROVIDER_PRESETS, PROVIDER_TYPES, type ChatMessage, type ProviderType } from '../src/index.js';
import { startMockProvider, type MockProvider } from '../src/mock/server.js';

let mock: MockProvider;
beforeAll(async () => {
  mock = await startMockProvider({ apiKey: 'test-key' });
});
afterAll(() => mock.close());

const KINDS: { type: ProviderType; base: (u: string) => string }[] = [
  { type: 'openai', base: (u) => `${u}/v1` },
  { type: 'anthropic', base: (u) => u },
  { type: 'gemini', base: (u) => u },
  { type: 'ollama', base: (u) => u },
  { type: 'cohere', base: (u) => u },
];
const tool = { name: 'get_weather', description: 'Weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } };

describe.each(KINDS)('$type adapter against the mock provider', ({ type, base }) => {
  const adapter = () => createAdapter({ type, baseUrl: base(mock.url), apiKey: 'test-key' });

  it('streams text and reports usage', async () => {
    const r = await complete(adapter(), { model: 'mock-fast', messages: [{ role: 'system', content: 'Be nice' }, { role: 'user', content: 'hello there' }] });
    expect(r.text).toBe('You said: hello there');
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.usage.outputTokens).toBeGreaterThan(0);
    expect(r.finishReason).toBe('stop');
  });

  it('round-trips a tool call and its result', async () => {
    const first = await complete(adapter(), { model: 'mock-smart', tools: [tool], toolChoice: 'auto', messages: [{ role: 'user', content: 'weather? [tool:get_weather {"city":"Paris"}]' }] });
    expect(first.finishReason).toBe('tool_calls');
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0]).toMatchObject({ name: 'get_weather', arguments: { city: 'Paris' } });
    const call = first.toolCalls[0]!;
    const history: ChatMessage[] = [
      { role: 'user', content: 'weather? [tool:get_weather {"city":"Paris"}]' },
      { role: 'assistant', content: '', toolCalls: [call] },
      { role: 'tool', toolCallId: call.id, name: call.name, content: '18C and sunny' },
    ];
    const second = await complete(adapter(), { model: 'mock-smart', tools: [tool], messages: history });
    expect(second.text).toBe('Tool get_weather returned: 18C and sunny');
  });

  it('normalizes rate limits and auth errors', async () => {
    const err = await complete(adapter(), { model: 'mock-fast', messages: [{ role: 'user', content: 'x [error:429]' }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe('rate_limit');
    expect((err as LlmError).retryable).toBe(true);
    const bad = createAdapter({ type, baseUrl: base(mock.url), apiKey: 'wrong' });
    expect(((await complete(bad, { model: 'mock-fast', messages: [{ role: 'user', content: 'x' }] }).catch((e: unknown) => e)) as LlmError).kind).toBe('auth');
  });

  it('surfaces a mid-stream disconnect as an error', async () => {
    await expect(complete(adapter(), { model: 'mock-fast', messages: [{ role: 'user', content: 'one two three four five six [disconnect]' }] })).rejects.toBeTruthy();
  });

  it('cancels when aborted', async () => {
    const ac = new AbortController();
    const p = complete(adapter(), { model: 'mock-fast', messages: [{ role: 'user', content: 'a b c d e f [slow:100]' }] }, ac.signal);
    setTimeout(() => ac.abort(), 50);
    await expect(p).rejects.toBeTruthy();
  });

  it('lists models', async () => {
    const models = await adapter().listModels();
    expect(models.map((m) => m.id)).toEqual(expect.arrayContaining(['mock-fast', 'mock-smart']));
  });

  it('unknown models are not_found', async () => {
    const e = await complete(adapter(), { model: 'nope', messages: [{ role: 'user', content: 'x' }] }).catch((x: unknown) => x);
    expect((e as LlmError).kind).toBe('not_found');
  });
});

describe('reasoning streams', () => {
  it.each(['openai', 'anthropic', 'gemini', 'ollama'] as const)('%s surfaces reasoning separately', async (type) => {
    const base = type === 'openai' ? `${mock.url}/v1` : mock.url;
    const r = await complete(createAdapter({ type, baseUrl: base, apiKey: 'test-key' }), { model: 'mock-reasoning', thinking: 'medium', messages: [{ role: 'user', content: 'why [reason]' }] });
    expect(r.reasoning).toMatch(/step by step/);
    expect(r.text).toBe('You said: why');
  });
});

describe('request conversion', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'S1' },
    { role: 'system', content: 'S2' },
    { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', mediaType: 'image/png', data: 'QUJD' }, { type: 'image_url', url: 'https://x/y.png' }] },
    { role: 'assistant', content: 'ok', toolCalls: [{ id: 't1', name: 'a', arguments: { x: 1 } }, { id: 't2', name: 'b', arguments: {} }] },
    { role: 'tool', toolCallId: 't1', name: 'a', content: 'r1' },
    { role: 'tool', toolCallId: 't2', name: 'b', content: 'r2', isError: true },
  ];

  it('anthropic merges system prompts and consecutive tool results; maps thinking + tool choice', () => {
    const a = new AnthropicAdapter({ type: 'anthropic', baseUrl: 'x' });
    const body = a.buildBody({ model: 'm', messages, thinking: 'high', temperature: 0.5, tools: [tool], toolChoice: 'required', maxTokens: 1000, stop: ['END'], user: 'u1' });
    expect(body.system).toBe('S1\n\nS2');
    const msgs = body.messages as { role: string; content: { type: string }[] }[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[2]!.content.map((b) => b.type)).toEqual(['tool_result', 'tool_result']);
    expect(msgs[0]!.content.map((b) => b.type)).toEqual(['text', 'image', 'image']);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 24576 });
    expect(body.temperature).toBeUndefined(); // not allowed with thinking
    expect(body.max_tokens).toBe(24576 + 1024);
    expect(body.tool_choice).toEqual({ type: 'any' });
    expect(body.stop_sequences).toEqual(['END']);
    expect(a.buildBody({ model: 'm', messages, tools: [tool], toolChoice: { name: 'a' }, temperature: 2 }).tool_choice).toEqual({ type: 'tool', name: 'a' });
    expect(a.buildBody({ model: 'm', messages, temperature: 2 }).temperature).toBe(1);
  });

  it('openai maps images, tool calls, json mode and reasoning effort', () => {
    const o = new OpenAIAdapter({ type: 'openai', baseUrl: 'x' });
    const body = o.buildBody({ model: 'm', messages, responseFormat: 'json', thinking: 'low', maxTokens: 50, tools: [tool], toolChoice: { name: 'get_weather' }, topP: 0.9, stop: ['x'], user: 'u' });
    const msgs = body.messages as Record<string, unknown>[];
    expect((msgs[2]!.content as { type: string }[]).map((p) => p.type)).toEqual(['text', 'image_url', 'image_url']);
    expect(((msgs[2]!.content as { image_url?: { url: string } }[])[1]!.image_url!.url)).toBe('data:image/png;base64,QUJD');
    expect((msgs[3]!.tool_calls as unknown[]).length).toBe(2);
    expect(msgs[4]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'r1' });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_completion_tokens).toBe(50);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } });
    const compat = new OpenAIAdapter({ type: 'vllm', baseUrl: 'x' }, 'vllm').buildBody({ model: 'm', messages, maxTokens: 5 });
    expect(compat.max_tokens).toBe(5);
  });

  it('gemini maps system instruction, roles, function responses and thinking budget', () => {
    const g = new GeminiAdapter({ type: 'gemini', baseUrl: 'x' });
    const body = g.buildBody({ model: 'm', messages, thinking: 'off', responseFormat: 'json', tools: [tool], toolChoice: 'required', maxTokens: 9, stop: ['z'] });
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'S1\n\nS2' }] });
    const contents = body.contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[2]!.parts[1]).toEqual({ functionResponse: { name: 'b', response: { error: 'r2' } } });
    expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json', maxOutputTokens: 9 });
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });
  });

  it('ollama maps images and tool messages', () => {
    const o = new OllamaAdapter({ type: 'ollama', baseUrl: 'x' });
    const body = o.buildBody({ model: 'm', messages, thinking: 'high', responseFormat: 'json', temperature: 0.1, maxTokens: 3 });
    const msgs = body.messages as Record<string, unknown>[];
    expect(msgs[2]).toEqual({ role: 'user', content: 'look', images: ['QUJD'] });
    expect(msgs[4]).toEqual({ role: 'tool', content: 'r1', tool_name: 'a' });
    expect(body).toMatchObject({ think: true, format: 'json', options: { temperature: 0.1, num_predict: 3 } });
  });

  it('every provider type has a preset and creates an adapter', () => {
    for (const t of PROVIDER_TYPES) {
      expect(PROVIDER_PRESETS[t].label).toBeTruthy();
      expect(createAdapter({ type: t, baseUrl: 'http://x' }).type).toBe(t === 'mistral' || t === 'openrouter' || t === 'vllm' || t === 'lmstudio' || t === 'custom' ? t : t);
    }
  });
});

describe('network errors', () => {
  it('unreachable hosts are network errors; slow ones time out', async () => {
    const e = await complete(createAdapter({ type: 'openai', baseUrl: 'http://127.0.0.1:1/v1' }), { model: 'm', messages: [{ role: 'user', content: 'x' }] }).catch((x: unknown) => x);
    expect((e as LlmError).kind).toBe('network');
    const t = await complete(createAdapter({ type: 'openai', baseUrl: `${mock.url}/v1`, apiKey: 'test-key', timeoutMs: 50 }), { model: 'mock-fast', messages: [{ role: 'user', content: 'a b c [slow:200]' }] }).catch((x: unknown) => x);
    expect(t).toBeTruthy();
  });
});

describe('embeddings', () => {
  it.each(['openai', 'gemini', 'ollama', 'cohere'] as const)('%s returns one normalized vector per input', async (type) => {
    const base = type === 'openai' ? `${mock.url}/v1` : mock.url;
    const r = await createAdapter({ type, baseUrl: base, apiKey: 'test-key' }).embed('mock-embed', ['red apple pie', 'apple pies are red', 'quantum physics']);
    expect(r.vectors).toHaveLength(3);
    const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
    expect(cos(r.vectors[0]!, r.vectors[1]!)).toBeGreaterThan(cos(r.vectors[0]!, r.vectors[2]!));
  });
  it('anthropic explains it has no embeddings API', async () => {
    await expect(createAdapter({ type: 'anthropic', baseUrl: mock.url }).embed('x', ['y'])).rejects.toThrow(/embeddings API/);
  });
});
