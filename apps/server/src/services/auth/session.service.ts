import { and, desc, eq, gt, isNull, ne, or } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { sessions, users, type UserRow } from '../../db/schema/index.js';
import { randomToken, type TokenHasher } from '../../lib/tokens.js';

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
  location?: string | null;
}

export type SessionRow = typeof sessions.$inferSelect;

export interface SessionOptions {
  ttlMs: number;
  rotateAfterMs: number;
  /** How long the pre-rotation token keeps working (covers in-flight parallel requests). */
  graceMs: number;
  now?: () => Date;
}

export class SessionService {
  private readonly now: () => Date;
  constructor(
    private readonly db: Database,
    private readonly hasher: TokenHasher,
    private readonly opts: SessionOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  async create(userId: string, meta: SessionMeta): Promise<{ token: string; session: SessionRow }> {
    const token = randomToken(32);
    const now = this.now();
    const [session] = await this.db
      .insert(sessions)
      .values({
        userId,
        tokenHash: this.hasher.hash(token),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        location: meta.location ?? null,
        createdAt: now,
        lastSeenAt: now,
        rotatedAt: now,
        expiresAt: new Date(now.getTime() + this.opts.ttlMs),
      })
      .returning();
    return { token, session: session! };
  }

  async authenticate(
    token: string,
    meta: SessionMeta,
  ): Promise<{ user: UserRow; session: SessionRow; newToken: string | null } | null> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const hash = this.hasher.hash(token);
    const now = this.now();
    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          or(eq(sessions.tokenHash, hash), and(eq(sessions.prevTokenHash, hash), gt(sessions.prevValidUntil, now))),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (row.user.status === 'banned') {
      await this.revoke(row.user.id, row.session.id);
      return null;
    }

    const usedCurrent = row.session.tokenHash === hash;
    let newToken: string | null = null;
    let session = row.session;
    if (usedCurrent && now.getTime() - row.session.rotatedAt.getTime() >= this.opts.rotateAfterMs) {
      newToken = randomToken(32);
      const [updated] = await this.db
        .update(sessions)
        .set({
          tokenHash: this.hasher.hash(newToken),
          prevTokenHash: hash,
          prevValidUntil: new Date(now.getTime() + this.opts.graceMs),
          rotatedAt: now,
          lastSeenAt: now,
          ip: meta.ip,
          expiresAt: new Date(now.getTime() + this.opts.ttlMs),
        })
        // Compare-and-swap: if a parallel request already rotated, keep its token.
        .where(and(eq(sessions.id, row.session.id), eq(sessions.tokenHash, hash)))
        .returning();
      if (updated) session = updated;
      else newToken = null;
    } else if (now.getTime() - row.session.lastSeenAt.getTime() > 60_000) {
      await this.db.update(sessions).set({ lastSeenAt: now, ip: meta.ip }).where(eq(sessions.id, row.session.id));
    }
    return { user: row.user, session, newToken };
  }

  async list(userId: string) {
    return this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, this.now())))
      .orderBy(desc(sessions.lastSeenAt));
  }

  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const res = await this.db
      .update(sessions)
      .set({ revokedAt: this.now() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return res.length > 0;
  }

  async revokeAll(userId: string, exceptSessionId?: string | null): Promise<number> {
    const res = await this.db
      .update(sessions)
      .set({ revokedAt: this.now() })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
        ),
      )
      .returning({ id: sessions.id });
    return res.length;
  }
}
