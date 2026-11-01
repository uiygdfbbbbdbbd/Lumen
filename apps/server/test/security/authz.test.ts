import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTE_TABLE } from '../../src/http/route.js';
import type { RouteMeta } from '../../src/http/types.js';
import { createTestApp, signup, STRONG_PASSWORD, type TestApp, type TestClient } from '../helpers/app.js';

let t: TestApp;
let routes: RouteMeta[];
let user: TestClient;
let other: TestClient;

const SAMPLE_UUID = '00000000-0000-4000-8000-000000000000';
const fill = (url: string) => url.replace(/:(\w+)/g, (_m, name: string) => (/id$/i.test(name) ? SAMPLE_UUID : 'sample'));

beforeAll(async () => {
  t = await createTestApp();
  const seen = new Set<string>();
  routes = ROUTE_TABLE.filter((r) => {
    const k = `${r.method} ${r.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  await signup(t.client()); // super admin
  user = t.client();
  await signup(user);
  other = t.client();
  await signup(other);
});
afterAll(() => t.close());

describe('route table', () => {
  it('has routes and every mutation is CSRF-protected', () => {
    expect(routes.length).toBeGreaterThan(20);
    for (const r of routes) if (r.method !== 'GET') expect(r.csrf, `${r.method} ${r.url}`).toBe(true);
  });
});

describe('authentication is required on every protected route', () => {
  it('anonymous requests are rejected with UNAUTHENTICATED', async () => {
    const anon = t.client();
    const failures: string[] = [];
    for (const r of routes) {
      if (r.auth === 'public' || r.auth === 'optional') continue;
      const res = await anon.request(r.method as 'GET', fill(r.url), r.method === 'GET' ? undefined : {});
      if (res.statusCode !== 401 || res.json().error.code !== 'UNAUTHENTICATED') failures.push(`${r.method} ${r.url} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('permission-gated routes reject regular users with FORBIDDEN', async () => {
    const failures: string[] = [];
    for (const r of routes) {
      if (typeof r.auth !== 'object') continue;
      const res = await user.request(r.method as 'GET', fill(r.url), r.method === 'GET' ? undefined : {});
      if (res.statusCode !== 403) failures.push(`${r.method} ${r.url} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('CSRF', () => {
  it('cookie-authenticated mutations without the CSRF header fail', async () => {
    const failures: string[] = [];
    user.sendCsrf = false;
    for (const r of routes) {
      if (!r.csrf) continue;
      const res = await user.request(r.method as 'POST', fill(r.url), {});
      if (res.statusCode !== 403 || res.json().error.code !== 'CSRF_FAILED') failures.push(`${r.method} ${r.url} -> ${res.statusCode}`);
    }
    user.sendCsrf = true;
    expect(failures).toEqual([]);
  });

  it('a mismatched CSRF header fails', async () => {
    const res = await user.request('PATCH', '/api/me/profile', { bio: 'x' }, { 'x-csrf-token': 'A'.repeat(43) });
    expect(res.json().error.code).toBe('CSRF_FAILED');
  });
});

describe('session tampering', () => {
  it('altered, truncated and foreign-format tokens are rejected', async () => {
    const token = user.sessionToken!;
    for (const bad of [token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), token.slice(0, 10), `${token}' OR '1'='1`, 'eyJhbGciOiJub25lIn0.e30.']) {
      const c = t.client();
      c.cookies.set('lumen_session', bad);
      expect((await c.get('/api/me')).statusCode).toBe(401);
    }
  });
});

describe('IDOR', () => {
  it("users cannot revoke another user's session", async () => {
    const theirs = (await other.get('/api/me/sessions')).json().items[0].id as string;
    expect((await user.del(`/api/me/sessions/${theirs}`)).statusCode).toBe(404);
    expect((await other.get('/api/me')).statusCode).toBe(200);
  });
});

describe('secrets never leave the server', () => {
  it('no response body contains password hashes, token hashes or raw session tokens', async () => {
    await user.get('/api/me');
    await user.get('/api/me/sessions');
    await user.get('/api/me/login-history');
    await user.post('/api/auth/login', { email: 'nobody@example.com', password: STRONG_PASSWORD });
    const all = [user, other].flatMap((c) => c.responses);
    for (const res of all) {
      const body = res.body;
      expect(body).not.toMatch(/\$argon2id\$/);
      expect(body).not.toMatch(/token_?hash|passwordHash|totpSecretEnc/i);
      if (user.sessionToken) expect(body).not.toContain(user.sessionToken);
    }
  });

  it('SQL injection in login fields is treated as data', async () => {
    const res = await t.client().post('/api/auth/login', { email: 'victim@example.com', password: "' OR 1=1 --" });
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    const res2 = await t.client().post('/api/auth/login', { email: "a@b.co' OR '1'='1", password: 'x' });
    expect(res2.json().error.code).toBe('VALIDATION_FAILED');
  });
});
