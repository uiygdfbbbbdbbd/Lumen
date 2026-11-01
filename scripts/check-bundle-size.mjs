#!/usr/bin/env node
// Budget for the JS the browser must download before first paint: the entry script plus every
// modulepreload in index.html. Lazy route chunks (chat, mermaid, katex...) are reported separately.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const INITIAL_BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 300);
const LAZY_CHUNK_BUDGET_KB = Number(process.env.LAZY_CHUNK_BUDGET_KB ?? 260);
const dist = 'apps/web/dist';
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const initial = new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]));
const gz = (f) => gzipSync(readFileSync(path.join(dist, f))).length / 1024;

let initialTotal = 0;
for (const f of initial) {
  const kb = gz(f);
  initialTotal += kb;
  console.warn(`initial  ${f.padEnd(48)} ${kb.toFixed(1)} KB gz`);
}
// Route chunks are named after their component (PascalCase). Other lazy chunks (mermaid diagram types,
// the ELK layout engine...) load only when a feature needs them and are reported, not budgeted.
let worstLazy = { f: '', kb: 0 };
let onDemand = 0;
for (const f of readdirSync(path.join(dist, 'assets')).filter((x) => x.endsWith('.js')).map((x) => `assets/${x}`)) {
  if (initial.has(f)) continue;
  const kb = gz(f);
  if (/^assets\/[A-Z]/.test(f)) {
    if (kb > worstLazy.kb) worstLazy = { f, kb };
  } else onDemand += kb;
}
console.warn(`On-demand feature chunks (not budgeted): ${onDemand.toFixed(0)} KB gz total`);
console.warn(`Initial JS: ${initialTotal.toFixed(1)} KB gz (budget ${INITIAL_BUDGET_KB} KB)`);
console.warn(`Largest route chunk: ${worstLazy.f} ${worstLazy.kb.toFixed(1)} KB gz (budget ${LAZY_CHUNK_BUDGET_KB} KB)`);
if (initialTotal > INITIAL_BUDGET_KB || worstLazy.kb > LAZY_CHUNK_BUDGET_KB) process.exit(1);
