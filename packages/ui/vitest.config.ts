import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['@lumen/source', 'browser', 'development|production'] },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    coverage: { provider: 'v8', include: ['src/**'], thresholds: { lines: 85 } },
  },
});
