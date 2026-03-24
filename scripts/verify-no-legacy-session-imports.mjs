#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const targets = [
  'packages/cli/src',
  'packages/runtime/src',
  'packages/storage-sqlite/src',
];
const pattern = '\\b(?:LegacyAgentSessionStore|LegacyAgentSessionCompatibilityStore|createLegacyAgentSessionStoreAdapter)\\b';

const scan = spawnSync('rg', [
  '--no-heading',
  '--line-number',
  '--color',
  'never',
  '--glob',
  '!**/*.test.ts',
  '--glob',
  '!**/*.spec.ts',
  pattern,
  ...targets,
], {
  cwd: repoRoot,
  encoding: 'utf-8',
});

if (scan.status !== 0 && scan.status !== 1) {
  process.stderr.write(scan.stderr || scan.stdout || 'Failed to scan legacy session imports.\n');
  process.exit(scan.status ?? 1);
}

const output = scan.stdout.trim();
if (!output) {
  process.stdout.write('No legacy session type/adapter imports found outside compat modules.\n');
  process.exit(0);
}

const matches = output
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

process.stderr.write('\nFound disallowed legacy session imports/usages:\n');
for (const line of matches) {
  process.stderr.write(`- ${line}\n`);
}
process.stderr.write('\nUse runtime/snapshot interfaces in these modules.\n');
process.exit(1);
