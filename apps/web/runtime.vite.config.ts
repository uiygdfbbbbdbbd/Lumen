import { defineConfig } from 'vite';

/**
 * The artifact runtime is a classic (non-module) script: it is loaded by a sandboxed iframe with an opaque
 * origin, where module scripts would need CORS. Output goes to public/ so it is served as a static asset.
 */
export default defineConfig({
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'public/runtime',
    emptyOutDir: true,
    lib: { entry: 'runtime/main.ts', name: 'LumenArtifactRuntime', formats: ['iife'], fileName: () => 'artifact-runtime.js' },
    minify: true,
    sourcemap: false,
  },
});
