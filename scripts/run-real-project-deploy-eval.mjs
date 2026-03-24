#!/usr/bin/env node

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDeployCommand } from '../packages/cli/dist/commands/deploy.js';
import { createDeterministicDeployDrillDeployer } from '../packages/cli/dist/services/deterministic-deploy-drill.js';
import { DeployConfigGenerator as DefaultDeployConfigGenerator } from '../packages/agent/dist/index.js';
import { DeployTarget } from '../packages/shared/dist/index.js';

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
  return {
    dir: dir ? path.resolve(dir) : '',
    buildCommand: readValue('build-command', '').trim(),
    outputDir: readValue('output-dir', '').trim(),
    json: argv.includes('--json'),
  };
}

function createEvalConfigManager() {
  return {
    load: () => ({
      llm: {
        provider: 'openai',
        model: 'deterministic-deploy-drill',
        apiKey: '',
      },
      debug: false,
      recentProjects: [],
    }),
  };
}

const args = parseArgs(process.argv.slice(2));

if (!args.dir) {
  process.stderr.write('Missing required --dir <projectRoot>\n');
  process.exit(1);
}

const projectRoot = args.dir;
const startedAt = Date.now();
let success = false;
let errorMessage;

try {
  await runDeployCommand({
    dir: projectRoot,
  }, {
    configManager: createEvalConfigManager(),
    configGenerator: {
      generate(dir) {
        const base = new DefaultDeployConfigGenerator().generate(dir, DeployTarget.Vercel);
        return {
          ...base,
          ...(args.buildCommand ? { buildCommand: args.buildCommand } : {}),
          ...(args.outputDir ? { outputDir: args.outputDir } : {}),
        };
      },
    },
    deployerFactory: () => createDeterministicDeployDrillDeployer({
      urlOrigin: 'https://deploy.local',
    }),
  });
  success = true;
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    repoRoot,
    projectRoot,
    ...(args.buildCommand ? { buildCommand: args.buildCommand } : {}),
    ...(args.outputDir ? { outputDir: args.outputDir } : {}),
    durationMs: Date.now() - startedAt,
    success,
    ...(errorMessage ? { error: errorMessage } : {}),
  }, null, 2)}\n`);
}

if (!success) {
  process.stderr.write(`${errorMessage ?? 'real-project deploy eval failed'}\n`);
  process.exit(1);
}
