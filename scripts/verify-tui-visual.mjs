#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const command = 'pnpm';
const args = [
  '--filter',
  '@xqoder/cli',
  'exec',
  'vitest',
  'run',
  'src/terminal-core/tui-visual-gate.test.ts',
  'src/terminal-app/interrupt-manager.test.ts',
];

process.stdout.write('Running verify:tui (source-based visual gate)\n');

const run = spawnSync(command, args, {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: 'inherit',
  env: process.env,
});

if (run.status !== 0) {
  process.exit(run.status ?? 1);
}

process.stdout.write('\n✅ TUI visual verification passed.\n');
