#!/usr/bin/env node

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTestCommand } from '../packages/cli/dist/commands/test.js';
import { ProjectTestRunner } from '../packages/runtime/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const readValue = (name, fallback) => {
    const index = argv.findIndex((token) => token === `--${name}` || token.startsWith(`--${name}=`));
    if (index === -1) {
      return fallback;
    }

    const token = argv[index];
    if (token.includes('=')) {
      return token.split('=').slice(1).join('=');
    }
    return argv[index + 1] ?? fallback;
  };

  const dir = readValue('dir', '');
  const command = readValue('command', '');
  return {
    dir: dir ? path.resolve(dir) : '',
    command: command.trim(),
    json: argv.includes('--json'),
  };
}

const args = parseArgs(process.argv.slice(2));

if (!args.dir) {
  process.stderr.write('Missing required --dir <projectRoot>\n');
  process.exit(1);
}

const startedAt = Date.now();
let success = false;
let errorMessage;

try {
  await runTestCommand({
    dir: args.dir,
  }, {
    ...(args.command
      ? {
        testRunnerFactory: () => {
          const runner = new ProjectTestRunner();
          return {
            run: (projectDir) => runner.run(projectDir, {
              command: args.command,
            }),
          };
        },
      }
      : {}),
  });
  success = true;
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    repoRoot,
    projectRoot: args.dir,
    ...(args.command ? { command: args.command } : {}),
    durationMs: Date.now() - startedAt,
    success,
    ...(errorMessage ? { error: errorMessage } : {}),
  }, null, 2)}\n`);
}

if (!success) {
  process.stderr.write(`${errorMessage ?? 'real-project test eval failed'}\n`);
  process.exit(1);
}
