import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { conditions: ['@lumen/source', 'module', 'browser', 'development|production'] },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:3000', changeOrigin: false, ws: true } },
  },
  preview: { port: 4173, proxy: { '/api': { target: process.env.API_PROXY ?? 'http://localhost:3000', ws: true } } },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('node_modules/@tanstack/')) return 'tanstack';
          if (id.includes('node_modules/radix-ui') || id.includes('node_modules/@radix-ui/')) return 'radix';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    coverage: { provider: 'v8', include: ['src/lib/**', 'src/features/shell/starters.ts'], exclude: ['src/lib/auth.ts'], thresholds: { lines: 80 } },
  },
});
