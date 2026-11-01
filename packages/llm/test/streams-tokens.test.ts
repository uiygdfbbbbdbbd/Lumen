import { describe, expect, it } from 'vitest';
import { errorKindForStatus, estimateCost, estimateMessages, estimateTokens, extractErrorMessage, joinUrl, LlmError, parseNdjson, parseSse, parseToolArguments } from '../src/index.js';

const stream = (...parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(new TextEncoder().encode(p));
      c.close();
    },
  });

async function all<T>(g: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const x of g) out.push(x);
  return out;
}

describe('parseSse', () => {
  it('handles split chunks, comments, events, ids and multi-line data', async () => {
    const msgs = await all(parseSse(stream(': keepalive\n', 'event: a\nid: 7\ndata: li', 'ne1\ndata: line2\n\n', 'data: x\r\n\r\n', 'data: tail')));
    expect(msgs).toEqual([
      { event: 'a', id: '7', data: 'line1\nline2' },
      { event: null, id: '7', data: 'x' },
      { event: null, id: '7', data: 'tail' },
    ]);
  });
  it('ignores empty events and honours abort', async () => {
    expect(await all(parseSse(stream('\n\n\n')))).toEqual([]);
    const ac = new AbortController();
    ac.abort();
    await expect(all(parseSse(stream('data: 1\n\n'), ac.signal))).rejects.toBeTruthy();
  });
});

describe('parseNdjson', () => {
  it('parses lines split across chunks and a trailing line', async () => {
    expect(await all(parseNdjson(stream('{"a":1}\n{"b"', ':2}\n\n{"c":3}')))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});

describe('tool arguments', () => {
  it('parses objects and tolerates bad JSON', () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArguments('  ')).toEqual({});
    expect(parseToolArguments('[1]')).toEqual({ value: [1] });
    expect(parseToolArguments('{"a":1,')).toEqual({ __raw: '{"a":1,', __parseError: true });
  });
});

describe('errors + http helpers', () => {
  it('maps statuses to kinds and retryability', () => {
    expect([400, 401, 402, 403, 404, 408, 429, 500, 503, 529, 418].map(errorKindForStatus)).toEqual([
      'invalid_request', 'auth', 'quota', 'auth', 'not_found', 'timeout', 'rate_limit', 'server', 'overloaded', 'overloaded', 'unknown',
    ]);
    expect(new LlmError('rate_limit', 'x').retryable).toBe(true);
    expect(new LlmError('auth', 'x').retryable).toBe(false);
  });
  it('extracts messages from provider error shapes', () => {
    expect(extractErrorMessage('{"error":{"message":"bad key"}}')).toBe('bad key');
    expect(extractErrorMessage('{"error":"nope"}')).toBe('nope');
    expect(extractErrorMessage('{"detail":"d"}')).toBe('d');
    expect(extractErrorMessage('<html>')).toBe('<html>');
    expect(extractErrorMessage('')).toBe('no details');
  });
  it('joins urls', () => {
    expect(joinUrl('http://x/v1/', '/models')).toBe('http://x/v1/models');
  });
});

describe('token estimation and cost', () => {
  it('estimates within a sane band of real BPE counts', () => {
    // "The quick brown fox jumps over the lazy dog." is 10 tokens in cl100k.
    const n = estimateTokens('The quick brown fox jumps over the lazy dog.');
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(13);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('1234567890')).toBe(4);
    const code = 'function add(a: number, b: number): number { return a + b; }';
    expect(estimateTokens(code)).toBeGreaterThan(15);
  });
  it('estimates whole conversations including images and tools', () => {
    const n = estimateMessages(
      [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }] },
        { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'look', arguments: { q: 'x' } }] },
        { role: 'tool', toolCallId: '1', name: 'look', content: 'a cat' },
      ],
      [{ name: 'look', description: 'Look at things', inputSchema: { type: 'object' } }],
    );
    expect(n).toBeGreaterThan(780);
  });
  it('computes cost with cached input pricing', () => {
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, { inputPer1M: 3, outputPer1M: 15 })).toBe(10.5);
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 500_000 }, { inputPer1M: 2, outputPer1M: 0, cachedInputPer1M: 0.5 })).toBe(1.25);
    expect(estimateCost({ inputTokens: 5, outputTokens: 5 }, null)).toBe(0);
  });
});
