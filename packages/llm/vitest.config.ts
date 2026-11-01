import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/mock/cli.ts'], thresholds: { lines: 85 } } },
});
