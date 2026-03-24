#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const buildOrder = [
  '@xqoder/shared',
  '@xqoder/llm-api',
  '@xqoder/protocol',
  '@xqoder/permissions',
  '@xqoder/plugin-sdk',
  '@xqoder/provider-openai',
  '@xqoder/provider-anthropic',
  '@xqoder/storage-sqlite',
  '@xqoder/runtime',
];

for (const pkg of buildOrder) {
  process.stdout.write(`\n> building ${pkg}\n`);
  const result = spawnSync('pnpm', ['--filter', pkg, 'build'], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('\nSession theme workspace prerequisites are ready.\n');
