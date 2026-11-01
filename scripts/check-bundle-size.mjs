#!/usr/bin/env node
// Fails if the web app's initial JS (gzip) exceeds the budget. Keeps first paint fast on mid-range devices.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const BUDGET_KB = Number(process.env.BUNDLE_BUDGET_KB ?? 300);
const dir = 'apps/web/dist/assets';
const js = readdirSync(dir).filter((f) => f.endsWith('.js'));
let total = 0;
for (const f of js) {
  const size = gzipSync(readFileSync(path.join(dir, f))).length;
  total += size;
  console.warn(`${f.padEnd(40)} ${(size / 1024).toFixed(1)} KB gz (${(statSync(path.join(dir, f)).size / 1024).toFixed(0)} KB raw)`);
}
console.warn(`Total JS: ${(total / 1024).toFixed(1)} KB gz (budget ${BUDGET_KB} KB)`);
if (total / 1024 > BUDGET_KB) process.exit(1);
