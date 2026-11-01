import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AnthropicAdapter, GeminiAdapter, OllamaAdapter, OpenAIAdapter, type StreamEvent } from '../src/index.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Replay a recorded stream in awkward chunk sizes to exercise buffering. */
function replay(file: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(readFileSync(path.join(dir, file), 'utf8'));
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i >= bytes.length) return ctrl.close();
      ctrl.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
}

async function collect(gen: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('recorded stream fixtures', () => {
  it('OpenAI: text, streamed tool-call args, usage details', async () => {
    const ev = await collect(OpenAIAdapter.parse(replay('openai.sse')));
    expect(ev.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text).join('')).toBe('Hello world');
    expect(ev.find((e) => e.type === 'tool-call')).toEqual({ type: 'tool-call', call: { id: 'call_abc', name: 'get_weather', arguments: { city: 'Paris' } } });
    expect(ev.find((e) => e.type === 'usage')).toEqual({ type: 'usage', usage: { inputTokens: 42, outputTokens: 17, reasoningTokens: 5, cachedInputTokens: 10 } });
    expect(ev.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });
  it('Anthropic: thinking, ping events, tool_use with partial JSON, cache-aware usage', async () => {
    const ev = await collect(AnthropicAdapter.parse(replay('anthropic.sse', 13)));
    expect(ev[0]).toEqual({ type: 'reasoning-delta', text: 'Considering the weather...' });
    expect(ev).toContainEqual({ type: 'text-delta', text: 'Let me check.' });
    expect(ev).toContainEqual({ type: 'tool-call', call: { id: 'toolu_01', name: 'get_weather', arguments: { city: 'Paris' } } });
    expect(ev).toContainEqual({ type: 'usage', usage: { inputTokens: 30, outputTokens: 89, cachedInputTokens: 5 } });
    expect(ev.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });
  it('Gemini: CRLF framing, thoughts and usage with thinking tokens', async () => {
    const ev = await collect(GeminiAdapter.parse(replay('gemini.sse', 5)));
    expect(ev[0]).toEqual({ type: 'reasoning-delta', text: 'Thinking about it' });
    expect(ev.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text).join('')).toBe('Hello there');
    expect(ev).toContainEqual({ type: 'usage', usage: { inputTokens: 8, outputTokens: 10, reasoningTokens: 6 } });
    expect(ev.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
  });
  it('Ollama: NDJSON with thinking and length finish', async () => {
    const ev = await collect(OllamaAdapter.parse(replay('ollama.ndjson', 11)));
    expect(ev).toEqual([
      { type: 'reasoning-delta', text: 'hmm' },
      { type: 'text-delta', text: 'Hi' },
      { type: 'text-delta', text: '!' },
      { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } },
      { type: 'finish', reason: 'length' },
    ]);
  });
});
