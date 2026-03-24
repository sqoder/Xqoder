#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const steps = [
  ['pnpm', ['--filter', '@xqoder/storage-sqlite...', 'build']],
  ['pnpm', ['--filter', '@xqoder/agent', 'build']],
  ['pnpm', ['--filter', '@xqoder/runtime', 'typecheck']],
  ['pnpm', ['--filter', '@xqoder/storage-sqlite', 'typecheck']],
  ['pnpm', ['--filter', '@xqoder/storage-sqlite', 'exec', 'vitest', 'run', 'src/adapter.contract.test.ts']],
  ['pnpm', ['--filter', '@xqoder/runtime', 'exec', 'vitest', 'run',
    'src/core/event-bus.contract.test.ts',
    'src/core/registry.smoke.test.ts',
    'src/core/runtime-kernel.contract.test.ts',
    'src/core/session-store.contract.test.ts',
  ]],
  ['node', ['./scripts/verify-session-recovery.mjs']],
];

for (const [command, args] of steps) {
  process.stdout.write(`Running verify:storage:theme-slice -> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('\n✅ Storage decoupling verification passed.\n');
