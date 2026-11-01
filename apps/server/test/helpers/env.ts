/** Base admin connection for test databases. Override with TEST_DATABASE_URL (e.g. a Testcontainers URL in CI). */
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
export const TEMPLATE_DB = 'lumen_it_template';

export function urlFor(db: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PUBLIC_URL: 'http://localhost:5173',
  API_URL: 'http://localhost:3000',
  ENCRYPTION_KEYS: Buffer.alloc(32, 7).toString('base64'),
  SESSION_SECRET: 'test-session-secret-that-is-at-least-32-chars',
  EMAIL_TRANSPORT: 'memory',
  STORAGE_DRIVER: 'fs',
} as const;
