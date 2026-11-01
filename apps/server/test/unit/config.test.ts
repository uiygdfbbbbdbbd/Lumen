import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseEncryptionKeys } from '../../src/config/index.js';

const key = Buffer.alloc(32, 1).toString('base64');
const base = { DATABASE_URL: 'postgres://u:p@h/db', ENCRYPTION_KEYS: key, SESSION_SECRET: 'x'.repeat(32) };

describe('config', () => {
  it('loads with defaults', () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(3000);
    expect(c.PRODUCT_NAME).toBe('Lumen');
    expect(c.encryptionKeys).toHaveLength(1);
    expect(c.cookieSecure).toBe(false);
    expect(c.isProd).toBe(false);
  });
  it('lists every problem at once', () => {
    try {
      loadConfig({ PORT: 'abc' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as Error).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('ENCRYPTION_KEYS');
      expect(msg).toContain('SESSION_SECRET');
      expect(msg).toContain('PORT');
    }
  });
  it('requires S3 settings with s3 driver', () => {
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_ENDPOINT/);
  });
  it('requires SMTP host for smtp transport', () => {
    expect(() => loadConfig({ ...base, EMAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_HOST/);
  });
  it('requires captcha secret', () => {
    expect(() => loadConfig({ ...base, CAPTCHA_PROVIDER: 'turnstile' })).toThrow(/CAPTCHA_SECRET/);
  });
  it('rejects dev secrets in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'dev-' + 'x'.repeat(32) })).toThrow(/production/);
  });
  it('parses booleans and lists', () => {
    const c = loadConfig({ ...base, TRUST_PROXY: 'yes', CORS_ORIGINS: 'http://a, http://b,', PUBLIC_URL: 'https://x.io' });
    expect(c.TRUST_PROXY).toBe(true);
    expect(c.CORS_ORIGINS).toEqual(['http://a', 'http://b']);
    expect(c.cookieSecure).toBe(true);
  });
  it('treats empty strings as unset', () => {
    expect(loadConfig({ ...base, REDIS_URL: '' }).REDIS_URL).toBeUndefined();
  });
  it('validates encryption key length', () => {
    expect(() => parseEncryptionKeys(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseEncryptionKeys(`${key}, ${Buffer.alloc(32, 2).toString('base64')}`)).toHaveLength(2);
  });
});
