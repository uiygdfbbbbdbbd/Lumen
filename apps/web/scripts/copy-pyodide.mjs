// Copies the Pyodide runtime into public/ so the code runner works offline and without a CDN.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const src = path.dirname(require.resolve('pyodide/package.json'));
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pyodide');
mkdirSync(out, { recursive: true });
for (const f of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) copyFileSync(path.join(src, f), path.join(out, f));
console.log(`pyodide copied to ${out}`);
