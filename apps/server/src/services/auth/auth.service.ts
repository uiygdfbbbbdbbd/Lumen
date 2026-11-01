import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import { LumenError, type LoginInput, type SignupInput } from '@lumen/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/client.js';
import { inviteCodes, loginEvents, users, type UserRow } from '../../db/schema/index.js';
import type { BreachChecker, PasswordHasher } from '../../lib/password.js';
import { MIN_PASSWORD_SCORE, passwordStrength } from '../../lib/password-strength.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import { lockoutDurationMs } from '../../lib/rate-limit.js';
import { randomToken } from '../../lib/tokens.js';
import type { AuditService } from '../audit/audit.service.js';
import type { EmailService } from '../email/email.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { CaptchaVerifier } from './captcha.js';
import { domainAllowed, isDisposable } from './disposable-domains.js';
import type { EmailTokenService } from './email-token.service.js';
import { describeUserAgent } from './geo.js';
import type { SessionMeta, SessionRow, SessionService } from './session.service.js';
import type { TotpService } from './totp.service.js';

export interface AuthDeps {
  db: Database;
  hasher: PasswordHasher;
  sessions: SessionService;
  tokens: EmailTokenService;
  totp: TotpService;
  email: EmailService;
  settings: SettingsService;
  audit: AuditService;
  rateLimiter: RateLimiter;
  captcha: CaptchaVerifier;
  breachChecker: BreachChecker | null;
  publicUrl: string;
  log: Logger;
  rateLimitMultiplier?: number;
  now?: () => Date;
}

export interface AuthResult {
  user: UserRow;
  token: string;
  session: SessionRow;
}

export class AuthService {
  private dummyHash: Promise<string> | null = null;
  private readonly now: () => Date;

  constructor(private readonly d: AuthDeps) {
    this.now = d.now ?? (() => new Date());
  }

  /** Equalizes timing for unknown emails: we always run one argon2 verification. */
  private getDummyHash() {
    this.dummyHash ??= this.d.hasher.hash(randomToken(16));
    return this.dummyHash;
  }

  async assertPasswordAcceptable(password: string, userInputs: string[]): Promise<void> {
    const strength = passwordStrength(password, userInputs);
    if (strength.score < MIN_PASSWORD_SCORE) {
      throw new LumenError('WEAK_PASSWORD', strength.warning ?? 'Choose a stronger password.', {
        details: { score: strength.score, suggestions: strength.suggestions },
      });
    }
    if (this.d.breachChecker && (await this.d.breachChecker(password))) {
      throw new LumenError('WEAK_PASSWORD', 'This password appeared in a known data breach. Choose a different one.', {
        details: { breached: true },
      });
    }
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [u] = await this.d.db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
    return u;
  }

  async signup(input: SignupInput, meta: SessionMeta & { ip: string }): Promise<AuthResult> {
    const s = await this.d.settings.get('signup');
    const ipLimit = await this.d.rateLimiter.hit(`signup:ip:${meta.ip}`, s.maxSignupsPerIpPerDay * (this.d.rateLimitMultiplier ?? 1), 24 * 3600_000);
    if (!ipLimit.allowed) {
      throw new LumenError('RATE_LIMITED', 'Too many sign-ups from this network today.', { resetAt: ipLimit.resetAt.toISOString() });
    }
    if (s.captcha !== 'none' && !(await this.d.captcha.verify(input.captchaToken, meta.ip))) {
      throw new LumenError('CAPTCHA_FAILED', 'CAPTCHA verification failed. Please try again.');
    }
    if (s.blockDisposableEmails && isDisposable(input.email)) {
      throw new LumenError('DISPOSABLE_EMAIL', 'Disposable email addresses are not allowed.');
    }
    if (s.minimumAge > 0) {
      if (!input.birthYear) throw new LumenError('VALIDATION_FAILED', 'Birth year is required.', { details: [{ path: 'birthYear', message: 'Required' }] });
      // Conservative: assume the birthday hasn't happened yet this year.
      const age = this.now().getUTCFullYear() - input.birthYear - 1;
      if (age < s.minimumAge) throw new LumenError('FORBIDDEN', `You must be at least ${s.minimumAge} to use this service.`);
    }
    await this.assertPasswordAcceptable(input.password, [input.email, input.displayName]);

    const passwordHash = await this.d.hasher.hash(input.password);
    const legal = await this.d.settings.get('legal');

    const user = await this.d.db.transaction(async (tx) => {
      // Serialize sign-ups so exactly one "first user" becomes super_admin.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7271001)`);
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(users);
      const isFirst = n === 0;

      if (!isFirst) {
        if (s.mode === 'closed') throw new LumenError('SIGNUP_CLOSED', 'Sign-ups are closed on this instance.');
        if (s.mode === 'allowlist' && !domainAllowed(input.email, s.allowlistDomains)) {
          throw new LumenError('SIGNUP_CLOSED', 'Sign-ups are limited to approved email domains.');
        }
        if (s.mode === 'invite') {
          if (!input.inviteCode) throw new LumenError('SIGNUP_CLOSED', 'An invite code is required to sign up.');
          const used = await tx
            .update(inviteCodes)
            .set({ uses: sql`${inviteCodes.uses} + 1` })
            .where(
              and(
                eq(inviteCodes.code, input.inviteCode),
                sql`${inviteCodes.uses} < ${inviteCodes.maxUses}`,
                sql`(${inviteCodes.expiresAt} IS NULL OR ${inviteCodes.expiresAt} > now())`,
              ),
            )
            .returning({ code: inviteCodes.code });
          if (used.length === 0) throw new LumenError('SIGNUP_CLOSED', 'That invite code is invalid or used up.');
        }
      }

      const existing = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
      if (existing.length) throw new LumenError('EMAIL_TAKEN', 'An account with this email already exists.');

      const [created] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          role: isFirst ? 'super_admin' : 'user',
          tosVersionAccepted: legal.tosVersion,
          birthYear: input.birthYear ?? null,
        })
        .returning();
      return created!;
    });

    await this.d.audit.log({ actorId: user.id, action: 'auth.signup', targetType: 'user', targetId: user.id, ip: meta.ip, metadata: { role: user.role } });
    const { token, session } = await this.d.sessions.create(user.id, meta);
    await this.recordLogin(user.id, user.email, true, null, 'signup', meta);
    // Email failure must not fail sign-up; the user can resend from the banner.
    await this.sendVerification(user, { skipLimits: true }).catch((err: unknown) =>
      this.d.log.warn({ err: (err as Error).message }, 'verification email failed at signup'),
    );
    return { user, token, session };
  }

  async login(input: LoginInput, meta: SessionMeta & { ip: string }): Promise<AuthResult> {
    const ipRl = await this.d.rateLimiter.hit(`login:ip:${meta.ip}`, 30 * (this.d.rateLimitMultiplier ?? 1), 15 * 60_000);
    if (!ipRl.allowed) throw new LumenError('RATE_LIMITED', 'Too many sign-in attempts. Try again later.', { resetAt: ipRl.resetAt.toISOString() });
    const sec = await this.d.settings.get('security');
    const signup = await this.d.settings.get('signup');
    if (signup.captcha !== 'none' && input.captchaToken !== undefined && !(await this.d.captcha.verify(input.captchaToken, meta.ip))) {
      throw new LumenError('CAPTCHA_FAILED', 'CAPTCHA verification failed.');
    }

    const user = await this.findByEmail(input.email);
    const now = this.now();
    if (user?.lockedUntil && user.lockedUntil > now) {
      await this.recordLogin(user.id, input.email, false, 'locked', 'password', meta);
      throw new LumenError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', { resetAt: user.lockedUntil.toISOString() });
    }
    const ok = await this.d.hasher.verify(user?.passwordHash ?? (await this.getDummyHash()), input.password);
    if (!user || !user.passwordHash || !ok) {
      if (user) await this.registerFailure(user, sec.lockoutThreshold, sec.lockoutBaseSeconds);
      await this.recordLogin(user?.id ?? null, input.email, false, 'bad_password', 'password', meta);
      throw new LumenError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (user.status === 'banned' || user.status === 'suspended') {
      await this.recordLogin(user.id, input.email, false, user.status, 'password', meta);
      throw new LumenError('ACCOUNT_SUSPENDED', 'This account is suspended.', { details: { reason: user.statusReason } });
    }
    if (user.totpEnabled) {
      if (!input.totpCode && !input.recoveryCode) throw new LumenError('TWO_FACTOR_REQUIRED', 'Enter your two-factor code.');
      const passed = input.totpCode
        ? await this.d.totp.verifyAndRecord(user, input.totpCode)
        : await this.d.totp.useRecoveryCode(user.id, input.recoveryCode!);
      if (!passed) {
        await this.registerFailure(user, sec.lockoutThreshold, sec.lockoutBaseSeconds);
        await this.recordLogin(user.id, input.email, false, 'bad_2fa', 'password', meta);
        throw new LumenError('INVALID_TWO_FACTOR_CODE', 'That code is not valid.');
      }
      if (input.recoveryCode) {
        await this.d.audit.log({ actorId: user.id, action: 'auth.recovery_code_used', targetType: 'user', targetId: user.id, ip: meta.ip });
      }
    }
    return this.completeLogin(user, 'password', meta, input.password);
  }

  private async completeLogin(user: UserRow, method: string, meta: SessionMeta & { ip: string }, password?: string): Promise<AuthResult> {
    const suspicious = await this.isNewDevice(user.id, meta);
    const patch: Partial<UserRow> = { failedLoginCount: 0, lockedUntil: null, lastLoginAt: this.now() };
    if (password && user.passwordHash && this.d.hasher.needsRehash(user.passwordHash)) {
      patch.passwordHash = await this.d.hasher.hash(password);
    }
    const [fresh] = await this.d.db.update(users).set(patch).where(eq(users.id, user.id)).returning();
    await this.recordLogin(user.id, user.email, true, null, method, meta);
    const { token, session } = await this.d.sessions.create(user.id, meta);
    const sec = await this.d.settings.get('security');
    if (suspicious && sec.suspiciousLoginEmail) {
      await this.d.email
        .send('security_alert', user.email, {
          name: user.displayName,
          event: 'New sign-in to your account',
          ip: meta.ip,
          userAgent: describeUserAgent(meta.userAgent),
          when: this.now().toUTCString(),
          settingsUrl: `${this.d.publicUrl}/settings/account/security`,
        })
        .catch(() => undefined);
    }
    return { user: fresh!, token, session };
  }

  /** A sign-in is "new device" if this IP+UA pair has no successful login in 90 days and the user has prior history. */
  private async isNewDevice(userId: string, meta: SessionMeta): Promise<boolean> {
    const since = new Date(this.now().getTime() - 90 * 86400_000);
    const prior = await this.d.db
      .select({ ip: loginEvents.ip, ua: loginEvents.userAgent })
      .from(loginEvents)
      .where(and(eq(loginEvents.userId, userId), eq(loginEvents.success, true), gt(loginEvents.createdAt, since)))
      .orderBy(desc(loginEvents.createdAt))
      .limit(200);
    if (prior.length === 0) return false;
    return !prior.some((p) => p.ip === meta.ip && describeUserAgent(p.ua) === describeUserAgent(meta.userAgent));
  }

  private async registerFailure(user: UserRow, threshold: number, baseSeconds: number) {
    const failures = user.failedLoginCount + 1;
    const lockMs = lockoutDurationMs(failures, threshold, baseSeconds * 1000);
    await this.d.db
      .update(users)
      .set({ failedLoginCount: failures, lockedUntil: lockMs ? new Date(this.now().getTime() + lockMs) : null })
      .where(eq(users.id, user.id));
  }

  async recordLogin(userId: string | null, email: string, success: boolean, reason: string | null, method: string, meta: SessionMeta) {
    await this.d.db.insert(loginEvents).values({
      userId,
      email: email.toLowerCase(),
      success,
      reason,
      method,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      location: meta.location ?? null,
      createdAt: this.now(),
    });
  }

  async sendVerification(user: UserRow, opts: { skipLimits?: boolean } = {}): Promise<void> {
    if (user.emailVerifiedAt) throw new LumenError('CONFLICT', 'Your email is already verified.');
    const e = await this.d.settings.get('email');
    if (!opts.skipLimits) await this.d.tokens.assertCanIssue(user.id, 'verify_email', e.resendCooldownSeconds, e.resendDailyCap);
    const token = await this.d.tokens.issue(user.id, 'verify_email', user.email, e.verifyTokenTtlHours * 3600_000);
    await this.d.email.send('verify_email', user.email, {
      name: user.displayName,
      url: `${this.d.publicUrl}/verify-email?token=${encodeURIComponent(token)}`,
      expiresHours: e.verifyTokenTtlHours,
    });
  }

  async verifyEmail(token: string, ip: string): Promise<UserRow> {
    const row = await this.d.tokens.consume(token, 'verify_email');
    const [user] = await this.d.db
      .update(users)
      .set({ emailVerifiedAt: this.now(), updatedAt: this.now() })
      .where(and(eq(users.id, row.userId), sql`lower(${users.email}) = ${row.email}`))
      .returning();
    if (!user) throw new LumenError('INVALID_TOKEN', 'This link no longer matches your account email.');
    await this.d.audit.log({ actorId: user.id, action: 'auth.email_verified', targetType: 'user', targetId: user.id, ip });
    await this.d.email
      .send('welcome', user.email, { name: user.displayName, appUrl: this.d.publicUrl })
      .catch(() => undefined);
    return user;
  }

  /** Always resolves (no account enumeration). Per-email rate limiting is silent too. */
  async requestPasswordReset(email: string, ip: string): Promise<void> {
    const user = await this.findByEmail(email);
    if (!user || user.status === 'banned') return;
    const e = await this.d.settings.get('email');
    try {
      await this.d.tokens.assertCanIssue(user.id, 'reset_password', e.resendCooldownSeconds, e.resendDailyCap);
    } catch {
      return;
    }
    const token = await this.d.tokens.issue(user.id, 'reset_password', user.email, e.resetTokenTtlMinutes * 60_000);
    await this.d.email
      .send('reset_password', user.email, {
        name: user.displayName,
        url: `${this.d.publicUrl}/reset-password?token=${encodeURIComponent(token)}`,
        expiresMinutes: e.resetTokenTtlMinutes,
      })
      .catch((err: unknown) => this.d.log.warn({ err: (err as Error).message }, 'reset email failed'));
    await this.d.audit.log({ actorId: user.id, action: 'auth.password_reset_requested', targetType: 'user', targetId: user.id, ip });
  }

  async resetPassword(token: string, password: string, ip: string): Promise<void> {
    const row = await this.d.tokens.consume(token, 'reset_password');
    const [user] = await this.d.db.select().from(users).where(eq(users.id, row.userId));
    if (!user) throw new LumenError('INVALID_TOKEN', 'This link is invalid.');
    await this.assertPasswordAcceptable(password, [user.email, user.displayName]);
    const passwordHash = await this.d.hasher.hash(password);
    // Proving control of the inbox also verifies the address.
    await this.d.db
      .update(users)
      .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: user.emailVerifiedAt ?? this.now(), updatedAt: this.now() })
      .where(eq(users.id, user.id));
    await this.d.sessions.revokeAll(user.id);
    await this.d.audit.log({ actorId: user.id, action: 'auth.password_reset', targetType: 'user', targetId: user.id, ip });
    await this.d.email
      .send('security_alert', user.email, {
        name: user.displayName,
        event: 'Your password was reset',
        ip,
        userAgent: 'Password reset link',
        when: this.now().toUTCString(),
        settingsUrl: `${this.d.publicUrl}/settings/account/security`,
      })
      .catch(() => undefined);
  }

  async changePassword(user: UserRow, current: string, next: string, currentSessionId: string | null, ip: string): Promise<void> {
    if (!user.passwordHash || !(await this.d.hasher.verify(user.passwordHash, current))) {
      throw new LumenError('INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
    await this.assertPasswordAcceptable(next, [user.email, user.displayName]);
    await this.d.db.update(users).set({ passwordHash: await this.d.hasher.hash(next), updatedAt: this.now() }).where(eq(users.id, user.id));
    await this.d.sessions.revokeAll(user.id, currentSessionId);
    await this.d.audit.log({ actorId: user.id, action: 'auth.password_changed', targetType: 'user', targetId: user.id, ip });
  }

  async requestEmailChange(user: UserRow, newEmail: string, password: string, ip: string): Promise<void> {
    if (!user.passwordHash || !(await this.d.hasher.verify(user.passwordHash, password))) {
      throw new LumenError('INVALID_CREDENTIALS', 'Password is incorrect.');
    }
    if (newEmail === user.email.toLowerCase()) throw new LumenError('BAD_REQUEST', 'That is already your email.');
    const s = await this.d.settings.get('signup');
    if (s.blockDisposableEmails && isDisposable(newEmail)) throw new LumenError('DISPOSABLE_EMAIL', 'Disposable email addresses are not allowed.');
    if (await this.findByEmail(newEmail)) throw new LumenError('EMAIL_TAKEN', 'An account with this email already exists.');
    const e = await this.d.settings.get('email');
    await this.d.tokens.assertCanIssue(user.id, 'change_email', e.resendCooldownSeconds, e.resendDailyCap);
    const token = await this.d.tokens.issue(user.id, 'change_email', newEmail, e.verifyTokenTtlHours * 3600_000);
    await this.d.email.send('change_email', newEmail, {
      name: user.displayName,
      newEmail,
      url: `${this.d.publicUrl}/confirm-email-change?token=${encodeURIComponent(token)}`,
      expiresHours: e.verifyTokenTtlHours,
    });
    await this.d.audit.log({ actorId: user.id, action: 'auth.email_change_requested', targetType: 'user', targetId: user.id, ip, metadata: { newEmail } });
  }

  async confirmEmailChange(token: string, ip: string): Promise<UserRow> {
    const row = await this.d.tokens.consume(token, 'change_email');
    if (await this.findByEmail(row.email)) throw new LumenError('EMAIL_TAKEN', 'An account with this email already exists.');
    const [before] = await this.d.db.select().from(users).where(eq(users.id, row.userId));
    if (!before) throw new LumenError('INVALID_TOKEN', 'This link is invalid.');
    const [user] = await this.d.db
      .update(users)
      .set({ email: row.email, emailVerifiedAt: this.now(), updatedAt: this.now() })
      .where(eq(users.id, row.userId))
      .returning();
    await this.d.audit.log({ actorId: user!.id, action: 'auth.email_changed', targetType: 'user', targetId: user!.id, ip, metadata: { from: before.email, to: row.email } });
    await this.d.email.send('email_changed_notice', before.email, { name: before.displayName, newEmail: row.email }).catch(() => undefined);
    return user!;
  }

  async requestMagicLink(email: string, ip: string): Promise<void> {
    const sec = await this.d.settings.get('security');
    if (!sec.magicLinkEnabled) throw new LumenError('FEATURE_LOCKED', 'Magic-link sign-in is disabled.');
    const user = await this.findByEmail(email);
    if (!user || user.status !== 'active' || user.totpEnabled) return; // 2FA users must use password + code
    const e = await this.d.settings.get('email');
    try {
      await this.d.tokens.assertCanIssue(user.id, 'magic_link', e.resendCooldownSeconds, e.resendDailyCap);
    } catch {
      return;
    }
    const token = await this.d.tokens.issue(user.id, 'magic_link', user.email, e.magicLinkTtlMinutes * 60_000);
    await this.d.email
      .send('magic_link', user.email, {
        name: user.displayName,
        url: `${this.d.publicUrl}/magic-link?token=${encodeURIComponent(token)}`,
        expiresMinutes: e.magicLinkTtlMinutes,
      })
      .catch(() => undefined);
    await this.d.audit.log({ actorId: user.id, action: 'auth.magic_link_requested', targetType: 'user', targetId: user.id, ip });
  }

  async consumeMagicLink(token: string, meta: SessionMeta & { ip: string }): Promise<AuthResult> {
    const sec = await this.d.settings.get('security');
    if (!sec.magicLinkEnabled) throw new LumenError('FEATURE_LOCKED', 'Magic-link sign-in is disabled.');
    const row = await this.d.tokens.consume(token, 'magic_link');
    const [user] = await this.d.db
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
      .where(and(eq(users.id, row.userId), sql`lower(${users.email}) = ${row.email}`))
      .returning();
    if (!user || user.status !== 'active') throw new LumenError('INVALID_TOKEN', 'This link is invalid.');
    return this.completeLogin(user, 'magic_link', meta);
  }

  async loginHistory(userId: string, limit = 50) {
    return this.d.db.select().from(loginEvents).where(eq(loginEvents.userId, userId)).orderBy(desc(loginEvents.createdAt)).limit(limit);
  }
}
