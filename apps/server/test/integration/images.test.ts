import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockProvider, type MockProvider } from '@lumen/llm/mock';
import { createTestApp, signup, type TestApp, type TestClient } from '../helpers/app.js';
import { send, setupMockModels, streamEvents } from '../helpers/chat.js';

const KEY = 'sk-images-test-key-00000000000';
let t: TestApp;
let mock: MockProvider;
let admin: TestClient;
let user: TestClient;
let other: TestClient;

beforeAll(async () => {
  mock = await startMockProvider({ apiKey: KEY });
  t = await createTestApp({ env: { ALLOW_PRIVATE_PROVIDER_URLS: 'true' } });
  admin = t.client();
  await signup(admin);
  const { ids } = await setupMockModels(t, admin, mock, KEY);
  await admin.patch(`/api/admin/models/${ids['mock-fast']}`, { recommended: true, capabilities: { tools: true, vision: false, json: true, reasoning: false, audio: false, imageGen: false } });
  user = t.client();
  await signup(user);
  other = t.client();
  await signup(other);
});
afterAll(async () => {
  await t.close();
  await mock.close();
});

describe('image models', () => {
  it('are listed separately from chat models and never become the chat default', async () => {
    const chat = (await user.get('/api/models')).json().items.map((m: { displayName: string }) => m.displayName);
    expect(chat).not.toContain('mock-image');
    const images = (await user.get('/api/models?kind=image')).json().items.map((m: { displayName: string }) => m.displayName);
    expect(images).toEqual(['mock-image']);
    expect((await user.get('/api/images/models')).json().items).toHaveLength(1);
  });
});

describe('generating images', () => {
  let firstId = '';
  it('creates images stored as files and served as PNGs', async () => {
    const r = await user.post('/api/images', { prompt: 'A lighthouse at dusk', aspectRatio: '16:9', n: 2 });
    expect(r.statusCode).toBe(201);
    const items = r.json().items as { id: string; url: string; revisedPrompt: string; aspectRatio: string; modelName: string }[];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ aspectRatio: '16:9', modelName: 'mock-image', revisedPrompt: 'A lighthouse at dusk (mock)' });
    const img = await user.get(items[0]!.url);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.rawPayload.subarray(0, 4).toString('hex')).toBe('89504e47');
    // 16:9 maps to a landscape size (the mock scales 1536x1024 down by 32).
    expect(img.rawPayload.readUInt32BE(16)).toBe(48);
    expect(img.rawPayload.readUInt32BE(20)).toBe(32);
    firstId = items[0]!.id;
    const req = mock.requests.filter((x) => x.path.includes('images/generations')).at(-1)!.body as Record<string, unknown>;
    expect(req).toMatchObject({ model: 'mock-image', n: 2, size: '1536x1024', response_format: 'b64_json' });
  });

  it('makes variations, lists the gallery, and keeps images private', async () => {
    const v = (await user.post(`/api/images/${firstId}/variations`, { n: 1 })).json().items;
    expect(v[0]).toMatchObject({ variationOf: firstId, prompt: 'A lighthouse at dusk' });
    const list = (await user.get('/api/images')).json().items;
    expect(list).toHaveLength(3);
    expect((await other.get('/api/images')).json().items).toEqual([]);
    expect((await other.post(`/api/images/${firstId}/variations`, {})).statusCode).toBe(404);
    expect((await other.get(list[0].url)).statusCode).toBe(404);
  });

  it('refunds the daily cap when the provider refuses, then enforces it', async () => {
    const blocked = await user.post('/api/images', { prompt: 'something [blocked]' });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error.code).toBe('CONTENT_BLOCKED');
    // Unverified accounts get 5 a day: 3 used so far.
    expect((await user.post('/api/images', { prompt: 'two more', n: 2 })).statusCode).toBe(201);
    const over = await user.post('/api/images', { prompt: 'one too many' });
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe('QUOTA_EXCEEDED');
  });

  it('the model can generate images in chat', async () => {
    const conv = (await other.post('/api/conversations', {})).json();
    const r = (await send(other, conv.id, { content: 'draw [tool:generate_image {"prompt":"a red fox in snow","aspect_ratio":"9:16"}]' })).json();
    const events = await streamEvents(other, r.assistantMessages[0].id);
    const result = events.find((e) => e.event.type === 'tool_result')!.event as { content: string; isError: boolean };
    expect(result).toMatchObject({ isError: false });
    const id = /image ids: ([0-9a-f-]{36})/.exec(result.content)![1]!;
    const items = (await other.get(`/api/images?ids=${id}`)).json().items;
    expect(items[0]).toMatchObject({ id, aspectRatio: '9:16', conversationId: conv.id });
    const sys = mock.requests.filter((x) => x.path.includes('chat/completions')).at(-2)!.body as { tools: { function: { name: string } }[] };
    expect(sys.tools.map((x) => x.function.name)).toContain('generate_image');
  });

  it('deletes an image and its file', async () => {
    const list = (await user.get('/api/images')).json().items;
    expect((await user.del(`/api/images/${list[0].id}`)).statusCode).toBe(204);
    expect((await user.get(list[0].url)).statusCode).toBe(404);
    expect((await user.get('/api/images')).json().items).toHaveLength(list.length - 1);
  });
});
