import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['@lumen/source'] },
  test: {
    include: ['test/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/**'], thresholds: { lines: 85, functions: 85, branches: 80 } },
  },
});
