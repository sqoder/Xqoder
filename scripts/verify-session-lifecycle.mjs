#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const steps = [
  ['pnpm', ['--filter', '@xqoder/shared', 'build']],
  ['pnpm', ['--filter', '@xqoder/agent', 'exec', 'vitest', 'run',
    'src/session/sanitize.test.ts',
    'src/session/session.test.ts',
    'src/session/store.snapshot.test.ts',
    'src/session/store.test.ts',
    'src/project-memory.test.ts',
  ]],
];

for (const [command, args] of steps) {
  process.stdout.write(`Running verify:session:lifecycle -> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('\n✅ Session lifecycle verification passed.\n');
