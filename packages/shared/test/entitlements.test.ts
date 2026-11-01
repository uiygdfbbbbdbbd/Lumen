import { describe, expect, it } from 'vitest';
import {
  computeEntitlements,
  DEFAULT_TIERS,
  FEATURES,
  GB,
  lockMessage,
  MB,
  remaining,
  resolveTierId,
  SANDBOX_STORAGE_HARD_CAP_BYTES,
  storageLevel,
  wouldExceed,
  type EntitlementSubject,
  type Feature,
  type LockReason,
} from '../src/index.js';

const ctx = { tiers: { ...DEFAULT_TIERS } };
const base: EntitlementSubject = { role: 'user', emailVerified: true, status: 'active' };

const UNVERIFIED_LOCKED: Feature[] = [
  'codeMode',
  'apiKeys',
  'themePublishing',
  'projectSharing',
  'publicShareLinks',
  'mcpCustomServers',
  'connectors',
  'workshopPublishing',
  'deepResearch',
];

describe('resolveTierId', () => {
  it('puts unverified users on the unverified tier', () => {
    expect(resolveTierId({ ...base, emailVerified: false }, ctx.tiers)).toBe('unverified');
  });
  it('ignores assigned tier while unverified', () => {
    expect(resolveTierId({ ...base, emailVerified: false, tierId: 'trusted' }, ctx.tiers)).toBe('unverified');
  });
  it('defaults verified users to verified', () => {
    expect(resolveTierId(base, ctx.tiers)).toBe('verified');
  });
  it('uses assigned tier when it exists', () => {
    expect(resolveTierId({ ...base, tierId: 'trusted' }, ctx.tiers)).toBe('trusted');
  });
  it('falls back when assigned tier was deleted', () => {
    expect(resolveTierId({ ...base, tierId: 'gone' }, ctx.tiers)).toBe('verified');
  });
  it.each(['moderator', 'admin', 'super_admin'] as const)('does not restrict unverified %s', (role) => {
    expect(resolveTierId({ ...base, role, emailVerified: false }, ctx.tiers)).toBe('verified');
  });
});

describe('computeEntitlements: every tier x feature', () => {
  for (const tierId of ['unverified', 'verified', 'trusted'] as const) {
    const subject: EntitlementSubject =
      tierId === 'unverified' ? { ...base, emailVerified: false } : { ...base, tierId };
    const e = computeEntitlements(subject, ctx);
    for (const feature of FEATURES) {
      it(`${tierId}: ${feature}`, () => {
        const expected = tierId === 'unverified' ? !UNVERIFIED_LOCKED.includes(feature) : true;
        expect(e.features[feature].allowed).toBe(expected);
        if (!expected) expect(e.features[feature].reason).toBe('EMAIL_UNVERIFIED');
      });
    }
  }

  it('unverified limits match the spec defaults', () => {
    const e = computeEntitlements({ ...base, emailVerified: false }, ctx);
    expect(e.tierId).toBe('unverified');
    expect(e.limits.scheduledTasks).toBe(2);
    expect(e.limits.maxUploadBytes).toBe(10 * MB);
    expect(e.limits.storageBytes).toBe(200 * MB);
    expect(e.limits.sandboxHoursPerDay).toBe(0);
    expect(e.limits.apiKeys).toBe(0);
    expect(e.limits.mcpServers).toBe(0);
  });

  it('verified users get the 15 GB sandbox cap', () => {
    expect(computeEntitlements(base, ctx).limits.sandboxStorageBytes).toBe(15 * GB);
  });
});

describe('computeEntitlements: modifiers', () => {
  it('suspended users lose every feature', () => {
    const e = computeEntitlements({ ...base, status: 'suspended' }, ctx);
    for (const f of FEATURES) expect(e.features[f]).toEqual({ allowed: false, reason: 'SUSPENDED' });
  });
  it.each(['banned', 'pending_deletion'] as const)('%s users lose every feature', (status) => {
    const e = computeEntitlements({ ...base, status }, ctx);
    expect(e.features.chat.allowed).toBe(false);
  });
  it('global kill switch overrides tier and user overrides', () => {
    const e = computeEntitlements(
      { ...base, overrides: { features: { codeMode: true } } },
      { ...ctx, globalFeatures: { codeMode: false } },
    );
    expect(e.features.codeMode).toEqual({ allowed: false, reason: 'ADMIN_DISABLED' });
    expect(e.limits.sandboxHoursPerDay).toBe(0);
  });
  it('per-user disable override', () => {
    const e = computeEntitlements({ ...base, overrides: { features: { apiKeys: false } } }, ctx);
    expect(e.features.apiKeys).toEqual({ allowed: false, reason: 'USER_DISABLED' });
  });
  it('per-user enable override grants a feature the tier lacks', () => {
    const e = computeEntitlements(
      { ...base, emailVerified: false, overrides: { features: { codeMode: true } } },
      ctx,
    );
    expect(e.features.codeMode.allowed).toBe(true);
  });
  it('custom tier lacking a feature reports TIER', () => {
    const custom = { ...DEFAULT_TIERS.verified, id: 'basic', name: 'Basic', features: { ...DEFAULT_TIERS.verified.features, voiceMode: false } };
    const e = computeEntitlements({ ...base, tierId: 'basic' }, { tiers: { ...ctx.tiers, basic: custom } });
    expect(e.features.voiceMode).toEqual({ allowed: false, reason: 'TIER' });
  });
  it('limit overrides merge over tier limits', () => {
    const e = computeEntitlements({ ...base, overrides: { limits: { messagesPerDay: 9 } } }, ctx);
    expect(e.limits.messagesPerDay).toBe(9);
    expect(e.limits.tokensPerDay).toBe(DEFAULT_TIERS.verified.limits.tokensPerDay);
  });
  it('sandbox storage override can never exceed the 15 GB hard cap', () => {
    const e = computeEntitlements({ ...base, overrides: { limits: { sandboxStorageBytes: 100 * GB } } }, ctx);
    expect(e.limits.sandboxStorageBytes).toBe(SANDBOX_STORAGE_HARD_CAP_BYTES);
  });
  it('falls back to built-in tiers if context lacks them', () => {
    const e = computeEntitlements({ ...base, emailVerified: false }, { tiers: {} });
    expect(e.tierId).toBe('unverified');
    expect(e.features.codeMode.reason).toBe('EMAIL_UNVERIFIED');
  });
});

describe('helpers', () => {
  it.each<LockReason>(['EMAIL_UNVERIFIED', 'TIER', 'ADMIN_DISABLED', 'USER_DISABLED', 'SUSPENDED'])(
    'lockMessage(%s) is human readable',
    (r) => expect(lockMessage(r).length).toBeGreaterThan(10),
  );
  it('remaining never negative', () => {
    expect(remaining(10, 3)).toBe(7);
    expect(remaining(10, 30)).toBe(0);
  });
  it('storageLevel thresholds at 80/95/100', () => {
    expect(storageLevel(79, 100)).toBe('ok');
    expect(storageLevel(80, 100)).toBe('warn');
    expect(storageLevel(95, 100)).toBe('critical');
    expect(storageLevel(100, 100)).toBe('full');
    expect(storageLevel(0, 0)).toBe('ok');
    expect(storageLevel(1, 0)).toBe('full');
  });
  it('wouldExceed handles exact boundary of 15 GB', () => {
    const cap = 15 * GB;
    expect(wouldExceed(cap - 10, 10, cap)).toBe(false);
    expect(wouldExceed(cap - 10, 11, cap)).toBe(true);
  });
});
