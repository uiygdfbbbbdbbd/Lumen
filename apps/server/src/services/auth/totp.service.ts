import { and, eq, isNull } from 'drizzle-orm';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { LumenError } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { recoveryCodes, users, type UserRow } from '../../db/schema/index.js';
import type { SecretBox } from '../../lib/crypto.js';
import { randomCode, type TokenHasher } from '../../lib/tokens.js';

const PERIOD = 30;

export class TotpService {
  constructor(
    private readonly db: Database,
    private readonly box: SecretBox,
    private readonly hasher: TokenHasher,
    private readonly issuer: () => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}

  private totp(secret: OTPAuth.Secret, label: string, issuer: string) {
    return new OTPAuth.TOTP({ issuer, label, algorithm: 'SHA1', digits: 6, period: PERIOD, secret });
  }

  /** Begin enrollment: store an encrypted pending secret. 2FA isn't active until confirmed. */
  async beginSetup(user: UserRow): Promise<{ otpauthUrl: string; qrDataUrl: string; secret: string }> {
    if (user.totpEnabled) throw new LumenError('CONFLICT', 'Two-factor authentication is already enabled.');
    const secret = new OTPAuth.Secret({ size: 20 });
    const issuer = await this.issuer();
    const totp = this.totp(secret, user.email, issuer);
    await this.db
      .update(users)
      .set({ totpSecretEnc: this.box.encrypt(secret.base32, `totp:${user.id}`), totpLastStep: null })
      .where(eq(users.id, user.id));
    const otpauthUrl = totp.toString();
    return { otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }), secret: secret.base32 };
  }

  /** Returns the accepted time step, or null. Rejects steps at/before the last accepted one (replay). */
  checkCode(user: Pick<UserRow, 'id' | 'email' | 'totpSecretEnc' | 'totpLastStep'>, code: string): number | null {
    if (!user.totpSecretEnc || !/^\d{6}$/.test(code)) return null;
    const secret = OTPAuth.Secret.fromBase32(this.box.decrypt(user.totpSecretEnc, `totp:${user.id}`));
    const totp = this.totp(secret, user.email, 'x');
    const delta = totp.validate({ token: code, timestamp: this.now(), window: 1 });
    if (delta === null) return null;
    const step = Math.floor(this.now() / 1000 / PERIOD) + delta;
    if (user.totpLastStep !== null && step <= user.totpLastStep) return null;
    return step;
  }

  async verifyAndRecord(user: UserRow, code: string): Promise<boolean> {
    const step = this.checkCode(user, code);
    if (step === null) return false;
    const res = await this.db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, user.id)))
      .returning({ id: users.id });
    return res.length > 0;
  }

  async confirmSetup(user: UserRow, code: string): Promise<string[]> {
    if (user.totpEnabled) throw new LumenError('CONFLICT', 'Two-factor authentication is already enabled.');
    if (!user.totpSecretEnc) throw new LumenError('BAD_REQUEST', 'Start two-factor setup first.');
    if (!(await this.verifyAndRecord(user, code))) throw new LumenError('INVALID_TWO_FACTOR_CODE', 'That code is not valid.');
    await this.db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id));
    return this.regenerateRecoveryCodes(user.id);
  }

  async disable(userId: string): Promise<void> {
    await this.db.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null }).where(eq(users.id, userId));
    await this.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  }

  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, () => randomCode(10));
    await this.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await this.db.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: this.hasher.hash(c) })));
    return codes;
  }

  /** Single-use recovery code redemption. */
  async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    const normalized = code.trim().toLowerCase().replace(/\s+/g, '');
    const withDash = normalized.includes('-') ? normalized : `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
    const res = await this.db
      .update(recoveryCodes)
      .set({ usedAt: new Date(this.now()) })
      .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, this.hasher.hash(withDash)), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });
    return res.length > 0;
  }

  async remainingRecoveryCodes(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: recoveryCodes.id })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
    return rows.length;
  }
}
