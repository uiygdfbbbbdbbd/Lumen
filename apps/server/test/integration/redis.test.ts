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

describe('BullJobQueue', () => {
  it('runs jobs whose ids use the app’s "kind:id" format, once per id', async (ctx) => {
    if (!available) return ctx.skip();
    const { BullJobQueue } = await import('../../src/lib/jobs.js');
    const q = new BullJobQueue({ url }, true, undefined, `lumen-test-${Date.now()}`);
    const seen: string[] = [];
    q.register<{ v: string }>('test.job', async ({ v }) => {
      seen.push(v);
    });
    await q.enqueue('test.job', { v: 'a' }, { jobId: 'file:123' });
    await q.enqueue('test.job', { v: 'dup' }, { jobId: 'file:123' });
    await q.enqueue('test.job', { v: 'b' }, { jobId: 'memory-consolidate:u1' });
    const deadline = Date.now() + 10_000;
    while (seen.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    await q.close();
    expect(seen.sort()).toEqual(['a', 'b']);
  });
});
