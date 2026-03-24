#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const steps = [
  ['pnpm', ['--filter', '@xqoder/protocol', 'build']],
  ['pnpm', ['--filter', '@xqoder/shared', 'build']],
  ['pnpm', ['--filter', '@xqoder/plugin-sdk', 'build']],
  ['pnpm', ['--filter', '@xqoder/agent', 'build']],
  ['pnpm', ['--filter', '@xqoder/runtime', 'build']],
  ['pnpm', ['--filter', '@xqoder/storage-sqlite', 'build']],
  ['pnpm', ['--filter', '@xqoder/workflow', 'build']],
  ['pnpm', ['--filter', '@xqoder/renderer', 'build']],
  ['pnpm', ['--filter', '@xqoder/cli', 'exec', 'vitest', 'run', '--dir', 'src/terminal-app']],
  ['pnpm', ['--filter', '@xqoder/cli', 'exec', 'vitest', 'run', '--dir', 'src/terminal-core']],
  ['pnpm', ['--filter', '@xqoder/cli', 'exec', 'vitest', 'run',
    'src/tui/agent-service.local-session.test.ts',
    'src/tui/agent-service.remote-reliability.test.ts',
    'src/tui/agent-service.permissions.test.ts',
  ]],
];

for (const [command, args] of steps) {
  process.stdout.write(`Running verify:terminal:theme-slice -> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('\n✅ Terminal boundary cleanup verification passed.\n');
