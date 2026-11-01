import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { startMockProvider, type MockProvider } from '@lumen/llm/mock';
import { createTestApp, extractToken, signup, type TestApp, type TestClient } from '../helpers/app.js';
import { send, setupMockModels, streamEvents } from '../helpers/chat.js';

const KEY = 'sk-artifact-test-key-0000000000';
let t: TestApp;
let mock: MockProvider;
let user: TestClient;
let unverified: TestClient;
let other: TestClient;

beforeAll(async () => {
  mock = await startMockProvider({ apiKey: KEY });
  t = await createTestApp({ env: { ALLOW_PRIVATE_PROVIDER_URLS: 'true' } });
  const admin = t.client();
  await signup(admin);
  const { ids } = await setupMockModels(t, admin, mock, KEY);
  await admin.patch(`/api/admin/models/${ids['mock-fast']}`, { recommended: true, capabilities: { tools: true, vision: false, json: true, reasoning: false, audio: false, imageGen: false } });
  user = t.client();
  const { email } = await signup(user);
  await user.post('/api/auth/verify-email', { token: extractToken(t.mail.lastTo(email)!.text, '/verify-email') });
  unverified = t.client();
  await signup(unverified);
  other = t.client();
  await signup(other);
});
afterAll(async () => {
  await t.close();
  await mock.close();
});

describe('artifacts via chat tools', () => {
  let convId = '';
  let artifactId = '';
  it('the model creates an artifact; the stream announces it', async () => {
    convId = (await user.post('/api/conversations', {})).json().id;
    const r = (await send(user, convId, { content: 'make a doc [tool:create_artifact {"type":"markdown","title":"Plan","content":"# Plan\\nStep one\\nStep two"}]' })).json();
    const events = await streamEvents(user, r.assistantMessages[0].id);
    const ev = events.find((e) => e.event.type === 'artifact')!.event as { id: string; version: number; action: string };
    expect(ev).toMatchObject({ version: 1, action: 'created', title: 'Plan', artifactType: 'markdown' });
    artifactId = ev.id;
    const list = (await user.get(`/api/conversations/${convId}/artifacts`)).json().items;
    expect(list.map((a: { id: string }) => a.id)).toEqual([artifactId]);
    expect((await user.get(`/api/artifacts/${artifactId}`)).json()).toMatchObject({ content: '# Plan\nStep one\nStep two', version: 1 });
    const sys = (mock.requests.filter((x) => x.path.includes('chat/completions')).at(-2)!.body as { messages: { content: string }[]; tools: { function: { name: string } }[] });
    expect(sys.tools.map((x) => x.function.name)).toEqual(expect.arrayContaining(['create_artifact', 'update_artifact', 'rewrite_artifact']));
    expect(sys.messages[0]!.content).toContain('Artifacts:');
  });

  it('edits by exact unique replacement and reports ambiguity as a tool error', async () => {
    const r = (await send(user, convId, { content: `edit [tool:update_artifact {"id":"${artifactId}","old_str":"Step two","new_str":"Step 2 (revised)"}]` })).json();
    const ev = await streamEvents(user, r.assistantMessages[0].id);
    expect(ev.find((e) => e.event.type === 'artifact')!.event).toMatchObject({ version: 2, action: 'updated' });
    expect((await user.get(`/api/artifacts/${artifactId}`)).json().content).toBe('# Plan\nStep one\nStep 2 (revised)');
    const bad = (await send(user, convId, { content: `edit [tool:update_artifact {"id":"${artifactId}","old_str":"Step","new_str":"X"}]` })).json();
    const bev = await streamEvents(user, bad.assistantMessages[0].id);
    expect(bev.find((e) => e.event.type === 'tool_result')!.event).toMatchObject({ isError: true, content: expect.stringContaining('more than once') });
  });

  it('versions: user edits, restore, labels, diff', async () => {
    expect((await user.post(`/api/artifacts/${artifactId}/versions`, { content: '# Plan\nRewritten by me', basedOn: 2 })).json().version).toBe(3);
    const restored = (await user.post(`/api/artifacts/${artifactId}/versions/1/restore`)).json();
    expect(restored.version).toBe(4);
    expect((await user.get(`/api/artifacts/${artifactId}`)).json().content).toBe('# Plan\nStep one\nStep two');
    await user.patch(`/api/artifacts/${artifactId}/versions/3`, { label: 'My draft' });
    const versions = (await user.get(`/api/artifacts/${artifactId}/versions`)).json().items;
    expect(versions.map((v: { version: number; source: string }) => `${v.version}:${v.source}`)).toEqual(['4:restore', '3:user', '2:ai', '1:ai']);
    expect(versions.find((v: { version: number }) => v.version === 3).label).toBe('My draft');
    expect((await user.get(`/api/artifacts/${artifactId}?version=3`)).json()).toMatchObject({ content: '# Plan\nRewritten by me', viewingVersion: 3 });
    const patch = (await user.get(`/api/artifacts/${artifactId}/diff?from=1&to=3`)).json().patch;
    expect(patch).toContain('-Step one');
    expect(patch).toContain('+Rewritten by me');
    expect((await user.post(`/api/artifacts/${artifactId}/edit`, { oldStr: 'nope', newStr: 'x' })).json().error.code).toBe('VALIDATION_FAILED');
  });

  it('isolates artifacts between users', async () => {
    expect((await other.get(`/api/artifacts/${artifactId}`)).statusCode).toBe(404);
    expect((await other.post(`/api/artifacts/${artifactId}/versions`, { content: 'x' })).statusCode).toBe(404);
    expect((await other.del(`/api/artifacts/${artifactId}`)).statusCode).toBe(404);
    expect((await other.get(`/api/artifacts/${artifactId}/storage/k`)).statusCode).toBe(404);
    expect((await other.post(`/api/artifacts/${artifactId}/fork`)).statusCode).toBe(404);
  });

  it('publishing requires a verified email; public links are read-only and noindex; forks are independent', async () => {
    const mine = (await unverified.post('/api/artifacts', { type: 'html', title: 'Page', content: '<h1>Hi</h1>' })).json();
    expect((await unverified.post(`/api/artifacts/${mine.id}/publish`)).json().error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    const pub = (await user.post(`/api/artifacts/${artifactId}/publish`)).json();
    expect(pub.published).toBe(true);
    const res = await t.client().get(`/api/public/artifacts/${pub.publicSlug}`);
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.json()).toMatchObject({ title: 'Plan', type: 'markdown' });
    expect(JSON.stringify(res.json())).not.toMatch(/userId|conversationId/);
    const fork = (await other.post(`/api/public/artifacts/${pub.publicSlug}/fork`)).json();
    expect(fork.title).toBe('Plan (remix)');
    await other.post(`/api/artifacts/${fork.id}/versions`, { content: 'changed' });
    expect((await user.get(`/api/artifacts/${artifactId}`)).json().content).not.toBe('changed');
    await user.post(`/api/artifacts/${artifactId}/unpublish`);
    expect((await t.client().get(`/api/public/artifacts/${pub.publicSlug}`)).statusCode).toBe(404);
  });
});

describe('exports', () => {
  it('produces real DOCX and PPTX files', async () => {
    const doc = (await user.post('/api/artifacts', { type: 'markdown', title: 'Report', content: '# Title\n\nSome **bold** text\n\n- item one\n- item two\n\n```\ncode()\n```' })).json();
    const docx = await user.get(`/api/artifacts/${doc.id}/export?format=docx`);
    expect(docx.headers['content-type']).toContain('wordprocessingml');
    const dz = unzipSync(new Uint8Array(docx.rawPayload));
    const xml = strFromU8(dz['word/document.xml']!);
    expect(xml).toContain('item two');
    expect(xml).toContain('<w:b/>');
    const deck = (await user.post('/api/artifacts', { type: 'slides', title: 'Deck', content: '# Intro\n- hello\n\nNote: say hi\n\n---\n\n# Results\n- up 20%' })).json();
    const pptx = await user.get(`/api/artifacts/${deck.id}/export?format=pptx`);
    const pz = unzipSync(new Uint8Array(pptx.rawPayload));
    expect(Object.keys(pz).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(2);
    expect(strFromU8(pz['ppt/slides/slide2.xml']!)).toContain('up 20%');
    expect((await user.get(`/api/artifacts/${deck.id}/export?format=docx`)).json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('mini-app APIs', () => {
  it('per-viewer storage with limits, shared values, and AI calls on the viewer quota', async () => {
    const app = (await user.post('/api/artifacts', { type: 'html', title: 'Counter', content: '<button>+</button>' })).json();
    await user.put(`/api/artifacts/${app.id}/storage/count`, { value: { n: 3 } });
    expect((await user.get(`/api/artifacts/${app.id}/storage/count`)).json()).toEqual({ value: { n: 3 } });
    expect((await user.get(`/api/artifacts/${app.id}/storage`)).json().items).toEqual([{ key: 'count', shared: false }]);
    expect((await user.put(`/api/artifacts/${app.id}/storage/big`, { value: 'x'.repeat(70_000) })).json().error.code).toBe('PAYLOAD_TOO_LARGE');
    expect((await user.put(`/api/artifacts/${app.id}/storage/bad%20key`, { value: 1 })).statusCode).toBe(400);
    await user.put(`/api/artifacts/${app.id}/storage/motd`, { value: 'hello', shared: true });
    const pub = (await user.post(`/api/artifacts/${app.id}/publish`)).json();
    expect(pub.published).toBe(true);
    // Another user of the published app gets their own private values plus the owner's shared ones.
    expect((await other.get(`/api/artifacts/${app.id}/storage/count`)).json()).toEqual({ value: null });
    expect((await other.get(`/api/artifacts/${app.id}/storage/motd?shared=true`)).json()).toEqual({ value: 'hello' });
    expect((await other.put(`/api/artifacts/${app.id}/storage/motd`, { value: 'x', shared: true })).json().error.code).toBe('FORBIDDEN');
    const before = await t.c.entitlements.usage((await other.get('/api/me')).json().user.id, 'messages');
    const ai = (await other.post(`/api/artifacts/${app.id}/ai`, { prompt: 'say hi' })).json();
    expect(ai.text).toBe('You said: say hi');
    expect(await t.c.entitlements.usage((await other.get('/api/me')).json().user.id, 'messages')).toBe(before + 1);
    await user.del(`/api/artifacts/${app.id}/storage/count`);
    expect((await user.get(`/api/artifacts/${app.id}/storage/count`)).json()).toEqual({ value: null });
  });

  it('lists the gallery and deletes', async () => {
    const items = (await user.get('/api/artifacts?type=slides')).json().items;
    expect(items.every((a: { type: string }) => a.type === 'slides')).toBe(true);
    expect(items[0].preview).toContain('# Intro');
    expect((await user.del(`/api/artifacts/${items[0].id}`)).statusCode).toBe(204);
    expect((await user.get(`/api/artifacts/${items[0].id}`)).statusCode).toBe(404);
  });
});
