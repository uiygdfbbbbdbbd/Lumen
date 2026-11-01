import { and, eq, sql } from 'drizzle-orm';
import {
  computeEntitlements,
  DEFAULT_TIERS,
  LumenError,
  tierDefinitionSchema,
  type Entitlements,
  type LimitKey,
  type TierDefinition,
} from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { tiers, usageCounters, type UserRow } from '../../db/schema/index.js';
import type { SettingsService } from '../settings/settings.service.js';

/** UTC day key used for daily counters. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function nextUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

export class EntitlementService {
  private tierCache: { at: number; value: Record<string, TierDefinition> } | null = null;

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async tiers(): Promise<Record<string, TierDefinition>> {
    if (this.tierCache && Date.now() - this.tierCache.at < 5_000) return this.tierCache.value;
    const rows = await this.db.select().from(tiers);
    const out: Record<string, TierDefinition> = { ...DEFAULT_TIERS };
    for (const r of rows) {
      const parsed = tierDefinitionSchema.safeParse({ id: r.id, name: r.name, features: r.features, limits: r.limits });
      if (parsed.success) out[r.id] = parsed.data;
    }
    this.tierCache = { at: Date.now(), value: out };
    return out;
  }

  invalidate() {
    this.tierCache = null;
  }

  async forUser(user: Pick<UserRow, 'role' | 'emailVerifiedAt' | 'status' | 'tierId' | 'overrides'>): Promise<Entitlements> {
    const [allTiers, globalFeatures] = await Promise.all([this.tiers(), this.settings.get('features')]);
    return computeEntitlements(
      {
        role: user.role,
        emailVerified: Boolean(user.emailVerifiedAt),
        status: user.status,
        tierId: user.tierId,
        overrides: user.overrides,
      },
      { tiers: allTiers, globalFeatures },
    );
  }

  async usage(userId: string, metric: string, day = dayKey(this.now())): Promise<number> {
    const [row] = await this.db
      .select({ value: usageCounters.value })
      .from(usageCounters)
      .where(and(eq(usageCounters.userId, userId), eq(usageCounters.day, day), eq(usageCounters.metric, metric)));
    return row?.value ?? 0;
  }

  /**
   * Atomically add `amount` to a daily counter only if the result stays within `limit`.
   * Concurrency-safe: the check and the increment happen in one UPDATE ... WHERE statement.
   */
  async consume(userId: string, metric: string, amount: number, limit: number): Promise<{ ok: boolean; used: number; resetAt: Date }> {
    const now = this.now();
    const day = dayKey(now);
    const resetAt = nextUtcMidnight(now);
    if (amount > limit) return { ok: false, used: await this.usage(userId, metric, day), resetAt };
    await this.db.insert(usageCounters).values({ userId, day, metric, value: 0 }).onConflictDoNothing();
    const rows = await this.db
      .update(usageCounters)
      .set({ value: sql`${usageCounters.value} + ${amount}` })
      .where(
        and(
          eq(usageCounters.userId, userId),
          eq(usageCounters.day, day),
          eq(usageCounters.metric, metric),
          sql`${usageCounters.value} + ${amount} <= ${limit}`,
        ),
      )
      .returning({ value: usageCounters.value });
    if (rows[0]) return { ok: true, used: rows[0].value, resetAt };
    return { ok: false, used: await this.usage(userId, metric, day), resetAt };
  }

  /** Record usage that already happened (e.g. tokens after a stream finishes) without a ceiling. */
  async add(userId: string, metric: string, amount: number): Promise<void> {
    const day = dayKey(this.now());
    await this.db
      .insert(usageCounters)
      .values({ userId, day, metric, value: amount })
      .onConflictDoUpdate({
        target: [usageCounters.userId, usageCounters.day, usageCounters.metric],
        set: { value: sql`${usageCounters.value} + ${amount}` },
      });
  }

  /** Throws QUOTA_EXCEEDED with reset time when the daily limit is used up. */
  async consumeOrThrow(user: UserRow, ent: Entitlements, metric: string, limitKey: LimitKey, amount = 1): Promise<void> {
    const limit = ent.limits[limitKey];
    const r = await this.consume(user.id, metric, amount, limit);
    if (!r.ok) {
      throw new LumenError('QUOTA_EXCEEDED', `Daily limit reached (${limit}). Resets at ${r.resetAt.toISOString()}.`, {
        resetAt: r.resetAt.toISOString(),
        details: { metric, limit, used: r.used },
      });
    }
  }
}
