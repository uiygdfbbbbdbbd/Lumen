import { describe, expect, it } from 'vitest';
import { lockoutDurationMs, MemoryRateLimiter } from '../../src/lib/rate-limit.js';
import { randomCode, randomToken, TokenHasher } from '../../src/lib/tokens.js';

describe('tokens', () => {
  it('random tokens are url-safe and unique', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
  it('recovery codes are grouped and unambiguous', () => {
    for (let i = 0; i < 50; i++) expect(randomCode()).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  });
  it('hashing is keyed and deterministic', () => {
    const h1 = new TokenHasher('a'.repeat(32));
    const h2 = new TokenHasher('b'.repeat(32));
    expect(h1.hash('t')).toBe(h1.hash('t'));
    expect(h1.hash('t')).not.toBe(h2.hash('t'));
    expect(h1.equals('abc', 'abc')).toBe(true);
    expect(h1.equals('abc', 'abd')).toBe(false);
    expect(h1.equals('abc', 'abcd')).toBe(false);
  });
});

describe('MemoryRateLimiter', () => {
  it('allows up to the limit then blocks until the window resets', async () => {
    let t = 1_000;
    const rl = new MemoryRateLimiter(() => t);
    for (let i = 0; i < 3; i++) expect((await rl.hit('k', 3, 1000)).allowed).toBe(true);
    const blocked = await rl.hit('k', 3, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt.getTime()).toBe(2_000);
    t = 2_001;
    expect((await rl.hit('k', 3, 1000)).allowed).toBe(true);
  });
  it('supports weighted cost and reset', async () => {
    const rl = new MemoryRateLimiter();
    expect((await rl.hit('w', 10, 1000, 8)).remaining).toBe(2);
    expect((await rl.hit('w', 10, 1000, 3)).allowed).toBe(false);
    await rl.reset('w');
    expect((await rl.hit('w', 10, 1000, 3)).allowed).toBe(true);
  });
  it('keys are independent', async () => {
    const rl = new MemoryRateLimiter();
    await rl.hit('a', 1, 1000);
    expect((await rl.hit('a', 1, 1000)).allowed).toBe(false);
    expect((await rl.hit('b', 1, 1000)).allowed).toBe(true);
  });
  it('sweeps expired buckets when large', async () => {
    let t = 0;
    const rl = new MemoryRateLimiter(() => t);
    for (let i = 0; i < 50_001; i++) await rl.hit(`k${i}`, 1, 10);
    t = 100;
    await rl.hit('fresh', 1, 10);
    expect((rl as unknown as { buckets: Map<string, unknown> }).buckets.size).toBeLessThan(10);
  });
});

describe('progressive lockout', () => {
  it('doubles after the threshold and caps', () => {
    expect(lockoutDurationMs(4)).toBe(0);
    expect(lockoutDurationMs(5)).toBe(60_000);
    expect(lockoutDurationMs(6)).toBe(120_000);
    expect(lockoutDurationMs(7)).toBe(240_000);
    expect(lockoutDurationMs(30)).toBe(3_600_000);
  });
});
