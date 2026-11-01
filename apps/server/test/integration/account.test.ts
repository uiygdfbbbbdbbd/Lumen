import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
import { createTestApp, signup, STRONG_PASSWORD, type TestApp, type TestClient } from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await signup(t.client()); // consume super_admin slot
});
afterAll(() => t.close());

function multipart(file: Buffer, filename: string, contentType: string, fields: Record<string, string> = {}) {
  const boundary = '----lumenTestBoundary';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(file, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(c: TestClient, file: Buffer, name: string, type: string, fields?: Record<string, string>) {
  const m = multipart(file, name, type, fields);
  return c.request('POST', '/api/me/avatar', m.payload, m.headers);
}

describe('profile + onboarding', () => {
  it('updates profile fields with validation', async () => {
    const c = t.client();
    await signup(c);
    const r = await c.patch('/api/me/profile', { displayName: 'Ada', bio: 'Math', timezone: 'Europe/London', locale: 'en-GB', pronouns: 'she/her' });
    expect(r.json().user).toMatchObject({ displayName: 'Ada', bio: 'Math', timezone: 'Europe/London', locale: 'en-GB', pronouns: 'she/her' });
    expect((await c.patch('/api/me/profile', { timezone: 'Nowhere/Land' })).json().error.code).toBe('VALIDATION_FAILED');
    expect((await c.patch('/api/me/profile', { displayName: '<b>x</b>' })).statusCode).toBe(400);
  });

  it('saves onboarding progress and resumes it', async () => {
    const c = t.client();
    await signup(c);
    await c.patch('/api/me/onboarding', { step: 3, useCases: ['coding', 'research'], themeMode: 'dark' });
    const back = await c.patch('/api/me/onboarding', { step: 2 });
    expect(back.json().user.onboarding).toMatchObject({ step: 3, useCases: ['coding', 'research'], themeMode: 'dark', completed: false });
    const done = await c.patch('/api/me/onboarding', { step: 7, completed: true, tourCompleted: true });
    expect(done.json().user.onboarding.completed).toBe(true);
    expect((await c.patch('/api/me/onboarding', { useCases: ['hacking'] })).statusCode).toBe(400);
  });
});

describe('avatar', () => {
  it('crops, resizes to 512 webp, strips metadata and serves it', async () => {
    const c = t.client();
    await signup(c);
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ff0000' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
      .jpeg()
      .toBuffer();
    const r = await upload(c, png, 'me.jpg', 'image/jpeg', { crop: JSON.stringify({ x: 100, y: 0, width: 600, height: 600 }) });
    expect(r.statusCode).toBe(200);
    const url = new URL(r.json().user.avatarUrl);
    const img = await t.client().get(url.pathname);
    expect(img.headers['content-type']).toBe('image/webp');
    const meta = await sharp(img.rawPayload).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(meta.exif).toBeUndefined();
    expect(img.rawPayload.includes(Buffer.from('secret-gps-owner'))).toBe(false);

    const del = await c.del('/api/me/avatar');
    expect(del.json().user.avatarUrl).toBeNull();
    expect((await t.client().get(url.pathname)).statusCode).toBe(404);
  });

  it('rejects non-images, SVG and polyglots', async () => {
    const c = t.client();
    await signup(c);
    expect((await upload(c, Buffer.from('<svg onload="alert(1)"/>'), 'x.svg', 'image/svg+xml')).json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect((await upload(c, Buffer.from('GIF89a<script>alert(1)</script>'), 'x.gif', 'image/gif')).json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect((await upload(c, Buffer.from('%PDF-1.4 hello'), 'x.png', 'image/png')).json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('avatar paths cannot be traversed', async () => {
    expect((await t.client().get('/api/avatars/..%2f..%2fetc/passwd')).statusCode).toBe(400);
  });
});

describe('deletion + export', () => {
  it('schedules deletion with grace period, cancels, then purges when due', async () => {
    const c = t.client();
    const { body } = await signup(c);
    expect((await c.post('/api/me/delete', { password: 'wrong', confirm: 'DELETE' })).statusCode).toBe(401);
    const r = await c.post('/api/me/delete', { password: STRONG_PASSWORD, confirm: 'DELETE' });
    expect(r.json().user.status).toBe('pending_deletion');
    expect(r.json().entitlements.features.chat.allowed).toBe(false);
    expect((await c.post('/api/me/delete/cancel')).json().user.status).toBe('active');

    await c.post('/api/me/delete', { password: STRONG_PASSWORD, confirm: 'DELETE' });
    expect(await t.c.users.purgeDueDeletions()).toBe(0);
    t.clock.advance(15 * 86400_000);
    expect(await t.c.users.purgeDueDeletions()).toBe(1);
    const rows = await t.c.db.execute(sql`SELECT id FROM users WHERE id = ${body.user.id}`);
    expect(rows).toHaveLength(0);
  });

  it('the super admin cannot delete their account', async () => {
    const t2 = await createTestApp();
    const c = t2.client();
    await signup(c);
    expect((await c.post('/api/me/delete', { password: STRONG_PASSWORD, confirm: 'DELETE' })).statusCode).toBe(403);
    await t2.close();
  });

  it('exports a zip with profile, history and no secrets', async () => {
    const c = t.client();
    const { email } = await signup(c);
    const res = await c.get('/api/me/export');
    expect(res.headers['content-type']).toBe('application/zip');
    const files = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['profile.json', 'sessions.json', 'login-history.json', 'README.txt']));
    expect(JSON.parse(strFromU8(files['profile.json']!)).email).toBe(email);
    const all = Object.values(files).map((f) => strFromU8(f)).join('\n');
    expect(all).not.toMatch(/token_?hash|password_?hash|argon2/i);
  });
});

describe('platform behavior', () => {
  it('maintenance mode blocks normal routes but allows sign-in and /me', async () => {
    const c = t.client();
    await signup(c);
    await t.c.settings.set('maintenance', { enabled: true, readOnly: false, message: 'Back soon' }, null);
    const blocked = await c.patch('/api/me/profile', { bio: 'x' });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error).toMatchObject({ code: 'MAINTENANCE', message: 'Back soon' });
    expect((await c.get('/api/me')).statusCode).toBe(200);
    await t.c.settings.set('maintenance', { enabled: true, readOnly: true, message: '' }, null);
    expect((await c.get('/api/me/sessions')).statusCode).toBe(200);
    expect((await c.patch('/api/me/profile', { bio: 'x' })).statusCode).toBe(503);
    await t.c.settings.set('maintenance', { enabled: false, readOnly: false, message: '' }, null);
  });

  it('audit log is append-only at the database level', async () => {
    await t.c.audit.log({ actorId: null, action: 'test.event', metadata: { password: 'x', ok: 1 } });
    const [row] = await t.c.audit.list({ action: 'test.', limit: 1 });
    expect(row!.metadata).toEqual({ password: '[REDACTED]', ok: 1 });
    const rootMessage = (q: Promise<unknown>) =>
      q.then(
        () => 'no error',
        (e: Error & { cause?: Error }) => e.cause?.message ?? e.message,
      );
    expect(await rootMessage(t.c.db.execute(sql`UPDATE audit_logs SET action = 'tampered'`))).toMatch(/append-only/);
    expect(await rootMessage(t.c.db.execute(sql`DELETE FROM audit_logs`))).toMatch(/append-only/);
    expect(await rootMessage(t.c.db.execute(sql`TRUNCATE audit_logs`))).toMatch(/append-only/);
  });

  it('settings reject invalid values and fall back to defaults for corrupt rows', async () => {
    await expect(t.c.settings.set('signup', { mode: 'weird' }, null)).rejects.toThrow(/Invalid value/);
    await t.c.db.execute(sql`UPDATE platform_settings SET value = '{"productName": 5}'::jsonb WHERE key = 'branding'`);
    t.c.settings.invalidate();
    expect((await t.c.settings.get('branding')).productName).toBe('Lumen');
  });

  it('public config never exposes secrets', async () => {
    const res = await t.client().get('/api/public/config');
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toMatch(/secret|password|apiKey/i);
  });

  it('health endpoints report status', async () => {
    expect((await t.client().get('/api/health')).json()).toEqual({ status: 'ok' });
    expect((await t.client().get('/api/health/ready')).json().checks.database).toBe('ok');
  });

  it('usage endpoint reports limits and reset time', async () => {
    const c = t.client();
    await signup(c);
    const u = (await c.get('/api/me/usage')).json();
    expect(u.tierId).toBe('unverified');
    expect(u.usage.find((x: { metric: string }) => x.metric === 'messages')).toMatchObject({ used: 0, limit: 50 });
  });

  it('quota consumption is atomic under concurrency', async () => {
    const c = t.client();
    const { body } = await signup(c);
    const results = await Promise.all(Array.from({ length: 25 }, () => t.c.entitlements.consume(body.user.id, 'messages', 1, 10)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(await t.c.entitlements.usage(body.user.id, 'messages')).toBe(10);
  });
});
