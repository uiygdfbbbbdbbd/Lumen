import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startMockProvider, type MockProvider } from '@lumen/llm/mock';
import { memories } from '../../src/db/schema/index.js';
import { MEMORY_CONSOLIDATE_JOB } from '../../src/services/memory/memory.service.js';
import { createTestApp, signup, type TestApp, type TestClient } from '../helpers/app.js';
import { send, setupMockModels, streamEvents } from '../helpers/chat.js';

const KEY = 'sk-memory-test-key-00000000000';
let t: TestApp;
let mock: MockProvider;
let admin: TestClient;
let user: TestClient;
let userId = '';
let other: TestClient;

type Req = { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] };
const firstOfTurn = (): Req => {
  const reqs = mock.requests.filter((x) => x.path.includes('chat/completions'));
  // Tool turns make two requests; the first has no tool results yet.
  const i = reqs.findLastIndex((r) => !(r.body as Req).messages.some((m) => m.role === 'tool'));
  return reqs[i]!.body as Req;
};
const toolNames = (r: Req) => (r.tools ?? []).map((x) => x.function.name);

async function chat(client: TestClient, content: string, body: Record<string, unknown> = {}) {
  const conv = (await client.post('/api/conversations', body)).json();
  const r = (await send(client, conv.id, { content })).json();
  const events = await streamEvents(client, r.assistantMessages[0].id);
  return { convId: conv.id as string, messageId: r.assistantMessages[0].id as string, events };
}

beforeAll(async () => {
  mock = await startMockProvider({ apiKey: KEY });
  t = await createTestApp({ env: { ALLOW_PRIVATE_PROVIDER_URLS: 'true' } });
  admin = t.client();
  await signup(admin);
  const { ids } = await setupMockModels(t, admin, mock, KEY);
  await admin.patch(`/api/admin/models/${ids['mock-fast']}`, { recommended: true, capabilities: { tools: true, vision: false, json: true, reasoning: false, audio: false, imageGen: false } });
  user = t.client();
  await signup(user);
  userId = (await user.get('/api/me')).json().user.id;
  other = t.client();
  await signup(other);
});
afterAll(async () => {
  await t.close();
  await mock.close();
});

describe('the model manages its own memory', () => {
  let convId = '';
  let memoryId = '';
  it('memory_write saves a memory with provenance', async () => {
    const r = await chat(user, 'remember this [tool:memory_write {"content":"Prefers metric units.","category":"preferences"}]');
    convId = r.convId;
    expect(r.events.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ isError: false, content: expect.stringContaining('Saved to memory') });
    expect(toolNames(firstOfTurn())).toEqual(expect.arrayContaining(['memory_write', 'memory_search', 'memory_update', 'memory_delete', 'conversation_search']));
    expect(firstOfTurn().messages[0]!.content).toContain('Memory: you can remember things about the user');
    const list = (await user.get('/api/memories')).json();
    expect(list.enabled).toBe(true);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ content: 'Prefers metric units.', category: 'preferences', source: 'ai', conversationId: convId, messageId: r.messageId });
    memoryId = list.items[0].id;
  });

  it('saying it again updates the same memory instead of duplicating it', async () => {
    const r = await chat(user, 'again [tool:memory_write {"content":"prefers metric units","category":"preferences"}]');
    expect(r.events.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ content: expect.stringContaining('Already remembered') });
    expect((await user.get('/api/memories')).json().items).toHaveLength(1);
  });

  it('later chats get relevant memories in the prompt and record which were used', async () => {
    const r = await chat(user, 'how far is 5 miles?');
    expect(firstOfTurn().messages[0]!.content).toContain('What you remember about the user');
    expect(firstOfTurn().messages[0]!.content).toContain(`(id: ${memoryId}, preferences) prefers metric units`);
    expect(r.events.find((e) => e.event.type === 'memory')!.event).toEqual({ type: 'memory', ids: [memoryId] });
    const tree = (await user.get(`/api/conversations/${r.convId}`)).json();
    const msg = tree.messages.find((m: { id: string }) => m.id === r.messageId);
    expect(msg.parts).toEqual(expect.arrayContaining([{ type: 'memory', ids: [memoryId] }]));
    const lookup = (await user.get(`/api/memories/lookup?ids=${memoryId}`)).json().items;
    expect(lookup[0].id).toBe(memoryId);
    expect(lookup[0].useCount).toBeGreaterThanOrEqual(1);
    expect((await other.get(`/api/memories/lookup?ids=${memoryId}`)).json().items).toEqual([]);
  });

  it('never stores secrets', async () => {
    const r = await chat(user, 'save [tool:memory_write {"content":"My password is hunter2","category":"other"}]');
    expect(r.events.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ isError: true, content: expect.stringContaining('never saved to memory') });
    const card = await user.post('/api/memories', { content: 'Card 4111 1111 1111 1111', category: 'other' });
    expect(card.statusCode).toBe(400);
    const key = await user.post('/api/memories', { content: 'My key is sk-proj-abcdefghijklmnopqrstuvwx', category: 'other' });
    expect(key.statusCode).toBe(400);
    expect((await user.post('/api/memories', { content: 'My secret is that I love cake', category: 'other' })).statusCode).toBe(201);
  });

  it('"forget that" works through memory_search and memory_delete', async () => {
    const s = await chat(user, 'what do you know? [tool:memory_search {"query":"metric"}]');
    expect(s.events.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ content: expect.stringContaining(memoryId) });
    const d = await chat(user, `forget it [tool:memory_delete {"id":"${memoryId}"}]`);
    expect(d.events.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ isError: false, content: 'Forgot: prefers metric units' });
    expect((await user.get('/api/memories?q=metric')).json().items).toEqual([]);
  });

  it('memory_update changes a fact; other users’ memories are out of reach', async () => {
    const m = (await user.post('/api/memories', { content: 'Works as a nurse.', category: 'profile' })).json().memory;
    const u = await chat(user, `I changed jobs [tool:memory_update {"id":"${m.id}","content":"Works as a teacher."}]`);
    expect(u.events.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ isError: false });
    expect((await user.get('/api/memories?category=profile')).json().items[0].content).toBe('Works as a teacher.');
    const o = await chat(other, `[tool:memory_delete {"id":"${m.id}"}]`);
    expect(o.events.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ isError: true, content: expect.stringContaining('not found') });
  });
});

describe('when memory is not used', () => {
  it('temporary chats neither read nor write memory, nor search history', async () => {
    const r = await chat(user, 'hi there', { incognito: true });
    const req = firstOfTurn();
    expect(toolNames(req)).not.toContain('memory_write');
    expect(toolNames(req)).not.toContain('conversation_search');
    expect(req.messages[0]!.content).not.toContain('What you remember');
    expect(r.events.some((e) => e.event.type === 'memory')).toBe(false);
  });

  it('a chat with memory turned off gets no memories or memory tools', async () => {
    await chat(user, 'teacher', { settings: { useMemory: false } });
    expect(toolNames(firstOfTurn())).not.toContain('memory_write');
    expect(firstOfTurn().messages[0]!.content).not.toContain('What you remember');
  });

  it('pausing memory stops reads and writes; history search can be turned off separately', async () => {
    await user.patch('/api/me/preferences', { memoryEnabled: false, chatHistorySearch: false });
    await chat(user, 'teacher');
    expect(toolNames(firstOfTurn())).not.toContain('memory_write');
    expect(toolNames(firstOfTurn())).not.toContain('conversation_search');
    expect(firstOfTurn().messages[0]!.content).not.toContain('What you remember');
    expect((await user.get('/api/memories')).json().enabled).toBe(false);
    await user.patch('/api/me/preferences', { memoryEnabled: true, chatHistorySearch: true });
  });
});

describe('scopes and retrieval', () => {
  it('project memories are only used inside that project', async () => {
    const project = (await user.post('/api/projects', { name: 'Garden' })).json();
    await user.post('/api/memories', { content: 'Grows tomatoes in raised beds.', category: 'projects', projectId: project.id });
    await chat(user, 'tomatoes?');
    expect(firstOfTurn().messages[0]!.content).not.toContain('raised beds');
    await chat(user, 'tomatoes?', { projectId: project.id });
    expect(firstOfTurn().messages[0]!.content).toContain('raised beds');
    expect((await user.get(`/api/memories?scope=${project.id}`)).json().items).toHaveLength(1);
    expect((await user.get('/api/memories?scope=global')).json().items.some((m: { content: string }) => m.content.includes('raised beds'))).toBe(false);
  });

  it('with many memories, relevant and pinned ones win the token budget', async () => {
    await admin.put('/api/admin/settings/memory', { maxPerTurn: 2 });
    for (let i = 0; i < 6; i++) await user.post('/api/memories', { content: `Unrelated hobby number ${i} involves knitting scarves.`, category: 'other' });
    await user.post('/api/memories', { content: 'Owns a golden retriever named Biscuit.', category: 'people' });
    const pinned = (await user.post('/api/memories', { content: 'Writes in British English.', category: 'preferences', pinned: true })).json().memory;
    await chat(user, 'any tips for my retriever Biscuit?');
    const sys = firstOfTurn().messages[0]!.content;
    expect(sys).toContain('Biscuit');
    expect(sys).toContain(pinned.id);
    expect(sys).not.toContain('knitting');
    await admin.put('/api/admin/settings/memory', { maxPerTurn: 15 });
  });

  it('conversation_search finds earlier chats', async () => {
    const first = await chat(user, 'Let us plan the zanzibar itinerary');
    const r = await chat(user, '[tool:conversation_search {"query":"zanzibar"}]');
    const result = r.events.find((e) => e.event.type === 'tool_result')!.event as { content: string };
    expect(result.content).toContain(`chat id ${first.convId}`);
  });
});

describe('managing memory', () => {
  it('create, edit, pin, filter, delete; strangers get 404', async () => {
    const m = (await user.post('/api/memories', { content: 'Has two cats.', category: 'people' })).json().memory;
    const p = (await user.patch(`/api/memories/${m.id}`, { content: 'Has three cats.', pinned: true })).json();
    expect(p).toMatchObject({ content: 'Has three cats.', pinned: true });
    expect((await user.get('/api/memories?q=cats')).json().items.map((x: { id: string }) => x.id)).toEqual([m.id]);
    expect((await other.patch(`/api/memories/${m.id}`, { pinned: false })).statusCode).toBe(404);
    expect((await other.del(`/api/memories/${m.id}`)).statusCode).toBe(404);
    expect((await user.patch(`/api/memories/${m.id}`, { content: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await user.del(`/api/memories/${m.id}`)).statusCode).toBe(204);
    expect((await user.get('/api/memories?q=cats')).json().items).toEqual([]);
  });

  it('imports another assistant’s export with a preview that flags duplicates and secrets', async () => {
    const text = '# Saved memories\n- [2025-01-02] Prefers dark mode in every app\n- Lives in Lisbon\n* My password is swordfish\n1. Writes in British English\n- Lives in Lisbon';
    const preview = (await user.post('/api/memories/import/preview', { text })).json().entries;
    expect(preview.map((e: { content: string }) => e.content)).toEqual(['Prefers dark mode in every app', 'Lives in Lisbon', 'My password is swordfish', 'Writes in British English']);
    expect(preview[0]).toMatchObject({ category: 'preferences', duplicate: false, rejected: null });
    expect(preview[1].category).toBe('profile');
    expect(preview[2].rejected).toMatch(/password/);
    expect(preview[3].duplicate).toBe(true);
    const json = (await user.post('/api/memories/import/preview', { text: JSON.stringify({ memories: [{ content: 'Training for a marathon', category: 'tasks' }, 'Allergic to nothing'] }) })).json().entries;
    expect(json.map((e: { category: string }) => e.category)).toEqual(['tasks', 'other']);
    const r = (await user.post('/api/memories/import', { entries: preview.filter((e: { rejected: string | null }) => !e.rejected).map(({ content, category }: { content: string; category: string }) => ({ content, category })) })).json();
    expect(r).toMatchObject({ created: 2, merged: 1, skipped: [] });
    expect((await user.get('/api/memories?q=Lisbon')).json().items[0]).toMatchObject({ source: 'import', category: 'profile' });
  });

  it('exports everything as JSON', async () => {
    const r = await user.get('/api/memories/export');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="lumen-memories-/);
    const data = r.json();
    expect(data.version).toBe(1);
    expect(data.memories.some((m: { content: string }) => m.content === 'Lives in Lisbon')).toBe(true);
    expect(JSON.stringify(data)).not.toContain('embedding');
  });

  it('consolidation merges duplicates and writes a summary; writes queue it automatically', async () => {
    const [{ id: a }] = await t.c.db.insert(memories).values({ userId, content: 'Enjoys hiking in the Alps.', category: 'preferences' }).returning({ id: memories.id });
    await t.c.db.insert(memories).values({ userId, content: 'enjoys hiking in the alps', category: 'preferences', pinned: true });
    const r = (await user.post('/api/memories/consolidate')).json();
    expect(r.merged).toBeGreaterThanOrEqual(1);
    const hiking = (await user.get('/api/memories?q=hiking')).json().items;
    expect(hiking).toHaveLength(1);
    expect(hiking[0]).toMatchObject({ pinned: true });
    expect(hiking[0].id).not.toBe(a);
    const s = (await user.get('/api/memories/summary')).json();
    expect(s).toMatchObject({ memoryCount: r.total, pendingWrites: 0 });
    expect(s.content).toContain('## Preferences');
    expect(s.content).toContain('hiking');

    await admin.put('/api/admin/settings/memory', { consolidateAfterWrites: 2 });
    const spy = vi.spyOn(t.c.jobs, 'enqueue').mockImplementation(async () => undefined);
    await user.post('/api/memories', { content: 'Plays the cello.', category: 'profile' });
    await user.post('/api/memories', { content: 'Reads sci-fi novels.', category: 'preferences' });
    expect(spy).toHaveBeenCalledWith(MEMORY_CONSOLIDATE_JOB, { userId }, expect.objectContaining({ jobId: `memory-consolidate:${userId}` }));
    spy.mockRestore();
  });

  it('"forget everything" needs the confirmation phrase and deletes it all', async () => {
    expect((await user.post('/api/memories/forget-all', { confirm: 'yes' })).statusCode).toBe(400);
    const r = (await user.post('/api/memories/forget-all', { confirm: 'forget everything' })).json();
    expect(r.deleted).toBeGreaterThan(3);
    expect((await user.get('/api/memories')).json().items).toEqual([]);
    expect((await user.get('/api/memories/summary')).json()).toMatchObject({ content: '', memoryCount: 0 });
    expect(await t.c.db.select().from(memories).where(eq(memories.userId, userId))).toEqual([]);
  });
});
