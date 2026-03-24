#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const targets = ['packages'];
const compatImport = '@xqoder/agent/compat';

const scan = spawnSync('rg', [
  '--no-heading',
  '--line-number',
  '--color',
  'never',
  '--fixed-strings',
  '--glob',
  '**/*.ts',
  '--glob',
  '!**/*.test.ts',
  '--glob',
  '!**/*.spec.ts',
  compatImport,
  ...targets,
], {
  cwd: repoRoot,
  encoding: 'utf-8',
});

if (scan.status !== 0 && scan.status !== 1) {
  process.stderr.write(scan.stderr || scan.stdout || 'Failed to scan agent compat imports.\n');
  process.exit(scan.status ?? 1);
}

const output = scan.stdout.trim();
if (!output) {
  process.stdout.write('No direct @xqoder/agent/compat imports found in non-test package source modules.\n');
  process.exit(0);
}

const matches = output
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

process.stderr.write('\nFound disallowed @xqoder/agent/compat imports:\n');
for (const line of matches) {
  process.stderr.write(`- ${line}\n`);
}
process.stderr.write('\nUse runtime/snapshot APIs instead of compat imports in these modules.\n');
process.exit(1);
