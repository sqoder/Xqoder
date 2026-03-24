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
const deepPatterns = [
  '@xqoder/agent/src/session/legacy-store-adapter',
  '@xqoder/agent/session/legacy-store-adapter',
  '@xqoder/agent/dist/session/legacy-store-adapter',
  'session/legacy-store-adapter',
];

const scan = spawnSync('rg', [
  '--no-heading',
  '--line-number',
  '--color',
  'never',
  '--fixed-strings',
  '--glob',
  '!**/*.test.ts',
  '--glob',
  '!**/*.spec.ts',
  ...deepPatterns.flatMap((pattern) => ['-e', pattern]),
  ...targets,
], {
  cwd: repoRoot,
  encoding: 'utf-8',
});

if (scan.status !== 0 && scan.status !== 1) {
  process.stderr.write(scan.stderr || scan.stdout || 'Failed to scan legacy session deep imports.\n');
  process.exit(scan.status ?? 1);
}

const output = scan.stdout.trim();
if (!output) {
  process.stdout.write('No deep legacy session adapter imports found in non-test runtime modules.\n');
  process.exit(0);
}

const matches = output
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

process.stderr.write('\nFound disallowed deep imports for legacy session adapter:\n');
for (const line of matches) {
  process.stderr.write(`- ${line}\n`);
}
process.stderr.write('\nImport compat APIs only via @xqoder/agent/compat.\n');
process.exit(1);
