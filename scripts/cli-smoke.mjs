import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const typesPath = path.join(rootDir, 'dist', 'index.d.ts');

if (!fs.existsSync(typesPath)) {
  console.error('cli smoke test failed: dist/index.d.ts is missing');
  process.exit(1);
}

const checks = [
  {
    name: 'root help',
    args: ['dist/index.js', '--help'],
    expectedOutput: 'Usage:',
  },
  {
    name: 'tui help',
    args: ['dist/index.js', 'tui', '--help'],
    expectedOutput: 'Usage:',
  },
];

for (const check of checks) {
  const output = execFileSync(process.execPath, check.args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });

  if (!output.includes(check.expectedOutput)) {
    console.error(`cli smoke test failed: ${check.name}`);
    console.error(output);
    process.exit(1);
  }

  console.log(`cli smoke test passed: ${check.name}`);
}
