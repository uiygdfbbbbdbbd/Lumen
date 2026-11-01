#!/usr/bin/env node
// Lightweight secret scanner for tracked files (complements gitleaks in CI). Exits 1 on findings.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['OpenAI-style key', /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe live key', /\bsk_live_[0-9a-zA-Z]{24,}\b/],
];
const ALLOW = [/test\//, /\.test\.tsx?$/, /fixtures?\//, /scan-secrets\.mjs$/, /pnpm-lock\.yaml$/];

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const findings = [];
for (const f of files) {
  if (ALLOW.some((a) => a.test(f))) continue;
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue;
  for (const [name, re] of PATTERNS) if (re.test(text)) findings.push(`${f}: ${name}`);
}
if (findings.length) {
  console.error(`Possible secrets found:\n${findings.join('\n')}`);
  process.exit(1);
}
console.warn(`Secret scan clean (${files.length} files).`);
