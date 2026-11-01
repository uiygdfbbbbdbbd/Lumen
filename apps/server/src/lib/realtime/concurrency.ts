import type { Redis } from 'ioredis';

/** Caps simultaneous operations per key (e.g. concurrent streams per user). Leases expire to survive crashes. */
export interface ConcurrencyLimiter {
  acquire(key: string, limit: number): Promise<(() => Promise<void>) | null>;
}

export class MemoryConcurrencyLimiter implements ConcurrencyLimiter {
  private readonly counts = new Map<string, number>();
  async acquire(key: string, limit: number) {
    const n = this.counts.get(key) ?? 0;
    if (n >= limit) return null;
    this.counts.set(key, n + 1);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const left = (this.counts.get(key) ?? 1) - 1;
      if (left <= 0) this.counts.delete(key);
      else this.counts.set(key, left);
    };
  }
}

const ACQUIRE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1`;

export class RedisConcurrencyLimiter implements ConcurrencyLimiter {
  constructor(private readonly redis: Redis, private readonly leaseMs = 15 * 60_000) {}
  async acquire(key: string, limit: number) {
    const now = Date.now();
    const member = `${now}-${Math.random().toString(36).slice(2)}`;
    const ok = await this.redis.eval(ACQUIRE, 1, `lumen:conc:${key}`, now - this.leaseMs, limit, now, member, this.leaseMs);
    if (ok !== 1) return null;
    return async () => {
      await this.redis.zrem(`lumen:conc:${key}`, member);
    };
  }
}
