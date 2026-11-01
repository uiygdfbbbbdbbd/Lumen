import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number, cost?: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

/** Fixed-window counter in process memory. Used in tests and single-node dev without Redis. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowMs: number, cost = 1): Promise<RateLimitResult> {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + windowMs };
      this.buckets.set(key, b);
    }
    b.count += cost;
    if (this.buckets.size > 50_000) this.sweep(t);
    return { allowed: b.count <= limit, limit, remaining: Math.max(0, limit - b.count), resetAt: new Date(b.resetAt) };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  private sweep(t: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= t) this.buckets.delete(k);
  }
}

const LUA = `
local c = redis.call('INCRBY', KEYS[1], ARGV[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]); ttl = tonumber(ARGV[2]) end
return {c, ttl}`;

/** Atomic fixed-window counter shared by all server instances. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis, private readonly prefix = 'rl:') {}

  async hit(key: string, limit: number, windowMs: number, cost = 1): Promise<RateLimitResult> {
    const [count, ttl] = (await this.redis.eval(LUA, 1, this.prefix + key, cost, windowMs)) as [number, number];
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt: new Date(Date.now() + ttl) };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}

/**
 * Progressive lockout: after `threshold` failures, lock for base * 2^(extra failures), capped.
 * Returns the lock duration in ms, or 0 if not locked.
 */
export function lockoutDurationMs(failures: number, threshold = 5, baseMs = 60_000, maxMs = 60 * 60_000): number {
  if (failures < threshold) return 0;
  return Math.min(maxMs, baseMs * 2 ** (failures - threshold));
}
