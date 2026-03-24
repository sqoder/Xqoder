#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const targetRoot = 'packages/cli/src';
const pattern = '\\.(?:findLatestSession|createEmptySession|saveSessionFromKernel|saveSession)(?:\\?\\.)?\\(';

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
  targetRoot,
], {
  cwd: repoRoot,
  encoding: 'utf-8',
});

if (scan.status !== 0 && scan.status !== 1) {
  process.stderr.write(scan.stderr || scan.stdout || 'Failed to scan legacy session API usages.\n');
  process.exit(scan.status ?? 1);
}

const output = scan.stdout.trim();
if (!output) {
  process.stdout.write('No legacy session compatibility API usages found in non-test CLI sources.\n');
  process.exit(0);
}

const matches = output
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

process.stderr.write('\nFound deprecated session compatibility API usages:\n');
for (const line of matches) {
  process.stderr.write(`- ${line}\n`);
}
process.stderr.write('\nMigrate these call sites to runtime/session snapshot APIs before release.\n');
process.exit(1);
