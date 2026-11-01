import { describe, expect, it } from 'vitest';
import {
  buildPage,
  decodeCursor,
  encodeCursor,
  isErrorCode,
  LumenError,
  paginationQuerySchema,
  profilePatchSchema,
  signupSchema,
  statusForCode,
  timezoneSchema,
  displayNameSchema,
  emailSchema,
} from '../src/index.js';

describe('errors', () => {
  it('maps codes to statuses', () => {
    expect(statusForCode('EMAIL_VERIFICATION_REQUIRED')).toBe(403);
    expect(statusForCode('RATE_LIMITED')).toBe(429);
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode(5)).toBe(false);
  });
  it('serializes to the stable body shape', () => {
    const e = new LumenError('QUOTA_EXCEEDED', 'Daily limit', { resetAt: '2026-01-01T00:00:00.000Z', details: { k: 1 } });
    expect(e.status).toBe(429);
    expect(e.toBody('req1')).toEqual({
      error: { code: 'QUOTA_EXCEEDED', message: 'Daily limit', requestId: 'req1', details: { k: 1 }, resetAt: '2026-01-01T00:00:00.000Z' },
    });
    expect(new LumenError('NOT_FOUND').toBody()).toEqual({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } });
  });
});

describe('pagination', () => {
  it('round-trips cursors including unicode', () => {
    const c = { v: '2026-01-01T00:00:00Z ✓', id: 'abc' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('rejects garbage cursors', () => {
    expect(decodeCursor('!!!')).toBeNull();
    expect(decodeCursor(encodeCursor({ v: 1, id: 'x' }).slice(2))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(btoa('{"v":1}'))).toBeNull();
  });
  it('buildPage detects more rows', () => {
    const rows = [1, 2, 3].map((n) => ({ id: String(n), n }));
    const page = buildPage(rows, 2, (r) => ({ v: r.n, id: r.id }));
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.nextCursor)).toEqual({ v: 2, id: '2' });
    expect(buildPage(rows, 5, (r) => ({ v: r.n, id: r.id })).nextCursor).toBeNull();
  });
  it('clamps page size', () => {
    expect(paginationQuerySchema.parse({}).limit).toBe(25);
    expect(paginationQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(paginationQuerySchema.parse({ limit: '7' }).limit).toBe(7);
  });
});

describe('schemas', () => {
  it('normalizes emails', () => {
    expect(emailSchema.parse('  Foo@Example.COM ')).toBe('foo@example.com');
  });
  it('signup requires terms and a long password', () => {
    expect(signupSchema.safeParse({ email: 'a@b.co', password: 'short', displayName: 'A', acceptTerms: true }).success).toBe(false);
    expect(signupSchema.safeParse({ email: 'a@b.co', password: 'long-enough-pw', displayName: 'A', acceptTerms: false }).success).toBe(false);
    expect(signupSchema.safeParse({ email: 'a@b.co', password: 'long-enough-pw', displayName: 'A', acceptTerms: true }).success).toBe(true);
  });
  it('display names reject markup and control chars', () => {
    expect(displayNameSchema.safeParse('<script>').success).toBe(false);
    expect(displayNameSchema.safeParse('a\u0000b').success).toBe(false);
    expect(displayNameSchema.parse('  Ada Lovelace ')).toBe('Ada Lovelace');
  });
  it('validates time zones', () => {
    expect(timezoneSchema.safeParse('Europe/Amsterdam').success).toBe(true);
    expect(timezoneSchema.safeParse('Mars/Olympus').success).toBe(false);
  });
  it('profile patch validates locale', () => {
    expect(profilePatchSchema.safeParse({ locale: 'en-US' }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ locale: 'english' }).success).toBe(false);
  });
});

describe('patch schemas', () => {
  it('do not inject defaults for omitted fields and reject unknown keys', async () => {
    const { providerPatchSchema, modelPatchSchema, providerKeyPatchSchema, patchOf } = await import('../src/index.js');
    const { z } = await import('zod');
    expect(providerPatchSchema.parse({ apiKey: 'x' })).toEqual({ apiKey: 'x' });
    expect(providerPatchSchema.parse({ apiKey: null, headers: null })).toEqual({ apiKey: null, headers: null });
    expect(providerPatchSchema.safeParse({ headers: { Host: 'x' } }).success).toBe(false);
    expect(modelPatchSchema.parse({ visibility: 'beta' })).toEqual({ visibility: 'beta' });
    expect(providerKeyPatchSchema.parse({ weight: 2 })).toEqual({ weight: 2 });
    expect(modelPatchSchema.safeParse({ bogus: 1 }).success).toBe(false);
    expect(patchOf(z.object({ a: z.number().default(1).default(2) })).parse({})).toEqual({});
  });
});
