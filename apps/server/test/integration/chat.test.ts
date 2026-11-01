import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { startMockProvider, type MockProvider } from '@lumen/llm/mock';
import { createTestApp, signup, type TestApp, type TestClient } from '../helpers/app.js';
import { send, setupMockModels, streamEvents, textOf, waitFor } from '../helpers/chat.js';

const KEY = 'sk-chat-test-key-000000000000';
let t: TestApp;
let mock: MockProvider;
let admin: TestClient;
let user: TestClient;
let other: TestClient;
let ids: Record<string, string>;
let userId = '';

beforeAll(async () => {
  mock = await startMockProvider({ apiKey: KEY });
  t = await createTestApp({ env: { ALLOW_PRIVATE_PROVIDER_URLS: 'true' } });
  admin = t.client();
  await signup(admin);
  ({ ids } = await setupMockModels(t, admin, mock, KEY));
  await admin.patch(`/api/admin/models/${ids['mock-fast']}`, { recommended: true, capabilities: { tools: true, vision: false, json: true, reasoning: false, audio: false, imageGen: false } });
  user = t.client();
  userId = (await signup(user)).body.user.id;
  other = t.client();
  await signup(other);
});
afterAll(async () => {
  await t.close();
  await mock.close();
});

async function newChat(c: TestClient = user, body: Record<string, unknown> = {}) {
  return (await c.post('/api/conversations', body)).json() as { id: string; title: string; incognito: boolean };
}
async function tree(id: string, c: TestClient = user) {
  return (await c.get(`/api/conversations/${id}`)).json();
}

describe('streaming chat', () => {
  it('streams a reply, persists it, records usage and auto-titles the chat', async () => {
    const conv = await newChat();
    const res = await send(user, conv.id, { content: 'hello world' });
    expect(res.statusCode).toBe(201);
    const { userMessage, assistantMessages } = res.json();
    expect(userMessage.content).toBe('hello world');
    expect(assistantMessages[0].status).toBe('streaming');
    const events = await streamEvents(user, assistantMessages[0].id);
    expect(events[0]!.event).toMatchObject({ type: 'start', model: { name: 'mock-fast' } });
    expect(textOf(events)).toBe('You said: hello world');
    expect(events.at(-1)!.event).toEqual({ type: 'done', status: 'complete', finishReason: 'stop' });
    expect(events.find((e) => e.event.type === 'usage')!.event).toMatchObject({ contextWindow: 32000 });
    // Sequence numbers are strictly increasing (resume relies on this).
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));

    const tr = await tree(conv.id);
    const a = tr.messages.find((m: { id: string }) => m.id === assistantMessages[0].id);
    expect(a).toMatchObject({ status: 'complete', content: 'You said: hello world', modelName: 'mock-fast' });
    expect(a.usage.outputTokens).toBeGreaterThan(0);
    expect(tr.activePath).toEqual([userMessage.id, a.id]);
    const titled = await waitFor(async () => (await tree(conv.id)).conversation.title !== 'New chat' && (await tree(conv.id)).conversation.title);
    expect(titled).toMatch(/You said/);
    const [usage] = (await t.c.db.execute(sql`SELECT count(*)::int AS n FROM usage_events WHERE user_id = ${userId} AND source = 'chat'`)) as unknown as { n: number }[];
    expect(usage!.n).toBeGreaterThanOrEqual(1);
    expect(await t.c.entitlements.usage(userId, 'messages')).toBeGreaterThanOrEqual(1);
  });

  it('resumes a stream from a sequence number', async () => {
    const conv = await newChat();
    const { assistantMessages } = (await send(user, conv.id, { content: 'one two three four' })).json();
    const all = await streamEvents(user, assistantMessages[0].id);
    const tail = await streamEvents(user, assistantMessages[0].id, 3);
    expect(tail.map((e) => e.seq)).toEqual(all.filter((e) => e.seq > 3).map((e) => e.seq));
  });

  it('runs tool calls and feeds results back to the model', async () => {
    const conv = await newChat();
    const { assistantMessages } = (await send(user, conv.id, { content: 'compute [tool:calculator {"expression":"(2+3)^2"}]' })).json();
    const events = await streamEvents(user, assistantMessages[0].id);
    expect(events.find((e) => e.event.type === 'tool_call')!.event).toMatchObject({ name: 'calculator', arguments: { expression: '(2+3)^2' } });
    expect(events.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ content: '(2+3)^2 = 25', isError: false });
    expect(textOf(events)).toBe('Tool calculator returned: (2+3)^2 = 25');
    const a = (await tree(conv.id)).messages.find((m: { id: string }) => m.id === assistantMessages[0].id);
    expect(a.parts.map((p: { type: string }) => p.type)).toEqual(['tool_call', 'tool_result', 'text_segment']);
    // A follow-up turn replays the tool exchange to the provider in its native format.
    const second = (await send(user, conv.id, { content: 'thanks' })).json();
    await streamEvents(user, second.assistantMessages[0].id);
    const body = mock.requests.at(-1)!.body as { messages: { role: string; tool_calls?: unknown[] }[] };
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
  });
});

describe('branching', () => {
  it('editing a user message creates a sibling branch; switching branches changes the active path', async () => {
    const conv = await newChat();
    const first = (await send(user, conv.id, { content: 'first question' })).json();
    await streamEvents(user, first.assistantMessages[0].id);
    const edited = await user.post(`/api/conversations/${conv.id}/messages/${first.userMessage.id}/edit`, { content: 'better question' });
    const e = edited.json();
    await streamEvents(user, e.assistantMessages[0].id);
    let tr = await tree(conv.id);
    const users = tr.messages.filter((m: { role: string }) => m.role === 'user');
    expect(users).toHaveLength(2);
    expect(new Set(users.map((m: { parentId: string | null }) => m.parentId)).size).toBe(1);
    expect(tr.activePath[0]).toBe(e.userMessage.id);
    await user.patch(`/api/conversations/${conv.id}`, { activeLeafId: first.userMessage.id });
    tr = await tree(conv.id);
    expect(tr.activePath).toEqual([first.userMessage.id, first.assistantMessages[0].id]);
  });

  it('regenerate adds an assistant sibling, optionally with another model', async () => {
    const conv = await newChat();
    const first = (await send(user, conv.id, { content: 'regen me' })).json();
    await streamEvents(user, first.assistantMessages[0].id);
    const r = (await user.post(`/api/conversations/${conv.id}/messages/${first.assistantMessages[0].id}/regenerate`, { modelId: ids['mock-smart'] })).json();
    await streamEvents(user, r.assistantMessage.id);
    const tr = await tree(conv.id);
    const siblings = tr.messages.filter((m: { parentId: string }) => m.parentId === first.userMessage.id);
    expect(siblings.map((m: { modelName: string }) => m.modelName).sort()).toEqual(['mock-fast', 'mock-smart']);
    expect(tr.activePath.at(-1)).toBe(r.assistantMessage.id);
  });

  it('compare mode streams several models side by side under one user message', async () => {
    const conv = await newChat();
    const r = (await send(user, conv.id, { content: 'compare these', compareModelIds: [ids['mock-fast'], ids['mock-smart']] })).json();
    expect(r.assistantMessages).toHaveLength(2);
    expect(r.assistantMessages[0].compareGroup).toBeTruthy();
    expect(r.assistantMessages[0].compareGroup).toBe(r.assistantMessages[1].compareGroup);
    const texts = await Promise.all(r.assistantMessages.map(async (a: { id: string }) => textOf(await streamEvents(user, a.id))));
    expect(texts).toEqual(['You said: compare these', 'You said: compare these']);
    // "Continue with this one" = make it the active leaf.
    await user.patch(`/api/conversations/${conv.id}`, { activeLeafId: r.assistantMessages[1].id });
    expect((await tree(conv.id)).activePath.at(-1)).toBe(r.assistantMessages[1].id);
  });

  it('deleting a message removes its subtree and keeps a valid active path', async () => {
    const conv = await newChat();
    const a = (await send(user, conv.id, { content: 'a' })).json();
    await streamEvents(user, a.assistantMessages[0].id);
    const b = (await send(user, conv.id, { content: 'b' })).json();
    await streamEvents(user, b.assistantMessages[0].id);
    expect((await user.del(`/api/conversations/${conv.id}/messages/${b.userMessage.id}`)).statusCode).toBe(204);
    const tr = await tree(conv.id);
    expect(tr.messages).toHaveLength(2);
    expect(tr.activePath).toEqual([a.userMessage.id, a.assistantMessages[0].id]);
  });
});

describe('failures, fallback and cancellation', () => {
  it('falls back to the next model in the chain on a retryable error', async () => {
    // A separate provider so the rate-limited key's cooldown doesn't affect other tests.
    const pool = await setupMockModels(t, admin, mock, KEY);
    await admin.patch(`/api/admin/models/${pool.ids['mock-vision']}`, { fallbackModelIds: [pool.ids['mock-smart']] });
    const conv = await newChat(user, { modelId: pool.ids['mock-vision'] });
    const r = (await send(user, conv.id, { content: 'please [error:429]' })).json();
    const events = await streamEvents(user, r.assistantMessages[0].id);
    // The mock errors for every model on this prompt, so the fallback also fails: assert the chain ran.
    expect(events.find((e) => e.event.type === 'fallback')!.event).toMatchObject({ from: 'mock-vision', to: 'mock-smart' });
    expect(events.at(-1)!.event).toMatchObject({ type: 'error', code: 'RATE_LIMITED', retryable: true });
    const msg = (await tree(conv.id)).messages.find((m: { id: string }) => m.id === r.assistantMessages[0].id);
    expect(msg.status).toBe('error');
  });

  it('a mid-stream disconnect keeps partial content and reports an error', async () => {
    const conv = await newChat();
    const r = (await send(user, conv.id, { content: 'alpha beta gamma delta epsilon [disconnect]' })).json();
    const events = await streamEvents(user, r.assistantMessages[0].id);
    expect(events.at(-1)!.event.type).toBe('error');
    const msg = (await tree(conv.id)).messages.find((m: { id: string }) => m.id === r.assistantMessages[0].id);
    expect(msg.status).toBe('error');
    expect(msg.content.length).toBeGreaterThan(0);
  });

  it('cancels a slow stream and keeps what was generated', async () => {
    const conv = await newChat();
    const r = (await send(user, conv.id, { content: 'w1 w2 w3 w4 w5 w6 w7 w8 [slow:150]' })).json();
    const id = r.assistantMessages[0].id;
    await new Promise((res) => setTimeout(res, 400));
    expect((await user.post(`/api/streams/${id}/cancel`)).json()).toEqual({ cancelled: true });
    const events = await streamEvents(user, id);
    expect(events.at(-1)!.event).toMatchObject({ type: 'done', status: 'cancelled' });
    const msg = (await tree(conv.id)).messages.find((m: { id: string }) => m.id === id);
    expect(msg.status).toBe('cancelled');
  });

  it('enforces the concurrent stream cap and daily message quota', async () => {
    const c = t.client();
    const { body } = await signup(c);
    await t.c.db.execute(sql`UPDATE users SET overrides = '{"limits":{"concurrentStreams":1,"messagesPerDay":3}}'::jsonb WHERE id = ${body.user.id}`);
    const conv = await newChat(c);
    const slow = (await send(c, conv.id, { content: 'a b c d e f [slow:100]' })).json();
    const conv2 = await newChat(c);
    const blocked = await send(c, conv2.id, { content: 'hi' });
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    await streamEvents(c, slow.assistantMessages[0].id);
    const ok = (await send(c, conv2.id, { content: 'hi' })).json();
    await streamEvents(c, ok.assistantMessages[0].id);
    const last = (await send(c, conv2.id, { content: 'again' })).json();
    await streamEvents(c, last.assistantMessages[0].id);
    const over = await send(c, conv2.id, { content: 'one more' });
    expect(over.statusCode).toBe(429);
    expect(over.json().error).toMatchObject({ code: 'QUOTA_EXCEEDED' });
    expect(over.json().error.resetAt).toBeTruthy();
  });

  it('marks orphaned streaming messages as interrupted', async () => {
    const conv = await newChat();
    await t.c.db.execute(sql`INSERT INTO messages (conversation_id, role, status, updated_at) VALUES (${conv.id}, 'assistant', 'streaming', now() - interval '10 minutes')`);
    t.clock.now = new Date();
    expect(await t.c.runner.recoverStale()).toBeGreaterThanOrEqual(1);
  });
});

describe('context compaction', () => {
  it('summarizes older turns when the branch exceeds the context window', async () => {
    await admin.patch(`/api/admin/models/${ids['mock-reasoning']}`, { contextWindow: 1500, maxOutputTokens: 256 });
    const conv = await newChat(user, { modelId: ids['mock-reasoning'] });
    let last = '';
    for (let i = 0; i < 6; i++) {
      const r = (await send(user, conv.id, { content: `turn ${i} ${'lorem ipsum dolor sit amet '.repeat(30)}` })).json();
      const ev = await streamEvents(user, r.assistantMessages[0].id);
      if (ev.some((e) => e.event.type === 'compacted')) last = r.assistantMessages[0].id;
    }
    expect(last).not.toBe('');
    const tr = await tree(conv.id);
    expect(tr.compactions.length).toBeGreaterThanOrEqual(1);
    expect(tr.compactions[0].tokensAfter).toBeLessThan(tr.compactions[0].tokensBefore);
    const reqBody = mock.requests.at(-1)!.body as { messages: { content: string }[] };
    expect(JSON.stringify(reqBody.messages)).toContain('Summary of the earlier part');
  });
});

describe('conversation management', () => {
  it('lists, renames, pins, archives, duplicates, deletes with undo, and purges', async () => {
    const conv = await newChat(user, { title: 'Manage me' });
    const r = (await send(user, conv.id, { content: 'content to copy' })).json();
    await streamEvents(user, r.assistantMessages[0].id);
    await user.patch(`/api/conversations/${conv.id}`, { title: 'Renamed', pinned: true, starred: true });
    let list = (await user.get('/api/conversations')).json();
    expect(list.items.find((x: { id: string }) => x.id === conv.id)).toMatchObject({ title: 'Renamed', pinned: true, starred: true });
    const dup = (await user.post(`/api/conversations/${conv.id}/duplicate`)).json();
    expect(dup.title).toBe('Renamed (copy)');
    expect((await tree(dup.id)).messages).toHaveLength(2);
    expect((await user.post('/api/conversations/bulk', { ids: [conv.id, dup.id], action: 'archive' })).json().updated).toBe(2);
    list = (await user.get('/api/conversations')).json();
    expect(list.items.some((x: { id: string }) => x.id === conv.id)).toBe(false);
    expect((await user.get('/api/conversations?archived=true')).json().items.length).toBeGreaterThanOrEqual(2);
    expect((await user.del(`/api/conversations/${dup.id}`)).statusCode).toBe(204);
    expect((await user.get(`/api/conversations/${dup.id}`)).statusCode).toBe(404);
    expect((await user.post(`/api/conversations/${dup.id}/restore`)).json().id).toBe(dup.id);
    await user.del(`/api/conversations/${dup.id}`);
    t.clock.advance(11 * 60_000);
    expect((await user.post(`/api/conversations/${dup.id}/restore`)).json().error.code).toBe('CONFLICT');
    expect((await t.c.conversations.purge()).deleted).toBeGreaterThanOrEqual(1);
  });

  it('paginates with cursors', async () => {
    const c = t.client();
    await signup(c);
    for (let i = 0; i < 5; i++) {
      await newChat(c, { title: `c${i}` });
      t.clock.advance(1000);
    }
    const p1 = (await c.get('/api/conversations?limit=2')).json();
    const p2 = (await c.get(`/api/conversations?limit=2&cursor=${p1.nextCursor}`)).json();
    const p3 = (await c.get(`/api/conversations?limit=2&cursor=${p2.nextCursor}`)).json();
    expect([...p1.items, ...p2.items, ...p3.items].map((x: { title: string }) => x.title)).toEqual(['c4', 'c3', 'c2', 'c1', 'c0']);
    expect(p3.nextCursor).toBeNull();
  });

  it('temporary chats are hidden from history and expire', async () => {
    const conv = await newChat(user, { incognito: true });
    expect(conv.incognito).toBe(true);
    expect((await user.get('/api/conversations')).json().items.some((x: { id: string }) => x.id === conv.id)).toBe(false);
    t.clock.advance(25 * 3600_000);
    expect((await t.c.conversations.purge()).expired).toBeGreaterThanOrEqual(1);
    expect((await user.get(`/api/conversations/${conv.id}`)).statusCode).toBe(404);
  });

  it('feedback can be set and cleared', async () => {
    const conv = await newChat();
    const r = (await send(user, conv.id, { content: 'rate me' })).json();
    await streamEvents(user, r.assistantMessages[0].id);
    const url = `/api/conversations/${conv.id}/messages/${r.assistantMessages[0].id}/feedback`;
    expect((await user.post(url, { rating: -1, reason: 'wrong' })).statusCode).toBe(204);
    expect((await tree(conv.id)).messages.find((m: { id: string }) => m.id === r.assistantMessages[0].id).rating).toBe(-1);
    await user.post(url, { rating: 0 });
    expect((await tree(conv.id)).messages.find((m: { id: string }) => m.id === r.assistantMessages[0].id).rating).toBeNull();
    expect((await user.post(`/api/conversations/${conv.id}/messages/${r.userMessage.id}/feedback`, { rating: 1 })).statusCode).toBe(404);
  });
});

describe('search and isolation', () => {
  it('finds messages by content with highlighted snippets, only for the owner', async () => {
    const conv = await newChat(user, { title: 'Pelicans' });
    const r = (await send(user, conv.id, { content: 'tell me about the zanzibar archipelago' })).json();
    await streamEvents(user, r.assistantMessages[0].id);
    const hits = (await user.get('/api/conversations/search?q=zanzibar')).json().items;
    expect(hits[0]).toMatchObject({ conversationId: conv.id });
    expect(hits[0].snippet).toContain('<<zanzibar>>');
    expect((await user.get('/api/conversations/search?q=pelicans')).json().items[0].conversationId).toBe(conv.id);
    expect((await other.get('/api/conversations/search?q=zanzibar')).json().items).toEqual([]);
    // websearch syntax / injection-looking input is safe
    expect((await user.get(`/api/conversations/search?q=${encodeURIComponent("zanzibar' OR 1=1 --")}`)).statusCode).toBe(200);
  });

  it("other users can't read, write or stream someone else's chat", async () => {
    const conv = await newChat();
    const r = (await send(user, conv.id, { content: 'private' })).json();
    await streamEvents(user, r.assistantMessages[0].id);
    expect((await other.get(`/api/conversations/${conv.id}`)).statusCode).toBe(404);
    expect((await other.patch(`/api/conversations/${conv.id}`, { title: 'pwned' })).statusCode).toBe(404);
    expect((await send(other, conv.id, { content: 'x' })).statusCode).toBe(404);
    expect((await other.get(`/api/streams/${r.assistantMessages[0].id}`)).statusCode).toBe(404);
    expect((await other.post(`/api/streams/${r.assistantMessages[0].id}/cancel`)).statusCode).toBe(404);
    expect((await other.del(`/api/conversations/${conv.id}/messages/${r.userMessage.id}`)).statusCode).toBe(404);
    expect((await other.post(`/api/conversations/${conv.id}/duplicate`)).statusCode).toBe(404);
    expect((await other.post('/api/conversations/bulk', { ids: [conv.id], action: 'delete' })).json().updated).toBe(0);
    expect((await user.get(`/api/conversations/${conv.id}`)).statusCode).toBe(200);
  });
});

describe('styles and instructions', () => {
  it('applies conversation instructions and styles to the system prompt', async () => {
    const style = (await user.post('/api/styles', { name: 'Pirate', instructions: 'Talk like a pirate.' })).json();
    await user.patch('/api/me/preferences', { customInstructions: 'Call me Captain.' });
    const conv = await newChat(user, { instructions: 'Answer in French.', settings: { styleId: style.id } });
    const r = (await send(user, conv.id, { content: 'hi' })).json();
    await streamEvents(user, r.assistantMessages[0].id);
    const sys = (mock.requests.filter((x) => x.path.includes('chat/completions')).at(-1)!.body as { messages: { role: string; content: string }[] }).messages[0]!;
    expect(sys.role).toBe('system');
    expect(sys.content).toContain('Call me Captain.');
    expect(sys.content).toContain('Answer in French.');
    expect(sys.content).toContain('Talk like a pirate.');
    expect(sys.content).toMatch(/untrusted DATA/);
    const list = (await user.get('/api/styles')).json();
    expect(list.builtin.map((s: { id: string }) => s.id)).toContain('learning');
    expect(list.custom[0].name).toBe('Pirate');
    expect((await other.patch(`/api/styles/${style.id}`, { name: 'x' })).statusCode).toBe(404);
    const derived = await user.post('/api/styles/from-sample', { name: 'Mine', sample: 'I write short sentences. Very short. I like lists. And dry humor, mostly.' });
    expect(derived.statusCode).toBe(201);
    expect((await user.del(`/api/styles/${style.id}`)).statusCode).toBe(204);
  });
});

describe('realtime sync', () => {
  it('pushes conversation events to the user over WebSocket and rejects foreign origins', async () => {
    const cookie = [...user.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const ws = await t.app.injectWS('/api/ws', { headers: { cookie, origin: 'http://localhost:5173' } });
    const got: string[] = [];
    ws.on('message', (d: Buffer) => got.push(JSON.parse(d.toString()).type));
    await newChat(user, { title: 'live' });
    await waitFor(async () => got.includes('conversation.upsert'));
    ws.terminate();
    const bad = await t.app.injectWS('/api/ws', { headers: { cookie, origin: 'https://evil.example' } });
    const code = await new Promise<number>((r) => bad.on('close', (c: number) => r(c)));
    expect(code).toBe(4403);
    const anon = await t.app.injectWS('/api/ws', { headers: { origin: 'http://localhost:5173' } });
    expect(await new Promise<number>((r) => anon.on('close', (c: number) => r(c)))).toBe(4401);
  });
});
