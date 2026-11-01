import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/** The sandboxed code runner has an opaque origin, so the Pyodide files it loads need CORS headers. */
const runnerCors = {
  name: 'lumen-runner-cors',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/pyodide/')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [
    { ...runnerCors },
    { ...runnerCors, name: 'lumen-runner-cors-preview', configurePreviewServer: runnerCors.configureServer, configureServer: undefined },
    react(),
    tailwind(),
    // Installable PWA: precaches the app shell; API calls always go to the network.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false,
      workbox: {
        // Precache only the shell + chat route; diagram/math chunks are cached the first time they're used.
        globPatterns: ['index.html', 'theme-boot.js', '*.svg', 'assets/{index,react,tanstack,radix,rolldown-runtime,ChatPage,TemporaryChat}-*.{js,css}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/v1\//],
        runtimeCaching: [
          { urlPattern: /\/api\/(avatars|assets)\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'lumen-images', expiration: { maxEntries: 300 } } },
          { urlPattern: /\/assets\/.*\.(js|css|woff2?|ttf)$/, handler: 'CacheFirst', options: { cacheName: 'lumen-chunks', expiration: { maxEntries: 400 } } },
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
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
    coverage: { provider: 'v8', include: ['src/lib/**', 'src/features/shell/starters.ts', 'src/features/chat/{tree,store,stream}.ts', 'src/features/artifacts/{files,panel}.ts', 'src/features/artifacts/renderers/{chart-layout,latex}.ts'], exclude: ['src/lib/auth.ts', 'src/lib/pwa.ts'], thresholds: { lines: 80 } },
  },
});
