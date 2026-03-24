#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const checks = [
  {
    label: 'Contract dependency build',
    command: 'pnpm',
    args: ['--filter', '@xqoder/storage-sqlite...', 'build'],
  },
  {
    label: 'Runtime core contract suite',
    command: 'pnpm',
    args: [
      '--filter',
      '@xqoder/runtime',
      'exec',
      'vitest',
      'run',
      'src/core/event-bus.contract.test.ts',
      'src/core/session-store.contract.test.ts',
      'src/core/runtime-kernel.contract.test.ts',
    ],
  },
  {
    label: 'Storage adapter contract suite',
    command: 'pnpm',
    args: ['--filter', '@xqoder/storage-sqlite', 'exec', 'vitest', 'run', 'src/adapter.contract.test.ts'],
  },
  {
    label: 'Plugin SDK contract suite',
    command: 'pnpm',
    args: ['--filter', '@xqoder/plugin-sdk', 'exec', 'vitest', 'run', 'src/plugin.contract.test.ts'],
  },
];

for (const check of checks) {
  process.stdout.write(`\n=== ${check.label}: ${check.command} ${check.args.join(' ')} ===\n`);
  const run = spawnSync(check.command, check.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }
}

process.stdout.write('\nContract gates passed.\n');
