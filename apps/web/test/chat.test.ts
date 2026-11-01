import { describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '@lumen/shared';
import { compareGroupOf, dateGroup, indexTree, siblingsOf } from '../src/features/chat/tree.js';
import { reduce } from '../src/features/chat/store.js';
import { followStream } from '../src/features/chat/stream.js';
import { comboFromEvent, formatCombo, resolveBindings } from '../src/lib/shortcuts.js';
import type { ChatMessage } from '../src/features/chat/types.js';

const msg = (id: string, parentId: string | null, role: 'user' | 'assistant', createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, parentId, role, content: id, parts: [], status: 'complete', error: null, modelId: null, modelName: null, usage: null, rating: null, compareGroup: null, createdAt, ...extra,
});

describe('message tree', () => {
  const ms = [
    msg('u1', null, 'user', '2026-01-01T00:00:00Z'),
    msg('a1', 'u1', 'assistant', '2026-01-01T00:00:01Z'),
    msg('a2', 'u1', 'assistant', '2026-01-01T00:00:02Z'),
    msg('c1', 'u1', 'assistant', '2026-01-01T00:00:03Z', { compareGroup: 'g' }),
    msg('c2', 'u1', 'assistant', '2026-01-01T00:00:03Z', { compareGroup: 'g' }),
    msg('u2', null, 'user', '2026-01-01T00:00:04Z'),
  ];
  const idx = indexTree(ms);
  it('computes sibling positions, treating a compare group as one version', () => {
    expect(siblingsOf(idx, idx.byId.get('a2')!)).toMatchObject({ position: 2 });
    expect(siblingsOf(idx, idx.byId.get('a2')!).list.map((m) => m.id)).toEqual(['a1', 'a2', 'c1', 'c2']);
    expect(siblingsOf(idx, idx.byId.get('c1')!).list.map((m) => m.id)).toEqual(['a1', 'a2', 'c1']);
    expect(siblingsOf(idx, idx.byId.get('u2')!)).toMatchObject({ position: 2 });
  });
  it('finds compare groups', () => {
    expect(compareGroupOf(idx, idx.byId.get('c2')!).map((m) => m.id)).toEqual(['c1', 'c2']);
    expect(compareGroupOf(idx, idx.byId.get('a1')!).map((m) => m.id)).toEqual(['a1']);
  });
  it('groups dates for the sidebar', () => {
    const now = new Date('2026-03-10T12:00:00');
    expect(dateGroup('2026-03-10T08:00:00', now)).toBe('Today');
    expect(dateGroup('2026-03-09T20:00:00', now)).toBe('Yesterday');
    expect(dateGroup('2026-03-05T20:00:00', now)).toBe('Previous 7 days');
    expect(dateGroup('2026-02-20T20:00:00', now)).toBe('Previous 30 days');
    expect(dateGroup('2025-01-01T00:00:00', now)).toBe('Older');
  });
});

describe('live stream reducer', () => {
  it('accumulates text, reasoning, tools and terminal states', () => {
    let s = { text: '', reasoning: '', tools: [], status: 'streaming' as const, error: null, fallback: null, compacted: false, reconnecting: true, usage: null } as Parameters<typeof reduce>[0];
    const events: ChatStreamEvent[] = [
      { type: 'reasoning', text: 'hm' },
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'tool_call', id: 't', name: 'calc', arguments: { x: 1 } },
      { type: 'tool_result', id: 't', name: 'calc', content: '2', isError: false },
      { type: 'fallback', from: 'A', to: 'B', reason: 'down' },
      { type: 'compacted', tokensBefore: 10, tokensAfter: 5 },
      { type: 'usage', inputTokens: 1, outputTokens: 2, contextTokens: 3, contextWindow: 100 },
      { type: 'done', status: 'complete', finishReason: 'stop' },
    ];
    for (const e of events) s = reduce(s, e);
    expect(s).toMatchObject({ text: 'Hello', reasoning: 'hm', status: 'done', compacted: true, reconnecting: false, usage: { contextTokens: 3, contextWindow: 100 } });
    expect(s.tools[0]).toEqual({ id: 't', name: 'calc', arguments: { x: 1 }, result: { content: '2', isError: false } });
    expect(s.fallback).toMatch(/switched to B/);
    expect(reduce(s, { type: 'error', code: 'RATE_LIMITED', message: 'slow', retryable: true }).status).toBe('error');
    expect(reduce(s, { type: 'done', status: 'cancelled', finishReason: 'cancelled' }).status).toBe('cancelled');
    expect(reduce(s, { type: 'start', messageId: 'x', model: { id: null, name: null } })).toBe(s);
  });
});

function sseResponse(chunks: string[], opts: { failAfter?: boolean } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(
    new ReadableStream({
      pull(c) {
        if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]!));
        else if (opts.failAfter) c.error(new TypeError('network'));
        else c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('followStream', () => {
  it('reconnects after a drop and resumes from the last sequence without duplicates', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls: (string | undefined)[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      calls.push((init?.headers as Record<string, string>)['last-event-id']);
      if (calls.length === 1) return sseResponse(['id: 1\ndata: {"type":"text","text":"A"}\n\n', 'id: 2\ndata: {"type":"text","text":"B"}\n\n'], { failAfter: true });
      return sseResponse(['id: 2\ndata: {"type":"text","text":"B"}\n\n', 'id: 3\ndata: {"type":"text","text":"C"}\n\n', 'id: 4\ndata: {"type":"done","status":"complete","finishReason":"stop"}\n\n']);
    });
    const got: string[] = [];
    const reconnects: number[] = [];
    await followStream('m1', { onEvent: (e) => got.push(e.type === 'text' ? e.text : e.type), onReconnecting: (n) => reconnects.push(n) }, new AbortController().signal);
    expect(got).toEqual(['A', 'B', 'C', 'done']);
    expect(calls).toEqual([undefined, '2']);
    expect(reconnects).toEqual([1]);
    fetchMock.mockRestore();
    vi.useRealTimers();
  });
  it('stops quietly when aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await followStream('m1', { onEvent: () => undefined }, ctrl.signal);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});

describe('shortcuts', () => {
  it('normalizes key events and formats combos', () => {
    expect(comboFromEvent({ key: 'K', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe('mod+k');
    expect(comboFromEvent({ key: 'O', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe('mod+shift+o');
    expect(comboFromEvent({ key: '?', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true })).toBe('?');
    expect(formatCombo('mod+shift+o')).toBe('Ctrl+Shift+O');
    expect(formatCombo('shift+escape')).toBe('Shift+Esc');
  });
  it('applies user overrides on top of defaults', () => {
    const b = resolveBindings({ palette: 'mod+p' });
    expect(b.palette).toBe('mod+p');
    expect(b.newChat).toBe('mod+shift+o');
  });
});
