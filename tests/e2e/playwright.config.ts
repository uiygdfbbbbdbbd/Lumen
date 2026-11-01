import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3100;
const WEB_PORT = 5180;
const DB = process.env.E2E_DB ?? 'lumen_e2e';
const serverEnv = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  PUBLIC_URL: `http://localhost:${WEB_PORT}`,
  API_URL: `http://localhost:${WEB_PORT}`,
  DATABASE_URL: `postgres://postgres:postgres@localhost:5432/${DB}`,
  ENCRYPTION_KEYS: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
  SESSION_SECRET: 'e2e-session-secret-that-is-long-enough-123',
  EMAIL_TRANSPORT: 'smtp',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  STORAGE_FS_ROOT: '/tmp/lumen-e2e-storage',
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Sandboxed CI images may ship a preinstalled Chromium at a fixed path.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.E2E_ALL_BROWSERS
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'mobile', use: { ...devices['Pixel 7'] } },
        ]
      : []),
  ],
  webServer: [
    { command: 'node support/mail-sink.mjs', url: 'http://127.0.0.1:8025/api/v1/messages', reuseExistingServer: true },
    {
      command: 'bash support/start-api.sh',
      url: `http://localhost:${API_PORT}/api/health`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @lumen/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
