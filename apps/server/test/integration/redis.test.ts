import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisRateLimiter } from '../../src/lib/rate-limit.js';

const url = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
let redis: Redis;
let available = true;

beforeAll(async () => {
  redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.flushdb();
  } catch {
    available = false;
  }
});
afterAll(() => redis.disconnect());

describe('RedisRateLimiter', () => {
  it('counts atomically across concurrent hits and expires', async (ctx) => {
    if (!available) ctx.skip();
    const rl = new RedisRateLimiter(redis, 'test:');
    const results = await Promise.all(Array.from({ length: 20 }, () => rl.hit('k', 5, 500)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.every((r) => r.resetAt.getTime() > Date.now())).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
    expect((await rl.hit('k', 5, 500)).allowed).toBe(true);
    await rl.reset('k');
    expect((await rl.hit('k', 1, 500, 1)).remaining).toBe(0);
  });
});
