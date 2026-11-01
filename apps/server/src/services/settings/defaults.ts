import { z } from 'zod';
import { FEATURES } from '@lumen/shared';

export const settingSchemas = {
  branding: z.object({
    productName: z.string().min(1).max(60),
    tagline: z.string().max(200),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    logoLightKey: z.string().max(300).nullable(),
    logoDarkKey: z.string().max(300).nullable(),
    faviconKey: z.string().max(300).nullable(),
    loginCopy: z.string().max(1000),
    tosUrl: z.string().max(500),
    privacyUrl: z.string().max(500),
    supportEmail: z.string().max(254),
  }),
  signup: z.object({
    mode: z.enum(['open', 'closed', 'invite', 'allowlist']),
    allowlistDomains: z.array(z.string().max(253)).max(500),
    requireVerification: z.boolean(),
    blockDisposableEmails: z.boolean(),
    captcha: z.enum(['none', 'turnstile', 'hcaptcha']),
    captchaSiteKey: z.string().max(200),
    /** 0 disables the age gate. */
    minimumAge: z.union([z.literal(0), z.literal(13), z.literal(16), z.literal(18)]),
    maxSignupsPerIpPerDay: z.number().int().min(1).max(10_000),
  }),
  email: z.object({
    resendCooldownSeconds: z.number().int().min(10).max(3600),
    resendDailyCap: z.number().int().min(1).max(100),
    verifyTokenTtlHours: z.number().int().min(1).max(24 * 14),
    resetTokenTtlMinutes: z.number().int().min(5).max(24 * 60),
    magicLinkTtlMinutes: z.number().int().min(5).max(120),
  }),
  security: z.object({
    lockoutThreshold: z.number().int().min(3).max(50),
    lockoutBaseSeconds: z.number().int().min(10).max(3600),
    suspiciousLoginEmail: z.boolean(),
    magicLinkEnabled: z.boolean(),
    passkeysEnabled: z.boolean(),
    accountDeletionGraceDays: z.number().int().min(0).max(90),
  }),
  features: z.partialRecord(z.enum(FEATURES), z.boolean()),
  maintenance: z.object({ enabled: z.boolean(), readOnly: z.boolean(), message: z.string().max(1000) }),
  legal: z.object({ tosVersion: z.string().max(40), cookieConsent: z.boolean() }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;
export type AllSettings = { [K in SettingKey]: SettingValue<K> };

export const DEFAULT_SETTINGS: AllSettings = {
  branding: {
    productName: 'Lumen',
    tagline: 'Your free, open AI workspace',
    accentColor: '#6d5dfc',
    logoLightKey: null,
    logoDarkKey: null,
    faviconKey: null,
    loginCopy: 'Think, write and build with AI — free and open.',
    tosUrl: '/legal/terms',
    privacyUrl: '/legal/privacy',
    supportEmail: 'support@localhost',
  },
  signup: {
    mode: 'open',
    allowlistDomains: [],
    requireVerification: false,
    blockDisposableEmails: true,
    captcha: 'none',
    captchaSiteKey: '',
    minimumAge: 13,
    maxSignupsPerIpPerDay: 20,
  },
  email: {
    resendCooldownSeconds: 60,
    resendDailyCap: 5,
    verifyTokenTtlHours: 48,
    resetTokenTtlMinutes: 60,
    magicLinkTtlMinutes: 15,
  },
  security: {
    lockoutThreshold: 5,
    lockoutBaseSeconds: 60,
    suspiciousLoginEmail: true,
    magicLinkEnabled: false,
    passkeysEnabled: true,
    accountDeletionGraceDays: 14,
  },
  features: {},
  maintenance: { enabled: false, readOnly: false, message: '' },
  legal: { tosVersion: '2026-11-01', cookieConsent: false },
};
