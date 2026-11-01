import { defineConfig } from 'vitest/config';

const conditions = ['@lumen/source', 'node', 'development|production'];
const shared = { resolve: { conditions }, ssr: { resolve: { conditions } } };

export default defineConfig({
  ...shared,
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/lib/**', 'src/http/**'],
      thresholds: { lines: 85 },
    },
    projects: [
      { ...shared, test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      {
        ...shared,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/helpers/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        ...shared,
        test: {
          name: 'security',
          include: ['test/security/**/*.test.ts'],
          globalSetup: ['test/helpers/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
