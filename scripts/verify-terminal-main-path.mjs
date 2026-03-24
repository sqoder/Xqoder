#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const checks = [
  {
    label: 'TUI visual gate',
    command: 'pnpm',
    args: ['verify:tui'],
  },
  {
    label: 'Terminal theme slice gate',
    command: 'node',
    args: ['./scripts/verify-terminal-theme-slice.mjs'],
  },
];

for (const check of checks) {
  process.stdout.write(`\n=== ${check.label}: ${check.command} ${check.args.join(' ')} ===\n`);
  const run = spawnSync(check.command, check.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    env: process.env,
  });
  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }
}

process.stdout.write('\nTerminal main-path gate passed.\n');
