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
  rag: z.object({
    /** Model (id or alias) used for embeddings. Null = lexical search only. */
    embeddingModelId: z.string().max(200).nullable(),
    chunkTokens: z.number().int().min(100).max(4000),
    overlapTokens: z.number().int().min(0).max(1000),
    /** Attachments whose total extracted text is below this many tokens are inlined in full. */
    inlineTokenLimit: z.number().int().min(0).max(200_000),
    topK: z.number().int().min(1).max(50),
    stripImageMetadata: z.boolean(),
    maxArchiveEntries: z.number().int().min(1).max(100_000),
    maxArchiveBytes: z.number().int().min(1024).max(10 * 1024 ** 3),
  }),
  webSearch: z.object({
    provider: z.enum(['none', 'searxng', 'brave', 'tavily', 'serper', 'bing']),
    /** SearXNG instance URL (e.g. http://searxng:8080). */
    baseUrl: z.string().max(500),
    /** Encrypted with the platform key; set via PUT /api/admin/web-search/key, never returned. */
    apiKeyEncrypted: z.string().max(4000).nullable(),
    maxResults: z.number().int().min(1).max(20),
    safeSearch: z.boolean(),
    respectRobots: z.boolean(),
    cacheTtlMinutes: z.number().int().min(0).max(1440),
    fetchMaxChars: z.number().int().min(1000).max(200_000),
    /** Domains never shown or fetched (source quality filter). */
    blockedDomains: z.array(z.string().max(253)).max(1000),
  }),
  tools: z.object({
    /** Open-Meteo weather (no key needed). */
    weather: z.boolean(),
    /** ECB reference rates via frankfurter.app. */
    currency: z.boolean(),
  }),
  memory: z.object({
    /** Tokens of memories injected into each turn. */
    tokenBudget: z.number().int().min(0).max(8000),
    maxPerTurn: z.number().int().min(0).max(100),
    maxPerUser: z.number().int().min(10).max(10_000),
    /** Queue a consolidation after this many new/changed memories. */
    consolidateAfterWrites: z.number().int().min(1).max(1000),
  }),
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
  rag: {
    embeddingModelId: null,
    chunkTokens: 500,
    overlapTokens: 80,
    inlineTokenLimit: 8000,
    topK: 8,
    stripImageMetadata: true,
    maxArchiveEntries: 2000,
    maxArchiveBytes: 500 * 1024 * 1024,
  },
  webSearch: { provider: 'none', baseUrl: '', apiKeyEncrypted: null, maxResults: 6, safeSearch: true, respectRobots: true, cacheTtlMinutes: 60, fetchMaxChars: 20_000, blockedDomains: [] },
  tools: { weather: true, currency: true },
  memory: { tokenBudget: 800, maxPerTurn: 15, maxPerUser: 1000, consolidateAfterWrites: 15 },
};
