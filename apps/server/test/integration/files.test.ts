import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import { startMockProvider, type MockProvider } from '@lumen/llm/mock';
import { createTestApp, extractToken, signup, type TestApp, type TestClient } from '../helpers/app.js';
import { send, setupMockModels, streamEvents, textOf } from '../helpers/chat.js';
import { makePdf } from '../helpers/fixtures.js';

const KEY = 'sk-files-test-key-000000000000';
let t: TestApp;
let mock: MockProvider;
let admin: TestClient;
let user: TestClient;
let other: TestClient;
let ids: Record<string, string>;
let web: http.Server;
let webUrl = '';

function multipart(file: Buffer, filename: string, fields: Record<string, string> = {}) {
  const b = '----lumenFiles';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
async function upload(c: TestClient, data: Buffer | string, name: string, fields: Record<string, string> = {}) {
  const m = multipart(Buffer.isBuffer(data) ? data : Buffer.from(data), name, fields);
  return c.request('POST', '/api/files', m.payload, m.headers);
}
async function ready(c: TestClient, id: string) {
  await t.c.jobs.drain();
  return (await c.get(`/api/files/${id}`)).json();
}

beforeAll(async () => {
  mock = await startMockProvider({ apiKey: KEY });
  web = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><head><title>Volcano facts</title></head><body><article><h1>Volcanoes</h1>${'<p>Mount Etna is an active stratovolcano on the east coast of Sicily. </p>'.repeat(15)}</article></body></html>`);
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  webUrl = `http://127.0.0.1:${(web.address() as AddressInfo).port}/etna`;
  t = await createTestApp({
    env: { ALLOW_PRIVATE_PROVIDER_URLS: 'true' },
    overrides: {
      urlFetch: { allowPrivate: true },
      scanner: { scan: async (d: Buffer) => (d.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) ? 'Eicar-Test-Signature' : null) },
    },
  });
  admin = t.client();
  await signup(admin);
  ({ ids } = await setupMockModels(t, admin, mock, KEY));
  await admin.patch(`/api/admin/models/${ids['mock-fast']}`, { recommended: true, capabilities: { tools: true, vision: true, json: true, reasoning: false, audio: false, imageGen: false } });
  await admin.put('/api/admin/settings/rag', { embeddingModelId: ids['mock-embed'] });
  user = t.client();
  const { email } = await signup(user);
  await user.post('/api/auth/verify-email', { token: extractToken(t.mail.lastTo(email)!.text, '/verify-email') });
  other = t.client();
  await signup(other);
});
afterAll(async () => {
  await t.close();
  await mock.close();
  await new Promise<void>((r) => web.close(() => r()));
});

describe('uploads and processing', () => {
  it('uploads, extracts, chunks and embeds a document', async () => {
    const res = await upload(user, makePdf(['The capital of Freedonia is Fredville.', 'Freedonia exports marmalade.']), 'freedonia.pdf');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ kind: 'pdf', status: 'queued' });
    const f = await ready(user, res.json().id);
    expect(f).toMatchObject({ status: 'ready', pageCount: 2, embedded: true });
    expect(f.chunkCount).toBeGreaterThanOrEqual(1);
    const [row] = (await t.c.db.execute(sql`SELECT count(*)::int AS n FROM file_chunks WHERE file_id = ${f.id} AND embedding IS NOT NULL`)) as unknown as { n: number }[];
    expect(row!.n).toBe(f.chunkCount);
    expect((await user.get(`/api/files/${f.id}/text`)).json().text).toContain('[Page 2]');
  });

  it('dedupes identical uploads and rejects spoofed types and executables', async () => {
    const a = (await upload(user, 'same content here', 'a.txt')).json();
    const b = (await upload(user, 'same content here', 'b.txt')).json();
    expect(b.id).toBe(a.id);
    expect((await upload(user, makePdf(['x']), 'photo.png')).json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect((await upload(user, Buffer.from('MZ\x90\x00'), 'setup.exe')).json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('quarantines infected files and refuses to serve them', async () => {
    const r = (await upload(user, 'X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'eicar.txt')).json();
    expect(r.status).toBe('quarantined');
    expect((await user.get(`/api/files/${r.id}/content`)).json().error.code).toBe('FORBIDDEN');
  });

  it('enforces per-file size and total storage limits per tier', async () => {
    const unverified = t.client();
    await signup(unverified);
    const big = await unverified.post('/api/uploads', { name: 'big.pdf', size: 11 * 1024 * 1024, mimeType: 'application/pdf' });
    expect(big.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    const me = (await unverified.get('/api/me')).json().user.id;
    await t.c.db.execute(sql`UPDATE users SET overrides = '{"limits":{"storageBytes":100}}'::jsonb WHERE id = ${me}`);
    expect((await upload(unverified, 'x'.repeat(200), 'n.txt')).json().error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    const s = (await user.get('/api/files/storage')).json();
    expect(s.usedBytes).toBeGreaterThan(0);
    expect(s.limitBytes).toBe(5 * 1024 ** 3);
  });

  it('resumable chunked upload with offset checks', async () => {
    const data = Buffer.from('Resumable '.repeat(300));
    const s = (await user.post('/api/uploads', { name: 'resume.txt', size: data.length, mimeType: 'text/plain' })).json();
    const put = (offset: number, chunk: Buffer) => user.request('PATCH', `/api/uploads/${s.id}`, chunk, { 'content-type': 'application/offset+octet-stream', 'upload-offset': String(offset) });
    expect((await put(0, data.subarray(0, 1000))).json()).toEqual({ offset: 1000, file: null });
    expect((await put(500, data.subarray(500, 1500))).json().error).toMatchObject({ code: 'CONFLICT', details: { offset: 1000 } });
    expect((await user.get(`/api/uploads/${s.id}`)).json().offset).toBe(1000);
    await put(1000, data.subarray(1000, 2000));
    const done = (await put(2000, data.subarray(2000))).json();
    expect(done.file).toMatchObject({ name: 'resume.txt' });
    expect((await ready(user, done.file.id)).status).toBe('ready');
    expect((await other.get(`/api/uploads/${s.id}`)).statusCode).toBe(404);
  });

  it('serves content with safe headers and isolates users', async () => {
    const f = (await upload(user, '<html><script>alert(1)</script></html>', 'page.html')).json();
    const res = await user.get(`/api/files/${f.id}/content`);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['content-type']).toMatch(/application\/octet-stream/);
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect((await other.get(`/api/files/${f.id}`)).statusCode).toBe(404);
    expect((await other.get(`/api/files/${f.id}/content`)).statusCode).toBe(404);
    expect((await other.del(`/api/files/${f.id}`)).statusCode).toBe(404);
    expect((await user.patch(`/api/files/${f.id}`, { name: 'renamed.html' })).json().name).toBe('renamed.html');
    expect((await user.del(`/api/files/${f.id}`)).statusCode).toBe(204);
  });
});

describe('retrieval + chat with files', () => {
  it('inlines small attachments into the system prompt', async () => {
    const f = (await upload(user, 'The secret project codename is BLUEBIRD.', 'memo.txt')).json();
    await ready(user, f.id);
    const conv = (await user.post('/api/conversations', {})).json();
    const r = (await send(user, conv.id, { content: 'what is the codename?', attachments: [f.id] })).json();
    expect(r.userMessage.parts[0]).toMatchObject({ type: 'attachment', name: 'memo.txt' });
    await streamEvents(user, r.assistantMessages[0].id);
    const sys = (mock.requests.filter((x) => x.path.includes('chat/completions')).at(-1)!.body as { messages: { content: string }[] }).messages[0]!.content;
    expect(sys).toContain('BLUEBIRD');
    expect(sys).toContain('untrusted data');
  });

  it('retrieves cited excerpts from large files and exposes file_search', async () => {
    await admin.put('/api/admin/settings/rag', { inlineTokenLimit: 50 });
    const doc = [
      'Chapter one discusses the migration of arctic terns across the globe.',
      'Chapter two covers the economics of saffron farming in Iran and Spain.',
      'Chapter three explains how glaciers carve fjords over millennia.',
    ]
      .map((p) => `${p} ${'Filler sentence about nothing in particular. '.repeat(40)}`)
      .join('\n\n');
    const f = (await upload(user, doc, 'book.md')).json();
    expect((await ready(user, f.id)).chunkCount).toBeGreaterThanOrEqual(3);
    const conv = (await user.post('/api/conversations', {})).json();
    const r = (await send(user, conv.id, { content: 'tell me about saffron farming economics', attachments: [f.id] })).json();
    const events = await streamEvents(user, r.assistantMessages[0].id);
    const cites = events.find((e) => e.event.type === 'citations')!.event as { items: { n: number; snippet: string; fileName: string }[] };
    expect(cites.items[0]!.snippet).toContain('saffron');
    expect(cites.items[0]!.fileName).toBe('book.md');
    const sys = (mock.requests.filter((x) => x.path.includes('chat/completions')).at(-1)!.body as { messages: { content: string }[]; tools?: { function: { name: string } }[] });
    expect(sys.messages[0]!.content).toContain('[1] book.md');
    expect(sys.tools!.map((x) => x.function.name)).toContain('file_search');
    const tree = (await user.get(`/api/conversations/${conv.id}`)).json();
    expect(tree.messages.find((m: { id: string }) => m.id === r.assistantMessages[0].id).parts.some((p: { type: string }) => p.type === 'citation')).toBe(true);
    // The model can search again with the tool.
    const r2 = (await send(user, conv.id, { content: 'find more [tool:file_search {"query":"glaciers fjords"}]' })).json();
    expect(textOf(await streamEvents(user, r2.assistantMessages[0].id))).toContain('glaciers carve fjords');
    // Source chunk preview for a citation.
    const chunkId = tree.messages.find((m: { id: string }) => m.id === r.assistantMessages[0].id).parts.find((p: { type: string }) => p.type === 'citation').chunkId;
    expect((await user.get(`/api/chunks/${chunkId}`)).json().fileName).toBe('book.md');
    expect((await other.get(`/api/chunks/${chunkId}`)).statusCode).toBe(404);
    await admin.put('/api/admin/settings/rag', { inlineTokenLimit: 8000 });
  });

  it('sends attached images to vision models', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00f' } }).png().toBuffer();
    const f = (await upload(user, png, 'blue.png')).json();
    await ready(user, f.id);
    const conv = (await user.post('/api/conversations', {})).json();
    const r = (await send(user, conv.id, { content: 'what color?', attachments: [f.id] })).json();
    await streamEvents(user, r.assistantMessages[0].id);
    const msgs = (mock.requests.filter((x) => x.path.includes('chat/completions')).at(-1)!.body as { messages: { role: string; content: unknown }[] }).messages;
    const last = msgs.at(-1)!.content as { type: string; image_url?: { url: string } }[];
    expect(last.map((p) => p.type)).toEqual(['text', 'image_url']);
    expect(last[1]!.image_url!.url).toMatch(/^data:image\/png;base64,/);
  });

  it('refuses attachments that are not ready or not yours', async () => {
    const conv = (await user.post('/api/conversations', {})).json();
    const mine = (await upload(other, 'others data', 'o.txt')).json();
    expect((await send(user, conv.id, { content: 'x', attachments: [mine.id] })).statusCode).toBe(404);
    const f = (await upload(user, 'processing...', 'p.txt')).json();
    expect((await send(user, conv.id, { content: 'x', attachments: [f.id] })).json().error.code).toBe('CONFLICT');
    await t.c.jobs.drain();
  });
});

describe('projects', () => {
  it('template, knowledge (file/note/url), project chats with instructions + retrieval', async () => {
    const p = (await user.post('/api/projects', { name: 'Geology', templateId: 'research-assistant' })).json();
    expect(p.instructions).toMatch(/research assistant/);
    await user.post(`/api/projects/${p.id}/notes`, { title: 'Field notes', text: 'Basalt columns form when lava cools slowly and contracts.' });
    await user.post(`/api/projects/${p.id}/urls`, { url: webUrl, recrawlHours: 24 });
    await upload(user, 'Granite is an intrusive igneous rock.', 'granite.txt', { projectId: p.id });
    await t.c.jobs.drain();
    const dash = (await user.get(`/api/projects/${p.id}`)).json();
    expect(dash.knowledge.map((k: { name: string; status: string }) => [k.name, k.status]).sort()).toEqual([
      ['Field notes.md', 'ready'],
      ['Volcano facts', 'ready'],
      ['granite.txt', 'ready'],
    ]);
    expect(dash.starters.length).toBeGreaterThan(0);

    const conv = (await user.post('/api/conversations', { projectId: p.id })).json();
    const r = (await send(user, conv.id, { content: 'How do basalt columns form?' })).json();
    await streamEvents(user, r.assistantMessages[0].id);
    const body = mock.requests.filter((x) => x.path.includes('chat/completions')).at(-1)!.body as { messages: { content: string }[] };
    expect(body.messages[0]!.content).toContain('Project "Geology" instructions');
    expect(body.messages[0]!.content).toContain('Basalt columns form');
    expect((await user.get(`/api/projects/${p.id}`)).json().chats[0].id).toBe(conv.id);
  });

  it('enforces the viewer/editor/owner matrix', async () => {
    const p = (await user.post('/api/projects', { name: 'Private' })).json();
    const f = (await upload(user, 'confidential plan', 'plan.txt', { projectId: p.id })).json();
    await t.c.jobs.drain();
    expect((await other.get(`/api/projects/${p.id}`)).statusCode).toBe(404);
    expect((await other.get(`/api/files?projectId=${p.id}`)).statusCode).toBe(404);
    expect((await upload(other, 'x', 'x.txt', { projectId: p.id })).statusCode).toBe(404);
    const otherId = (await other.get('/api/me')).json().user.id;
    await t.c.db.execute(sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${p.id}, ${otherId}, 'viewer')`);
    expect((await other.get(`/api/projects/${p.id}`)).json().project.role).toBe('viewer');
    expect((await other.get(`/api/files/${f.id}`)).statusCode).toBe(200);
    expect((await upload(other, 'x', 'x.txt', { projectId: p.id })).json().error.code).toBe('FORBIDDEN');
    expect((await other.patch(`/api/projects/${p.id}`, { name: 'hacked' })).statusCode).toBe(403);
    expect((await other.del(`/api/files/${f.id}`)).statusCode).toBe(404);
    await t.c.db.execute(sql`UPDATE project_members SET role = 'editor' WHERE project_id = ${p.id} AND user_id = ${otherId}`);
    expect((await upload(other, 'editor note', 'e.txt', { projectId: p.id })).statusCode).toBe(201);
    expect((await other.del(`/api/projects/${p.id}`)).statusCode).toBe(403);
    expect((await other.get('/api/projects')).json().items.some((x: { id: string }) => x.id === p.id)).toBe(true);
  });

  it('duplicates, exports and imports projects', async () => {
    const p = (await user.post('/api/projects', { name: 'Recipes', instructions: 'Be a chef.' })).json();
    await user.post(`/api/projects/${p.id}/notes`, { title: 'Pesto', text: 'Basil, pine nuts, parmesan, garlic, olive oil.' });
    await t.c.jobs.drain();
    const copy = (await user.post(`/api/projects/${p.id}/duplicate`)).json();
    const hits = await t.c.retrieval.search({ projectId: copy.id }, 'basil pesto', 3, null);
    expect(hits[0]!.content).toContain('Basil');
    const exported = (await user.get(`/api/projects/${p.id}/export`)).json();
    expect(exported).toMatchObject({ format: 'lumen.project', project: { name: 'Recipes', instructions: 'Be a chef.' }, notes: [{ name: 'Pesto.md' }] });
    const imported = (await user.post('/api/projects/import', exported)).json();
    await t.c.jobs.drain();
    expect((await user.get(`/api/projects/${imported.id}`)).json().knowledge[0].status).toBe('ready');
    expect((await user.post('/api/projects/import', { format: 'nope' })).statusCode).toBe(400);
    expect((await user.del(`/api/projects/${imported.id}`)).statusCode).toBe(204);
  });
});

describe('account export', () => {
  it('includes conversations, projects and file attachments', async () => {
    const res = await user.get('/api/me/export');
    const names = Object.keys(unzipSync(new Uint8Array(res.rawPayload)));
    expect(names.some((n) => n.startsWith('conversations/'))).toBe(true);
    expect(names).toContain('projects/projects.json');
    expect(names.some((n) => n.startsWith('files/attachments/'))).toBe(true);
    expect(names.some((n) => n.includes('eicar'))).toBe(false);
  });
});
