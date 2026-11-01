import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import { LumenError } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { emailTokens } from '../../db/schema/index.js';
import { randomToken, type TokenHasher } from '../../lib/tokens.js';

export type EmailTokenPurpose = 'verify_email' | 'reset_password' | 'magic_link' | 'change_email';
export type EmailTokenRow = typeof emailTokens.$inferSelect;

export class EmailTokenService {
  constructor(
    private readonly db: Database,
    private readonly hasher: TokenHasher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Enforce resend cooldown and daily cap for a purpose. Throws RATE_LIMITED with the time the
   * user may try again.
   */
  async assertCanIssue(userId: string, purpose: EmailTokenPurpose, cooldownSeconds: number, dailyCap: number): Promise<void> {
    const now = this.now();
    const [last] = await this.db
      .select({ createdAt: emailTokens.createdAt })
      .from(emailTokens)
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)))
      .orderBy(desc(emailTokens.createdAt))
      .limit(1);
    if (last && now.getTime() - last.createdAt.getTime() < cooldownSeconds * 1000) {
      const resetAt = new Date(last.createdAt.getTime() + cooldownSeconds * 1000);
      throw new LumenError('RATE_LIMITED', 'Please wait before requesting another email.', { resetAt: resetAt.toISOString() });
    }
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const [row] = await this.db
      .select({ n: count() })
      .from(emailTokens)
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose), gt(emailTokens.createdAt, dayAgo)));
    if ((row?.n ?? 0) >= dailyCap) {
      throw new LumenError('RATE_LIMITED', 'Daily email limit reached. Try again tomorrow.', {
        resetAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
      });
    }
  }

  /** Issue a fresh token. Older unused tokens for the same purpose are invalidated. */
  async issue(userId: string, purpose: EmailTokenPurpose, email: string, ttlMs: number): Promise<string> {
    const now = this.now();
    await this.db
      .update(emailTokens)
      .set({ usedAt: now })
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt)));
    const token = randomToken(32);
    await this.db.insert(emailTokens).values({
      userId,
      purpose,
      email: email.toLowerCase(),
      tokenHash: this.hasher.hash(token),
      expiresAt: new Date(now.getTime() + ttlMs),
      createdAt: now,
    });
    return token;
  }

  /**
   * Atomically mark a token used and return it. Single use: the UPDATE only matches unused rows,
   * so two concurrent consumers can't both succeed.
   */
  async consume(token: string, purpose: EmailTokenPurpose): Promise<EmailTokenRow> {
    const hash = this.hasher.hash(token);
    const now = this.now();
    const [found] = await this.db
      .select()
      .from(emailTokens)
      .where(and(eq(emailTokens.tokenHash, hash), eq(emailTokens.purpose, purpose)))
      .limit(1);
    if (!found || found.usedAt) throw new LumenError('INVALID_TOKEN', 'This link is invalid or has already been used.');
    if (found.expiresAt <= now) throw new LumenError('TOKEN_EXPIRED', 'This link has expired. Request a new one.');
    const [used] = await this.db
      .update(emailTokens)
      .set({ usedAt: now })
      .where(and(eq(emailTokens.id, found.id), isNull(emailTokens.usedAt)))
      .returning();
    if (!used) throw new LumenError('INVALID_TOKEN', 'This link is invalid or has already been used.');
    return used;
  }
}
