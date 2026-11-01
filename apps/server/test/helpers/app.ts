import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '@lumen/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { createContainer, type Container, type ContainerOverrides } from '../../src/container.js';
import { createDb } from '../../src/db/client.js';
import { PasswordHasher } from '../../src/lib/password.js';
import { MemoryRateLimiter } from '../../src/lib/rate-limit.js';
import { MemoryTransport } from '../../src/services/email/transports.js';
import { FsStorage } from '../../src/services/storage/storage.js';
import { ADMIN_URL, TEMPLATE_DB, TEST_ENV, urlFor } from './env.js';

export const FAST_HASHER = new PasswordHasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });

export interface TestApp {
  app: FastifyInstance;
  c: Container;
  mail: MemoryTransport;
  clock: { now: Date; advance(ms: number): void };
  client(): TestClient;
  close(): Promise<void>;
}

export async function createTestApp(
  opts: { env?: Record<string, string>; overrides?: ContainerOverrides; extraRoutes?: (app: FastifyInstance, c: Container) => void } = {},
): Promise<TestApp> {
  const dbName = `lumen_it_${randomBytes(6).toString('hex')}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_DB}`);
  await admin.end();

  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'lumen-test-'));
  const config = loadConfig({ ...TEST_ENV, DATABASE_URL: urlFor(dbName), STORAGE_FS_ROOT: storageRoot, ...opts.env });
  const mail = new MemoryTransport();
  const clock = {
    now: new Date(),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
  };
  const c = createContainer(config, {
    db: createDb(config.DATABASE_URL, { max: 5 }),
    redis: null,
    emailTransport: mail,
    storage: new FsStorage(storageRoot),
    rateLimiter: new MemoryRateLimiter(() => clock.now.getTime()),
    hasher: FAST_HASHER,
    breachChecker: null,
    now: () => clock.now,
    ...opts.overrides,
  });
  const app = await buildApp(c, opts.extraRoutes);
  await app.ready();
  return {
    app,
    c,
    mail,
    clock,
    client: () => new TestClient(app),
    async close() {
      await app.close();
      await c.close();
      await rm(storageRoot, { recursive: true, force: true });
      const a = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
      await a.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Minimal browser-like client: keeps cookies, sends the CSRF header, records every response. */
export class TestClient {
  readonly cookies = new Map<string, string>();
  readonly responses: LightMyRequestResponse[] = [];
  /** Each client gets its own address so per-IP limits don't bleed across tests. */
  ip = `203.0.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
  userAgent = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0';
  sendCsrf = true;

  constructor(private readonly app: FastifyInstance) {}

  get sessionToken() {
    return this.cookies.get(SESSION_COOKIE);
  }

  async request(method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) {
    if (!this.cookies.has(CSRF_COOKIE)) await this.raw('GET', '/api/auth/csrf');
    return this.raw(method, url, payload, headers);
  }

  async raw(method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) {
    const cookieHeader = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.app.inject({
      method,
      url,
      payload: payload as InjectOptions['payload'],
      remoteAddress: this.ip,
      headers: {
        'user-agent': this.userAgent,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(this.sendCsrf && this.cookies.get(CSRF_COOKIE) ? { [CSRF_HEADER]: this.cookies.get(CSRF_COOKIE)! } : {}),
        ...headers,
      },
    });
    for (const ck of res.cookies) {
      if (ck.value === '' || (ck.expires && ck.expires.getTime() < Date.now()) || ck.maxAge === 0) this.cookies.delete(ck.name);
      else this.cookies.set(ck.name, ck.value);
    }
    this.responses.push(res);
    return res;
  }

  get = (url: string, headers?: Record<string, string>) => this.request('GET', url, undefined, headers);
  post = (url: string, body?: unknown, headers?: Record<string, string>) => this.request('POST', url, body ?? {}, headers);
  patch = (url: string, body?: unknown) => this.request('PATCH', url, body ?? {});
  put = (url: string, body?: unknown) => this.request('PUT', url, body ?? {});
  del = (url: string) => this.request('DELETE', url);
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}${counter}.${randomBytes(3).toString('hex')}@example.com`;
}

export const STRONG_PASSWORD = 'correct horse battery staple 42!';

export async function signup(client: TestClient, overrides: Record<string, unknown> = {}) {
  const email = (overrides.email as string) ?? uniqueEmail();
  const res = await client.post('/api/auth/signup', {
    email,
    password: STRONG_PASSWORD,
    displayName: 'Test User',
    acceptTerms: true,
    birthYear: 1990,
    ...overrides,
  });
  return { res, email, body: res.json() as { user: { id: string; role: string; emailVerified: boolean } } };
}

export function extractToken(text: string, pathName: string): string {
  const m = new RegExp(`${pathName}\\?token=([A-Za-z0-9_%-]+)`).exec(text);
  if (!m) throw new Error(`no ${pathName} link in email`);
  return decodeURIComponent(m[1]!);
}
