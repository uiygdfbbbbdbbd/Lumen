import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import { sql } from 'drizzle-orm';
import { createTestApp, extractToken, signup, STRONG_PASSWORD, uniqueEmail, type TestApp } from '../helpers/app.js';
import { route } from '../../src/http/route.js';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({
    extraRoutes: (app, c) => {
      route(app, c, { method: 'POST', url: '/api/test/code-mode', auth: 'user', feature: 'codeMode', handler: async () => ({ ok: true }) });
      route(app, c, { method: 'POST', url: '/api/test/api-keys', auth: 'user', feature: 'apiKeys', handler: async () => ({ ok: true }) });
      route(app, c, { method: 'GET', url: '/api/test/verified-only', auth: 'verified', handler: async () => ({ ok: true }) });
    },
  });
});
afterAll(() => t.close());

describe('signup', () => {
  it('first user becomes super_admin, later users are regular', async () => {
    const a = await signup(t.client());
    expect(a.res.statusCode).toBe(201);
    expect(a.body.user.role).toBe('super_admin');
    const b = await signup(t.client());
    expect(b.body.user.role).toBe('user');
    expect(b.body.user.emailVerified).toBe(false);
  });

  it('sets an httpOnly session cookie and audit-logs the signup', async () => {
    const client = t.client();
    const { res, body } = await signup(client);
    const cookie = res.cookies.find((c) => c.name === 'lumen_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite?.toLowerCase()).toBe('lax');
    const rows = await t.c.audit.list({ actorId: body.user.id, limit: 10 });
    expect(rows.map((r) => r.action)).toContain('auth.signup');
  });

  it('rejects duplicate emails case-insensitively', async () => {
    const email = uniqueEmail();
    await signup(t.client(), { email });
    const dup = await signup(t.client(), { email: email.toUpperCase() });
    expect(dup.res.statusCode).toBe(409);
    expect(dup.res.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects weak passwords, disposable emails, missing terms and underage users', async () => {
    const weak = await signup(t.client(), { password: 'password1234' });
    expect(weak.res.json().error.code).toBe('WEAK_PASSWORD');
    const disposable = await signup(t.client(), { email: 'x@mailinator.com' });
    expect(disposable.res.json().error.code).toBe('DISPOSABLE_EMAIL');
    const terms = await signup(t.client(), { acceptTerms: false });
    expect(terms.res.json().error.code).toBe('VALIDATION_FAILED');
    const young = await signup(t.client(), { birthYear: new Date().getUTCFullYear() - 10 });
    expect(young.res.statusCode).toBe(403);
    const noYear = await signup(t.client(), { birthYear: undefined });
    expect(noYear.res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('honors closed, allowlist and invite-only modes', async () => {
    await t.c.settings.patch('signup', { mode: 'closed' }, null);
    expect((await signup(t.client())).res.json().error.code).toBe('SIGNUP_CLOSED');

    await t.c.settings.patch('signup', { mode: 'allowlist', allowlistDomains: ['corp.test'] }, null);
    expect((await signup(t.client())).res.json().error.code).toBe('SIGNUP_CLOSED');
    expect((await signup(t.client(), { email: uniqueEmail('a').replace('example.com', 'corp.test') })).res.statusCode).toBe(201);

    await t.c.settings.patch('signup', { mode: 'invite' }, null);
    await t.c.db.execute(sql`INSERT INTO invite_codes (code, max_uses) VALUES ('WELCOME1', 1)`);
    expect((await signup(t.client())).res.json().error.code).toBe('SIGNUP_CLOSED');
    expect((await signup(t.client(), { inviteCode: 'WELCOME1' })).res.statusCode).toBe(201);
    expect((await signup(t.client(), { inviteCode: 'WELCOME1' })).res.json().error.code).toBe('SIGNUP_CLOSED');
    await t.c.settings.patch('signup', { mode: 'open' }, null);
  });
});

describe('email verification', () => {
  it('captures the email, verifies once, rejects reuse', async () => {
    const client = t.client();
    const { email } = await signup(client);
    const mail = t.mail.lastTo(email)!;
    expect(mail.subject).toMatch(/Verify your email/);
    expect(mail.text).toContain('/verify-email?token=');
    const token = extractToken(mail.text, '/verify-email');

    const ok = await client.post('/api/auth/verify-email', { token });
    expect(ok.statusCode).toBe(200);
    expect((await client.get('/api/me')).json().user.emailVerified).toBe(true);

    const again = await client.post('/api/auth/verify-email', { token });
    expect(again.json().error.code).toBe('INVALID_TOKEN');
    expect(t.mail.lastTo(email)!.subject).toMatch(/Welcome/);
  });

  it('expired tokens report TOKEN_EXPIRED', async () => {
    const client = t.client();
    const { email } = await signup(client);
    const token = extractToken(t.mail.lastTo(email)!.text, '/verify-email');
    t.clock.advance(49 * 3600_000);
    const res = await client.post('/api/auth/verify-email', { token });
    expect(res.json().error.code).toBe('TOKEN_EXPIRED');
  });

  it('enforces resend cooldown and daily cap', async () => {
    const client = t.client();
    const { email } = await signup(client);
    // The sign-up email itself starts the cooldown.
    expect((await client.post('/api/auth/resend-verification')).statusCode).toBe(429);
    t.clock.advance(61_000);
    const first = await client.post('/api/auth/resend-verification');
    expect(first.statusCode).toBe(200);
    const tooSoon = await client.post('/api/auth/resend-verification');
    expect(tooSoon.statusCode).toBe(429);
    expect(tooSoon.json().error.code).toBe('RATE_LIMITED');
    expect(tooSoon.json().error.resetAt).toBeTruthy();
    // The newest link works and older ones are invalidated.
    const old = extractToken(t.mail.outbox.filter((m) => m.to === email)[0]!.text, '/verify-email');
    expect((await client.post('/api/auth/verify-email', { token: old })).json().error.code).toBe('INVALID_TOKEN');
    for (let i = 0; i < 3; i++) {
      t.clock.advance(61_000);
      await client.post('/api/auth/resend-verification');
    }
    t.clock.advance(61_000);
    const capped = await client.post('/api/auth/resend-verification');
    expect(capped.json().error.message).toMatch(/Daily/);
  });

  it('a garbage token is rejected', async () => {
    const res = await t.client().post('/api/auth/verify-email', { token: 'x'.repeat(43) });
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });
});

describe('unverified restrictions are enforced server-side', () => {
  it('locked features return EMAIL_VERIFICATION_REQUIRED until verified', async () => {
    const client = t.client();
    const { email } = await signup(client);
    const me = (await client.get('/api/me')).json();
    expect(me.entitlements.tierId).toBe('unverified');
    expect(me.entitlements.features.codeMode).toEqual({ allowed: false, reason: 'EMAIL_UNVERIFIED' });
    expect(me.entitlements.limits.scheduledTasks).toBe(2);

    for (const url of ['/api/test/code-mode', '/api/test/api-keys']) {
      const r = await client.post(url);
      expect(r.statusCode).toBe(403);
      expect(r.json().error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    }
    expect((await client.get('/api/test/verified-only')).json().error.code).toBe('EMAIL_VERIFICATION_REQUIRED');

    await client.post('/api/auth/verify-email', { token: extractToken(t.mail.lastTo(email)!.text, '/verify-email') });
    expect((await client.post('/api/test/code-mode')).json()).toEqual({ ok: true });
    expect((await client.get('/api/me')).json().entitlements.tierId).toBe('verified');
  });

  it('admin kill switch disables a feature for everyone', async () => {
    await t.c.settings.set('features', { codeMode: false }, null);
    const client = t.client();
    await signup(client);
    const r = await client.post('/api/test/code-mode');
    expect(r.json().error.code).toBe('FEATURE_LOCKED');
    await t.c.settings.set('features', {}, null);
  });
});

describe('login, lockout and sessions', () => {
  it('logs in, rejects bad credentials without revealing account existence', async () => {
    const { email } = await signup(t.client());
    const ok = await t.client().post('/api/auth/login', { email, password: STRONG_PASSWORD });
    expect(ok.statusCode).toBe(200);
    const bad = await t.client().post('/api/auth/login', { email, password: 'wrong-password' });
    const unknown = await t.client().post('/api/auth/login', { email: uniqueEmail(), password: 'wrong-password' });
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(bad.json().error.message).toBe(unknown.json().error.message);
  });

  it('progressively locks the account after repeated failures', async () => {
    const { email } = await signup(t.client());
    const c = t.client();
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email, password: 'nope-nope-nope' });
    const locked = await c.post('/api/auth/login', { email, password: STRONG_PASSWORD });
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error.code).toBe('ACCOUNT_LOCKED');
    t.clock.advance(61_000);
    expect((await c.post('/api/auth/login', { email, password: STRONG_PASSWORD })).statusCode).toBe(200);
  });

  it('lists sessions, revokes one, signs out everywhere', async () => {
    const { email } = await signup(t.client());
    const a = t.client();
    const b = t.client();
    b.userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537';
    await a.post('/api/auth/login', { email, password: STRONG_PASSWORD });
    await b.post('/api/auth/login', { email, password: STRONG_PASSWORD });
    const list = (await a.get('/api/me/sessions')).json().items as { id: string; current: boolean; device: string }[];
    expect(list.length).toBe(3);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    const bSession = list.find((s) => !s.current && s.device === 'Chrome on Windows')!;
    expect((await a.del(`/api/me/sessions/${bSession.id}`)).statusCode).toBe(204);
    expect((await b.get('/api/me')).statusCode).toBe(401);

    const all = await a.post('/api/me/sessions/revoke-all', { keepCurrent: false });
    expect(all.json().revoked).toBeGreaterThanOrEqual(1);
    expect((await a.get('/api/me')).statusCode).toBe(401);
  });

  it('records login history and notifies on a new device', async () => {
    const { email } = await signup(t.client());
    const c2 = t.client();
    c2.ip = '198.51.100.77';
    c2.userAgent = 'Mozilla/5.0 (Macintosh; Mac OS X 14) Safari/605';
    t.mail.clear();
    t.clock.advance(1000);
    await c2.post('/api/auth/login', { email, password: STRONG_PASSWORD });
    expect(t.mail.lastTo(email)?.subject).toMatch(/Security alert/);
    const hist = (await c2.get('/api/me/login-history')).json().items;
    expect(hist[0]).toMatchObject({ success: true, ip: '198.51.100.77', device: 'Safari on macOS' });
  });

  it('rotates the session token and honors a short grace window', async () => {
    const c = t.client();
    await signup(c);
    const original = c.sessionToken!;
    t.clock.advance(25 * 3600_000);
    const res = await c.get('/api/me');
    expect(res.statusCode).toBe(200);
    const rotated = c.sessionToken!;
    expect(rotated).not.toBe(original);

    const stale = t.client();
    stale.cookies.set('lumen_session', original);
    expect((await stale.get('/api/me')).statusCode).toBe(200);
    t.clock.advance(61_000);
    const stale2 = t.client();
    stale2.cookies.set('lumen_session', original);
    expect((await stale2.get('/api/me')).statusCode).toBe(401);
    expect((await c.get('/api/me')).statusCode).toBe(200);
  });

  it('logout revokes the session', async () => {
    const c = t.client();
    await signup(c);
    const token = c.sessionToken!;
    await c.post('/api/auth/logout');
    const replay = t.client();
    replay.cookies.set('lumen_session', token);
    expect((await replay.get('/api/me')).statusCode).toBe(401);
  });

  it('suspended users cannot sign in and their sessions stop working', async () => {
    const c = t.client();
    const { email, body } = await signup(c);
    await t.c.db.execute(sql`UPDATE users SET status = 'suspended' WHERE id = ${body.user.id}`);
    expect((await c.get('/api/me/sessions')).json().error.code).toBe('ACCOUNT_SUSPENDED');
    expect((await t.client().post('/api/auth/login', { email, password: STRONG_PASSWORD })).json().error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('two-factor authentication', () => {
  it('setup, login with code, replay protection, recovery codes, disable', async () => {
    const c = t.client();
    const { email } = await signup(c);
    const setup = (await c.post('/api/me/2fa/setup')).json();
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), digits: 6, period: 30 });
    const code = () => totp.generate({ timestamp: t.clock.now.getTime() });

    expect((await c.post('/api/me/2fa/confirm', { code: '000000' })).json().error.code).toBe('INVALID_TWO_FACTOR_CODE');
    const confirmed = (await c.post('/api/me/2fa/confirm', { code: code() })).json();
    expect(confirmed.recoveryCodes).toHaveLength(10);

    const l = t.client();
    expect((await l.post('/api/auth/login', { email, password: STRONG_PASSWORD })).json().error.code).toBe('TWO_FACTOR_REQUIRED');
    t.clock.advance(30_000);
    const used = code();
    expect((await l.post('/api/auth/login', { email, password: STRONG_PASSWORD, totpCode: used })).statusCode).toBe(200);
    // Same code again in the same step is a replay.
    expect((await t.client().post('/api/auth/login', { email, password: STRONG_PASSWORD, totpCode: used })).json().error.code).toBe(
      'INVALID_TWO_FACTOR_CODE',
    );
    const rc = confirmed.recoveryCodes[0];
    expect((await t.client().post('/api/auth/login', { email, password: STRONG_PASSWORD, recoveryCode: rc })).statusCode).toBe(200);
    expect((await t.client().post('/api/auth/login', { email, password: STRONG_PASSWORD, recoveryCode: rc })).statusCode).toBe(401);
    expect((await c.get('/api/me/2fa')).json()).toEqual({ enabled: true, recoveryCodesRemaining: 9 });

    t.clock.advance(30_000);
    const regen = await c.post('/api/me/2fa/recovery-codes', { code: code() });
    expect(regen.json().recoveryCodes).toHaveLength(10);
    t.clock.advance(30_000);
    expect((await c.post('/api/me/2fa/disable', { password: STRONG_PASSWORD, code: code() })).json().enabled).toBe(false);
    expect((await t.client().post('/api/auth/login', { email, password: STRONG_PASSWORD })).statusCode).toBe(200);
  });

  it('stores the TOTP secret encrypted', async () => {
    const c = t.client();
    const { body } = await signup(c);
    const setup = (await c.post('/api/me/2fa/setup')).json();
    const [row] = (await t.c.db.execute(sql`SELECT totp_secret_enc FROM users WHERE id = ${body.user.id}`)) as unknown as { totp_secret_enc: string }[];
    expect(row!.totp_secret_enc).not.toContain(setup.secret);
    expect(row!.totp_secret_enc.startsWith('v1.')).toBe(true);
  });
});

describe('password reset and change, email change', () => {
  it('reset flow revokes sessions and lets the user sign in with the new password', async () => {
    const c = t.client();
    const { email } = await signup(c);
    t.mail.clear();
    await t.client().post('/api/auth/forgot-password', { email });
    const token = extractToken(t.mail.lastTo(email)!.text, '/reset-password');
    const newPw = 'a whole new passphrase 2026';
    expect((await t.client().post('/api/auth/reset-password', { token, password: newPw })).statusCode).toBe(200);
    expect((await c.get('/api/me')).statusCode).toBe(401);
    expect((await t.client().post('/api/auth/login', { email, password: STRONG_PASSWORD })).statusCode).toBe(401);
    expect((await t.client().post('/api/auth/login', { email, password: newPw })).statusCode).toBe(200);
    expect((await t.client().post('/api/auth/reset-password', { token, password: newPw })).json().error.code).toBe('INVALID_TOKEN');
  });

  it('forgot-password is silent for unknown emails', async () => {
    t.mail.clear();
    const res = await t.client().post('/api/auth/forgot-password', { email: uniqueEmail() });
    expect(res.statusCode).toBe(200);
    expect(t.mail.outbox).toHaveLength(0);
  });

  it('change password requires the current one and keeps the current session', async () => {
    const c = t.client();
    const { email } = await signup(c);
    const other = t.client();
    await other.post('/api/auth/login', { email, password: STRONG_PASSWORD });
    expect((await c.post('/api/me/password', { currentPassword: 'bad', newPassword: 'another long passphrase 9' })).statusCode).toBe(401);
    expect((await c.post('/api/me/password', { currentPassword: STRONG_PASSWORD, newPassword: 'another long passphrase 9' })).statusCode).toBe(200);
    expect((await c.get('/api/me')).statusCode).toBe(200);
    expect((await other.get('/api/me')).statusCode).toBe(401);
  });

  it('email change re-verifies the new address and notifies the old one', async () => {
    const c = t.client();
    const { email } = await signup(c);
    const newEmail = uniqueEmail('new');
    expect((await c.post('/api/me/email', { newEmail, password: STRONG_PASSWORD })).statusCode).toBe(200);
    const token = extractToken(t.mail.lastTo(newEmail)!.text, '/confirm-email-change');
    expect((await c.post('/api/auth/confirm-email-change', { token })).json()).toEqual({ changed: true, email: newEmail });
    const me = (await c.get('/api/me')).json().user;
    expect(me.email).toBe(newEmail);
    expect(me.emailVerified).toBe(true);
    expect(t.mail.lastTo(email)!.subject).toMatch(/email was changed/);
  });
});

describe('magic link', () => {
  it('is disabled by default and works when enabled', async () => {
    const { email } = await signup(t.client());
    expect((await t.client().post('/api/auth/magic-link/request', { email })).json().error.code).toBe('FEATURE_LOCKED');
    await t.c.settings.patch('security', { magicLinkEnabled: true }, null);
    await t.client().post('/api/auth/magic-link/request', { email });
    const token = extractToken(t.mail.lastTo(email)!.text, '/magic-link');
    const c = t.client();
    const res = await c.post('/api/auth/magic-link/consume', { token });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.emailVerified).toBe(true);
    expect((await c.post('/api/auth/magic-link/consume', { token })).json().error.code).toBe('INVALID_TOKEN');
    await t.c.settings.patch('security', { magicLinkEnabled: false }, null);
  });
});
