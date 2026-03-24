#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const targetRoots = [
  'packages/agent/src',
  'packages/runtime/src',
  'packages/cli/src',
];
const pattern = '(?:\\.getSession(?:\\?\\.)?|\\bgetSession\\??|\\.loadSession(?:\\?\\.)?|\\bloadSession\\??)\\(';
const allowlist = [];

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
  ...targetRoots,
], {
  cwd: repoRoot,
  encoding: 'utf-8',
});

if (scan.status !== 0 && scan.status !== 1) {
  process.stderr.write(scan.stderr || scan.stdout || 'Failed to scan getSession usages/declarations.\n');
  process.exit(scan.status ?? 1);
}

const output = scan.stdout.trim();
if (!output) {
  process.stdout.write('No legacy getSession()/loadSession() interfaces found in non-test agent/runtime/cli sources.\n');
  process.exit(0);
}

const matches = output
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => {
    const firstColon = line.indexOf(':');
    const secondColon = firstColon >= 0 ? line.indexOf(':', firstColon + 1) : -1;
    if (firstColon < 0 || secondColon < 0) {
      return {
        path: 'unknown',
        line: '0',
        text: line,
      };
    }
    return {
      path: line.slice(0, firstColon),
      line: line.slice(firstColon + 1, secondColon),
      text: line.slice(secondColon + 1),
    };
  });

const unapproved = matches.filter((match) => {
  return !allowlist.some((allowed) => (
    allowed.path === match.path
    && match.text.includes(allowed.text)
  ));
});

if (unapproved.length > 0) {
  process.stderr.write('\nFound non-allowlisted getSession()/loadSession() usages/declarations:\n');
  for (const match of unapproved) {
    process.stderr.write(`- ${match.path}:${match.line}: ${match.text}\n`);
  }
  process.stderr.write('\nMigrate these entries to snapshot/runtime APIs before release.\n');
  process.exit(1);
}

process.stdout.write(
  `Legacy session boundary check passed (${matches.length} allowlisted transitional call(s)).\n`,
);
