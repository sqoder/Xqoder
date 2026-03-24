#!/usr/bin/env node

import * as path from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);

function main() {
  const renderer = require(path.resolve(repoRoot, 'packages/renderer'));
  if (!renderer || typeof renderer.ping !== 'function') {
    throw new Error('renderer module loaded without ping()');
  }

  const result = renderer.ping();
  if (result !== 'pong from Rust') {
    throw new Error(`unexpected renderer ping response: ${String(result)}`);
  }

  process.stdout.write('renderer-ok\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
