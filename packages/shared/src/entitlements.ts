/**
 * Entitlements: the single place that decides what a user may do and how much.
 * Consumed by the server (enforced) and the client (UI hints only).
 */
import { z } from 'zod';
import type { Role } from './policy.js';

export const FEATURES = [
  'chat',
  'codeMode',
  'apiKeys',
  'scheduledTasks',
  'themePublishing',
  'projectSharing',
  'publicShareLinks',
  'mcpCustomServers',
  'connectors',
  'imageGeneration',
  'webSearch',
  'deepResearch',
  'fileUpload',
  'memory',
  'voiceMode',
  'workshopPublishing',
  'clientCodeInterpreter',
] as const;
export type Feature = (typeof FEATURES)[number];

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export const tierLimitsSchema = z.object({
  messagesPerDay: z.number().int().min(0),
  tokensPerDay: z.number().int().min(0),
  tokensPerMinute: z.number().int().min(0),
  concurrentStreams: z.number().int().min(0),
  maxUploadBytes: z.number().int().min(0),
  storageBytes: z.number().int().min(0),
  sandboxHoursPerDay: z.number().min(0),
  sandboxStorageBytes: z.number().int().min(0),
  scheduledTasks: z.number().int().min(0),
  mcpServers: z.number().int().min(0),
  imageGenPerDay: z.number().int().min(0),
  apiKeys: z.number().int().min(0),
});
export type TierLimits = z.infer<typeof tierLimitsSchema>;
export type LimitKey = keyof TierLimits;

export const tierDefinitionSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(100),
  features: z.partialRecord(z.enum(FEATURES), z.boolean()),
  limits: tierLimitsSchema,
});
export type TierDefinition = z.infer<typeof tierDefinitionSchema>;

/** Hard ceiling for sandbox storage per user, regardless of tier or override. */
export const SANDBOX_STORAGE_HARD_CAP_BYTES = 15 * GB;

const allFeatures = (value: boolean): Record<Feature, boolean> =>
  Object.fromEntries(FEATURES.map((f) => [f, value])) as Record<Feature, boolean>;

export const DEFAULT_TIERS: Record<'unverified' | 'verified' | 'trusted', TierDefinition> = {
  unverified: {
    id: 'unverified',
    name: 'Unverified',
    features: {
      ...allFeatures(true),
      codeMode: false,
      apiKeys: false,
      themePublishing: false,
      projectSharing: false,
      publicShareLinks: false,
      mcpCustomServers: false,
      connectors: false,
      workshopPublishing: false,
      deepResearch: false,
    },
    limits: {
      messagesPerDay: 50,
      tokensPerDay: 100_000,
      tokensPerMinute: 20_000,
      concurrentStreams: 1,
      maxUploadBytes: 10 * MB,
      storageBytes: 200 * MB,
      sandboxHoursPerDay: 0,
      sandboxStorageBytes: 0,
      scheduledTasks: 2,
      mcpServers: 0,
      imageGenPerDay: 5,
      apiKeys: 0,
    },
  },
  verified: {
    id: 'verified',
    name: 'Verified',
    features: allFeatures(true),
    limits: {
      messagesPerDay: 500,
      tokensPerDay: 2_000_000,
      tokensPerMinute: 100_000,
      concurrentStreams: 3,
      maxUploadBytes: 100 * MB,
      storageBytes: 5 * GB,
      sandboxHoursPerDay: 4,
      sandboxStorageBytes: 15 * GB,
      scheduledTasks: 25,
      mcpServers: 20,
      imageGenPerDay: 50,
      apiKeys: 10,
    },
  },
  trusted: {
    id: 'trusted',
    name: 'Trusted',
    features: allFeatures(true),
    limits: {
      messagesPerDay: 2_000,
      tokensPerDay: 10_000_000,
      tokensPerMinute: 400_000,
      concurrentStreams: 6,
      maxUploadBytes: 500 * MB,
      storageBytes: 20 * GB,
      sandboxHoursPerDay: 12,
      sandboxStorageBytes: 15 * GB,
      scheduledTasks: 100,
      mcpServers: 50,
      imageGenPerDay: 200,
      apiKeys: 25,
    },
  },
};

export type LockReason = 'EMAIL_UNVERIFIED' | 'TIER' | 'ADMIN_DISABLED' | 'USER_DISABLED' | 'SUSPENDED';

export interface FeatureState {
  allowed: boolean;
  reason?: LockReason;
}

export interface EntitlementSubject {
  role: Role;
  emailVerified: boolean;
  status: 'active' | 'suspended' | 'banned' | 'pending_deletion';
  /** Tier explicitly assigned by an admin; applies once verified. */
  tierId?: string | null;
  overrides?: {
    features?: Partial<Record<Feature, boolean>>;
    limits?: Partial<TierLimits>;
  } | null;
}

export interface EntitlementContext {
  tiers: Record<string, TierDefinition>;
  /** Platform-wide kill switches. A feature set to false here is off for everyone. */
  globalFeatures?: Partial<Record<Feature, boolean>>;
}

export interface Entitlements {
  tierId: string;
  features: Record<Feature, FeatureState>;
  limits: TierLimits;
}

export function resolveTierId(subject: EntitlementSubject, tiers: Record<string, TierDefinition>): string {
  // Staff accounts are never restricted by the unverified tier: the first super admin
  // often has no working SMTP yet and must be able to configure the instance.
  const isStaff = subject.role !== 'user';
  if (!subject.emailVerified && !isStaff) return 'unverified';
  if (subject.tierId && tiers[subject.tierId]) return subject.tierId;
  return 'verified';
}

export function computeEntitlements(subject: EntitlementSubject, ctx: EntitlementContext): Entitlements {
  const tierId = resolveTierId(subject, ctx.tiers);
  const tier =
    ctx.tiers[tierId] ?? DEFAULT_TIERS[tierId as keyof typeof DEFAULT_TIERS] ?? DEFAULT_TIERS.verified;
  const unverifiedTier = ctx.tiers.unverified ?? DEFAULT_TIERS.unverified;
  const blocked = subject.status !== 'active';

  const features = {} as Record<Feature, FeatureState>;
  for (const feature of FEATURES) {
    let state: FeatureState;
    if (blocked) {
      state = { allowed: false, reason: 'SUSPENDED' };
    } else if (ctx.globalFeatures?.[feature] === false) {
      state = { allowed: false, reason: 'ADMIN_DISABLED' };
    } else if (subject.overrides?.features?.[feature] === false) {
      state = { allowed: false, reason: 'USER_DISABLED' };
    } else if (subject.overrides?.features?.[feature] === true) {
      state = { allowed: true };
    } else if (tier.features[feature] !== false) {
      state = { allowed: true };
    } else {
      // Locked only because the account is unverified, if a verified account would get it.
      const lockedByVerification = tierId === 'unverified' && unverifiedTier.features[feature] === false;
      state = { allowed: false, reason: lockedByVerification ? 'EMAIL_UNVERIFIED' : 'TIER' };
    }
    features[feature] = state;
  }

  const limits: TierLimits = { ...tier.limits, ...(subject.overrides?.limits ?? {}) };
  limits.sandboxStorageBytes = Math.min(limits.sandboxStorageBytes, SANDBOX_STORAGE_HARD_CAP_BYTES);
  if (!features.codeMode.allowed) {
    limits.sandboxHoursPerDay = 0;
  }
  return { tierId, features, limits };
}

export function lockMessage(reason: LockReason): string {
  switch (reason) {
    case 'EMAIL_UNVERIFIED':
      return 'Verify your email to unlock this feature.';
    case 'TIER':
      return 'This feature is not included in your plan.';
    case 'ADMIN_DISABLED':
      return 'This feature is disabled on this instance.';
    case 'USER_DISABLED':
      return 'This feature has been disabled for your account.';
    case 'SUSPENDED':
      return 'Your account is suspended.';
  }
}

/** Remaining allowance for a numeric limit; never negative. */
export function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}

/** Storage warning level for meters: thresholds at 80/95/100%. */
export function storageLevel(usedBytes: number, limitBytes: number): 'ok' | 'warn' | 'critical' | 'full' {
  if (limitBytes <= 0) return usedBytes > 0 ? 'full' : 'ok';
  const ratio = usedBytes / limitBytes;
  if (ratio >= 1) return 'full';
  if (ratio >= 0.95) return 'critical';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}

/** Whether writing `incomingBytes` more would exceed `limitBytes`. */
export function wouldExceed(usedBytes: number, incomingBytes: number, limitBytes: number): boolean {
  return usedBytes + incomingBytes > limitBytes;
}
