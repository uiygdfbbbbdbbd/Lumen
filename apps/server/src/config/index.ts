/**
 * Validated configuration loader. Reads env once, fails fast with a readable
 * list of every problem instead of crashing later with undefined values.
 */
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');
const csv = z.string().transform((s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PRODUCT_NAME: z.string().min(1).max(60).default('Lumen'),
    PUBLIC_URL: z.string().url().default('http://localhost:5173'),
    API_URL: z.string().url().default('http://localhost:3000'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool.default(false),
    CORS_ORIGINS: csv.default([]),

    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL').optional(),

    /** 32-byte key, base64. Multiple keys separated by commas: first is active, rest are for decryption only. */
    ENCRYPTION_KEYS: z.string().min(1, 'required: generate with `openssl rand -base64 32`'),
    /** Secret for HMAC of tokens/cookies. */
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),

    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SESSION_ROTATE_HOURS: z.coerce.number().min(0.01).max(24 * 30).default(24),
    COOKIE_SECURE: bool.optional(),
    COOKIE_DOMAIN: z.string().optional(),

    STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
    STORAGE_FS_ROOT: z.string().default('./.data/storage'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('lumen'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(true),

    EMAIL_TRANSPORT: z.enum(['smtp', 'memory', 'log']).default('log'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default('Lumen <no-reply@localhost>'),

    SIGNUP_MODE: z.enum(['open', 'closed', 'invite', 'allowlist']).default('open'),
    REQUIRE_EMAIL_VERIFICATION: bool.default(false),
    HIBP_CHECK: bool.default(false),
    CAPTCHA_PROVIDER: z.enum(['none', 'turnstile', 'hcaptcha']).default('none'),
    CAPTCHA_SECRET: z.string().optional(),
    ALLOW_PRIVATE_PROVIDER_URLS: bool.default(false),
    /** Let web/knowledge fetches reach private addresses. Development and tests only; metadata IPs stay blocked. */
    ALLOW_PRIVATE_FETCH: bool.default(false),
    /** clamd host for upload virus scanning (optional). */
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().int().default(3310),
    /** Run background job workers inside the API process (single-node). Set false when running apps/worker. */
    RUN_WORKERS: bool.default(true),
    /** Scales every rate limit. Keep 1 in production; raise for load/E2E test environments. */
    RATE_LIMIT_MULTIPLIER: z.coerce.number().min(1).max(1000).default(1),
    MAX_JSON_BODY_BYTES: z.coerce.number().int().default(2 * 1024 * 1024),

    OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
    OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
    OAUTH_GITHUB_CLIENT_ID: z.string().optional(),
    OAUTH_GITHUB_CLIENT_SECRET: z.string().optional(),
    WEBAUTHN_RP_ID: z.string().default('localhost'),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=s3' });
      }
    }
    if (env.EMAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'required when EMAIL_TRANSPORT=smtp' });
    }
    if (env.CAPTCHA_PROVIDER !== 'none' && !env.CAPTCHA_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['CAPTCHA_SECRET'], message: 'required when CAPTCHA_PROVIDER is set' });
    }
    if (env.NODE_ENV === 'production' && env.SESSION_SECRET.startsWith('dev-')) {
      ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'development secret used in production' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface Config extends Env {
  isProd: boolean;
  isTest: boolean;
  cookieSecure: boolean;
  encryptionKeys: Buffer[];
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function parseEncryptionKeys(raw: string): Buffer[] {
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k, i) => {
      const buf = Buffer.from(k, 'base64');
      if (buf.length !== 32) throw new ConfigError([`ENCRYPTION_KEYS[${i}]: must decode to exactly 32 bytes (got ${buf.length})`]);
      return buf;
    });
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const env = result.data;
  return {
    ...env,
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    cookieSecure: env.COOKIE_SECURE ?? env.PUBLIC_URL.startsWith('https://'),
    encryptionKeys: parseEncryptionKeys(env.ENCRYPTION_KEYS),
  };
}
