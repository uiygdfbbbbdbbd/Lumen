import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { startMockProvider, type MockProvider } from '@lumen/llm/mock';
import { createTestApp, extractToken, signup, type TestApp, type TestClient } from '../helpers/app.js';
import { loadConfig } from '../../src/config/index.js';
import { SecretBox } from '../../src/lib/crypto.js';
import { ProviderService } from '../../src/services/providers/provider.service.js';
import { TEST_ENV } from '../helpers/env.js';

const SECRET = 'sk-mock-secret-key-1234567890abcdef';
let t: TestApp;
let mock: MockProvider;
let admin: TestClient;
let user: TestClient;

function multipart(file: Buffer, filename: string, type: string) {
  const b = '----lumenB';
  return {
    payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}` },
  };
}

beforeAll(async () => {
  mock = await startMockProvider({ apiKey: SECRET });
  t = await createTestApp({ env: { ALLOW_PRIVATE_PROVIDER_URLS: 'true' } });
  admin = t.client();
  await signup(admin);
  user = t.client();
  await signup(user);
});
afterAll(async () => {
  await t.close();
  await mock.close();
});

async function createProvider(overrides: Record<string, unknown> = {}) {
  const res = await admin.post('/api/admin/providers', {
    name: 'Mock OpenAI',
    type: 'openai',
    description: 'Deterministic test provider',
    baseUrl: `${mock.url}/v1`,
    apiKey: SECRET,
    allowPrivateNetwork: true,
    headers: { 'X-Team': 'secret-team-header' },
    ...overrides,
  });
  return res;
}

describe('provider CRUD and secret handling', () => {
  it('creates a provider, encrypts the key and never returns it', async () => {
    const res = await createProvider();
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p.keys).toHaveLength(1);
    expect(p.keys[0].keyPreview).toBe('sk-••••cdef');
    expect(p.headerNames).toEqual(['X-Team']);
    const [row] = (await t.c.db.execute(sql`SELECT key_enc FROM provider_keys WHERE provider_id = ${p.id}`)) as unknown as { key_enc: string }[];
    expect(row!.key_enc.startsWith('v1.')).toBe(true);
    expect(row!.key_enc).not.toContain(SECRET);
    const audit = await t.c.audit.list({ action: 'provider.created', limit: 5 });
    expect(JSON.stringify(audit)).not.toContain(SECRET);
  });

  it('blocks private URLs unless the provider and server both allow them, and always blocks metadata', async () => {
    expect((await createProvider({ allowPrivateNetwork: false })).json().error.code).toBe('SSRF_BLOCKED');
    expect((await createProvider({ baseUrl: 'http://169.254.169.254/latest' })).json().error.code).toBe('SSRF_BLOCKED');
    expect((await createProvider({ baseUrl: 'file:///etc/passwd' })).statusCode).toBe(400);
    const strict = await createTestApp();
    const a = strict.client();
    await signup(a);
    const r = await a.post('/api/admin/providers', { name: 'x', type: 'ollama', baseUrl: mock.url, allowPrivateNetwork: true });
    expect(r.json().error.code).toBe('SSRF_BLOCKED');
    await strict.close();
  });

  it('rejects dangerous custom headers', async () => {
    expect((await createProvider({ headers: { Host: 'evil' } })).json().error.code).toBe('VALIDATION_FAILED');
  });

  it('tests the connection: lists models, runs a tiny completion, records health', async () => {
    const p = (await createProvider()).json();
    const r = (await admin.post(`/api/admin/providers/${p.id}/test`)).json();
    expect(r.ok).toBe(true);
    expect(r.modelCount).toBe(4);
    expect(r.completion).toMatch(/You said/);
    const view = (await admin.get(`/api/admin/providers/${p.id}`)).json();
    expect(view.health.status).toBe('healthy');
    // The mock saw our custom header and bearer token.
    const last = mock.requests.at(-1)!;
    expect(last.headers['x-team']).toBe('secret-team-header');
    expect(last.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it('a wrong key fails the test with an auth error and marks the provider down', async () => {
    const p = (await createProvider({ apiKey: 'sk-wrong-key-000000000000' })).json();
    const r = (await admin.post(`/api/admin/providers/${p.id}/test`)).json();
    expect(r.ok).toBe(false);
    expect(r.error.kind).toBe('auth');
    expect((await admin.get(`/api/admin/providers/${p.id}`)).json().health.status).toBe('down');
  });

  it('replaces and removes keys via PATCH', async () => {
    const p = (await createProvider({ apiKey: 'sk-wrong-key-000000000000' })).json();
    const updated = (await admin.patch(`/api/admin/providers/${p.id}`, { apiKey: SECRET })).json();
    expect(updated.keys[0].keyPreview).toBe('sk-••••cdef');
    expect((await admin.post(`/api/admin/providers/${p.id}/test`)).json().ok).toBe(true);
    const removed = (await admin.patch(`/api/admin/providers/${p.id}`, { apiKey: null, headers: null })).json();
    expect(removed.keys).toEqual([]);
    expect(removed.headerNames).toEqual([]);
  });

  it('uploads icons (incl. scriptable SVG) and serves normalized WebP', async () => {
    const p = (await createProvider()).json();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" onload="alert(1)"><script>alert(2)</script><circle cx="32" cy="32" r="30" fill="red"/></svg>');
    const m = multipart(svg, 'i.svg', 'image/svg+xml');
    const res = await admin.request('POST', `/api/admin/providers/${p.id}/icon`, m.payload, m.headers);
    expect(res.statusCode).toBe(200);
    const icon = await t.client().get(new URL(res.json().iconUrl).pathname);
    expect(icon.headers['content-type']).toBe('image/webp');
    expect(icon.rawPayload.includes(Buffer.from('script'))).toBe(false);
    expect((await sharp(icon.rawPayload).metadata()).width).toBe(128);
    const bad = multipart(Buffer.from('not an image'), 'x.png', 'image/png');
    expect((await admin.request('POST', `/api/admin/providers/${p.id}/icon`, bad.payload, bad.headers)).json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('regular users cannot reach admin provider routes', async () => {
    expect((await user.get('/api/admin/providers')).statusCode).toBe(403);
  });

  it('no admin response ever contains the plaintext key or ciphertext', () => {
    for (const r of admin.responses) {
      expect(r.body).not.toContain(SECRET);
      expect(r.body).not.toMatch(/"keyEnc"|"headersEnc"|v1\.[0-9a-f]{12}\./);
      expect(r.body).not.toContain('secret-team-header');
    }
  });
});

describe('models, visibility, aliases', () => {
  let providerId = '';
  beforeAll(async () => {
    providerId = (await createProvider({ name: 'Catalog Provider' })).json().id;
  });

  it('imports models (disabled by default) idempotently', async () => {
    expect((await admin.post(`/api/admin/providers/${providerId}/import-models`, { enable: false })).json()).toEqual({ added: 4, existing: 0 });
    expect((await admin.post(`/api/admin/providers/${providerId}/import-models`, { enable: false })).json()).toEqual({ added: 0, existing: 4 });
    const list = (await admin.get(`/api/admin/models?providerId=${providerId}`)).json().items as { providerModelId: string; enabled: boolean; capabilities: { vision: boolean; reasoning: boolean } }[];
    expect(list.every((m) => !m.enabled)).toBe(true);
    expect(list.find((m) => m.providerModelId === 'mock-vision')!.capabilities.vision).toBe(true);
    expect(list.find((m) => m.providerModelId === 'mock-reasoning')!.capabilities.reasoning).toBe(true);
  });

  it('enforces visibility in the picker and on resolve', async () => {
    const list = (await admin.get(`/api/admin/models?providerId=${providerId}`)).json().items as { id: string; providerModelId: string }[];
    const id = (name: string) => list.find((m) => m.providerModelId === name)!.id;
    await admin.post('/api/admin/models/bulk', { ids: list.map((m) => m.id), enabled: true });
    await admin.patch(`/api/admin/models/${id('mock-smart')}`, { visibility: 'verified', recommended: true, description: 'Smartest mock', tags: ['smart'] });
    await admin.patch(`/api/admin/models/${id('mock-reasoning')}`, { visibility: 'admins' });
    await admin.patch(`/api/admin/models/${id('mock-vision')}`, { visibility: 'beta' });

    const seen = (await user.get('/api/models')).json().items as { id: string; displayName: string; available: boolean; lockedReason: string | null; providerName: string }[];
    const mine = seen.filter((m) => m.providerName === 'Catalog Provider');
    expect(mine.map((m) => m.displayName).sort()).toEqual(['mock-fast', 'mock-smart', 'mock-vision']);
    expect(mine.find((m) => m.displayName === 'mock-smart')).toMatchObject({ available: false, lockedReason: 'EMAIL_UNVERIFIED' });
    expect(mine.find((m) => m.displayName === 'mock-vision')).toMatchObject({ available: false, lockedReason: 'BETA_ONLY' });

    const viewer = (await t.c.users.get((await user.get('/api/me')).json().user.id));
    await expect(t.c.catalog.resolve(id('mock-smart'), viewer)).rejects.toThrow(/Verify your email/);
    await expect(t.c.catalog.resolve(id('mock-reasoning'), viewer)).rejects.toThrow(/access/);

    // Verify the user: the verified-only model unlocks.
    await user.post('/api/auth/resend-verification').catch(() => undefined);
    const email = (await user.get('/api/me')).json().user.email;
    await user.post('/api/auth/verify-email', { token: extractToken(t.mail.lastTo(email)!.text, '/verify-email') });
    const after = ((await user.get('/api/models')).json().items as { displayName: string; available: boolean }[]).find((m) => m.displayName === 'mock-smart');
    expect(after!.available).toBe(true);
  });

  it('aliases resolve and can be repointed; deprecated models redirect to their replacement', async () => {
    const list = (await admin.get(`/api/admin/models?providerId=${providerId}`)).json().items as { id: string; providerModelId: string }[];
    const fast = list.find((m) => m.providerModelId === 'mock-fast')!.id;
    const smart = list.find((m) => m.providerModelId === 'mock-smart')!.id;
    expect((await admin.put('/api/admin/model-aliases', { alias: 'quick', modelId: fast })).statusCode).toBe(200);
    const adminRow = await t.c.users.get((await admin.get('/api/me')).json().user.id);
    expect((await t.c.catalog.resolve('quick', adminRow)).model.id).toBe(fast);
    await admin.put('/api/admin/model-aliases', { alias: 'quick', modelId: smart });
    expect((await t.c.catalog.resolve('QUICK', adminRow)).model.id).toBe(smart);
    expect((await admin.put('/api/admin/model-aliases', { alias: 'Bad Alias!', modelId: smart })).statusCode).toBe(400);
    await admin.patch(`/api/admin/models/${fast}`, { deprecationDate: '2020-01-01', deprecationMessage: 'Use smart', replacementModelId: smart });
    expect((await t.c.catalog.resolve(fast, adminRow)).model.id).toBe(smart);
    expect((await admin.patch(`/api/admin/models/${fast}`, { fallbackModelIds: [fast] })).statusCode).toBe(400);
    expect((await admin.del('/api/admin/model-aliases/quick')).statusCode).toBe(204);
  });

  it('manual model add and delete', async () => {
    const r = await admin.post(`/api/admin/providers/${providerId}/models`, { providerModelId: 'custom-x', displayName: 'Custom X', contextWindow: 1000 });
    expect(r.statusCode).toBe(201);
    expect((await admin.post(`/api/admin/providers/${providerId}/models`, { providerModelId: 'custom-x', displayName: 'Dup' })).json().error.code).toBe('CONFLICT');
    expect((await admin.del(`/api/admin/models/${r.json().id}`)).statusCode).toBe(204);
  });

  it('user preferences store default model and favorites', async () => {
    const r = await user.patch('/api/me/preferences', { defaultModel: 'quick', favoriteModels: ['a'] });
    expect(r.json()).toEqual({ defaultModel: 'quick', favoriteModels: ['a'] });
    expect((await user.patch('/api/me/preferences', { thinkingEffort: 'extreme' })).statusCode).toBe(400);
    expect((await user.get('/api/me/preferences')).json().favoriteModels).toEqual(['a']);
    // Concurrent patches to different keys must both survive.
    await Promise.all([user.patch('/api/me/preferences', { defaultModel: 'x' }), user.patch('/api/me/preferences', { recentModels: ['y'] }), user.patch('/api/me/preferences', { autoTitle: false })]);
    expect((await user.get('/api/me/preferences')).json()).toMatchObject({ defaultModel: 'x', recentModels: ['y'], autoTitle: false, favoriteModels: ['a'] });
  });
});

describe('key routing, failover and spend caps', () => {
  it('weights keys, cools down rate-limited keys, and respects spend caps', async () => {
    const p = (await createProvider({ name: 'Multi-key' })).json();
    await admin.post(`/api/admin/providers/${p.id}/keys`, { label: 'Backup', apiKey: 'sk-second-key-abcdefghijk', weight: 3 });
    const counts: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const sel = await t.c.providers.selectKey(p.id);
      counts[sel!.key.label] = (counts[sel!.key.label] ?? 0) + 1;
    }
    expect(counts.Backup! / 400).toBeGreaterThan(0.6);
    expect(counts.Primary).toBeGreaterThan(40);

    const view = (await admin.get(`/api/admin/providers/${p.id}`)).json();
    const backup = view.keys.find((k: { label: string }) => k.label === 'Backup');
    const { LlmError } = await import('@lumen/llm');
    await t.c.providers.reportFailure(p.id, backup.id, new LlmError('rate_limit', 'slow down', 429, 60_000));
    for (let i = 0; i < 20; i++) expect((await t.c.providers.selectKey(p.id))!.key.label).toBe('Primary');

    const primary = view.keys.find((k: { label: string }) => k.label === 'Primary');
    await admin.patch(`/api/admin/providers/${p.id}/keys/${primary.id}`, { monthlySpendCapUsd: 1 });
    await t.c.providers.reportSuccess(p.id, primary.id, 1.5);
    expect(await t.c.providers.selectKey(p.id)).toBeNull();
    await expect(t.c.providers.runtime(p.id)).rejects.toThrow(/no usable API key/);
    t.clock.advance(61_000);
    expect((await t.c.providers.selectKey(p.id))!.key.label).toBe('Backup');
    expect((await admin.del(`/api/admin/providers/${p.id}/keys/${backup.id}`)).json().keys).toHaveLength(1);
  });

  it('the circuit breaker opens after repeated failures', async () => {
    const p = (await createProvider({ name: 'Flaky' })).json();
    const { LlmError } = await import('@lumen/llm');
    // Rate limits never open the circuit; outages do.
    for (let i = 0; i < 10; i++) await t.c.providers.reportFailure(p.id, null, new LlmError('rate_limit', 'slow', 429));
    expect((await t.c.providers.runtime(p.id)).provider.id).toBe(p.id);
    for (let i = 0; i < 5; i++) await t.c.providers.reportFailure(p.id, null, new LlmError('server', 'boom', 500));
    await expect(t.c.providers.runtime(p.id)).rejects.toThrow(/temporarily unavailable/);
    t.clock.advance(31_000);
    expect((await t.c.providers.runtime(p.id)).provider.id).toBe(p.id);
  });

  it('health checks mark providers and email admins when one goes down', async () => {
    const p = (await createProvider({ name: 'Doomed', apiKey: 'sk-revoked-0000000000000' })).json();
    t.mail.clear();
    const results = await t.c.providers.healthCheckAll();
    expect(results.find((r) => r.id === p.id)!.status).toBe('down');
    expect(t.mail.outbox.some((m) => m.subject.includes('Doomed'))).toBe(true);
    await admin.del(`/api/admin/providers/${p.id}`);
  });
});

describe('encryption key rotation', () => {
  it('re-wraps every secret under a new key and the old key can then be retired', async () => {
    const p = (await createProvider({ name: 'Rotate me' })).json();
    const newKey = Buffer.alloc(32, 9).toString('base64');
    const rotatedConfig = loadConfig({ ...TEST_ENV, DATABASE_URL: t.c.config.DATABASE_URL, ENCRYPTION_KEYS: `${newKey},${TEST_ENV.ENCRYPTION_KEYS}` });
    const svc = new ProviderService(t.c.db, new SecretBox(rotatedConfig.encryptionKeys), t.c.storage, t.c.audit, t.c.email, rotatedConfig, t.c.log);
    const actor = (await admin.get('/api/me')).json().user.id;
    const { rotated } = await svc.rotateSecrets(actor, '127.0.0.1');
    expect(rotated).toBeGreaterThan(0);
    const onlyNew = new SecretBox([Buffer.from(newKey, 'base64')]);
    const svcNew = new ProviderService(t.c.db, onlyNew, t.c.storage, t.c.audit, t.c.email, rotatedConfig, t.c.log);
    expect((await svcNew.selectKey(p.id))!.secret).toBe(SECRET);
    expect((await svc.rotateSecrets(actor, '127.0.0.1')).rotated).toBe(0);
  });
});
