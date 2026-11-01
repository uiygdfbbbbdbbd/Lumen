import { describe, expect, it, vi } from 'vitest';
import { hibpChecker, PasswordHasher } from '../../src/lib/password.js';
import { MIN_PASSWORD_SCORE, passwordStrength } from '../../src/lib/password-strength.js';
import { createHash } from 'node:crypto';

const fast = new PasswordHasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });

describe('PasswordHasher (argon2id)', () => {
  it('hashes with argon2id and verifies', async () => {
    const h = await fast.hash('hunter2-is-bad');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await fast.verify(h, 'hunter2-is-bad')).toBe(true);
    expect(await fast.verify(h, 'hunter3-is-bad')).toBe(false);
  });
  it('normalizes unicode (NFKC)', async () => {
    const h = await fast.hash('ｐａｓｓ');
    expect(await fast.verify(h, 'pass')).toBe(true);
  });
  it('returns false for malformed hashes instead of throwing', async () => {
    expect(await fast.verify('not-a-hash', 'x')).toBe(false);
  });
  it('flags weaker hashes for rehash', async () => {
    const strong = new PasswordHasher();
    const weakHash = await fast.hash('x');
    expect(strong.needsRehash(weakHash)).toBe(true);
    expect(fast.needsRehash(weakHash)).toBe(false);
    expect(strong.needsRehash('$bcrypt$...')).toBe(true);
  });
});

describe('password strength', () => {
  it('rejects weak and accepts strong passwords', () => {
    expect(passwordStrength('password123').score).toBeLessThan(MIN_PASSWORD_SCORE);
    expect(passwordStrength('correct horse battery staple 42!').score).toBeGreaterThanOrEqual(MIN_PASSWORD_SCORE);
  });
  it('penalizes user inputs', () => {
    const withoutInputs = passwordStrength('ada.lovelace1815').score;
    const withInputs = passwordStrength('ada.lovelace1815', ['ada.lovelace1815@example.com', 'ada lovelace']).score;
    expect(withInputs).toBeLessThanOrEqual(withoutInputs);
  });
});

describe('HIBP k-anonymity', () => {
  it('only sends the 5-char prefix and detects breaches', async () => {
    const sha = createHash('sha1').update('password').digest('hex').toUpperCase();
    const fetchMock = vi.fn(async (url: string) => new Response(`${sha.slice(5)}:3861493\r\nAAAA:0`, { status: 200 }));
    const check = hibpChecker(fetchMock as unknown as typeof fetch);
    expect(await check('password')).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`);
  });
  it('ignores zero-count padding entries and fails open', async () => {
    const sha = createHash('sha1').update('x').digest('hex').toUpperCase();
    const padded = hibpChecker((async () => new Response(`${sha.slice(5)}:0`)) as unknown as typeof fetch);
    expect(await padded('x')).toBe(false);
    const down = hibpChecker((async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(await down('x')).toBe(false);
    const err = hibpChecker((async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    expect(await err('x')).toBe(false);
  });
});
