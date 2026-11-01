import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['@lumen/source'] },
  test: { include: ['test/**/*.test.ts?(x)'], coverage: { provider: 'v8', include: ['src/**'], thresholds: { lines: 85 } } },
});
