#!/usr/bin/env node

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuildCommand } from '../packages/cli/dist/commands/build.js';
import { ProjectTestRunner } from '../packages/runtime/dist/index.js';
import {
  ProjectType,
  RuntimeStatus,
} from '../packages/shared/dist/index.js';

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
  const testCommand = readValue('test-command', '');
  return {
    dir: dir ? path.resolve(dir) : '',
    testCommand: testCommand.trim(),
    json: argv.includes('--json'),
  };
}

function createEvalConfigManager() {
  return {
    load: () => ({
      llm: {
        provider: 'openai',
        model: 'deterministic-build-drill',
        apiKey: '',
      },
      debug: false,
      recentProjects: [],
    }),
  };
}

function createNoopAgentFactory() {
  return () => ({
    run: async (prompt) => {
      if (prompt.includes('只创建项目目录结构')) {
        return 'deterministic build drill: structure acknowledged';
      }
      return 'deterministic build drill: code generation skipped for existing real project target';
    },
  });
}

function createDeterministicRuntime(projectRoot) {
  return {
    async start(rootDir) {
      return {
        status: RuntimeStatus.Running,
        projectDir: rootDir,
        projectType: ProjectType.Node,
        packageManager: 'pnpm',
        command: 'xqoder eval:real-projects --scenario build-drill --phase verify',
        url: `xqoder://real-project-build/${path.basename(projectRoot)}`,
        errors: [],
        logs: ['deterministic real-project build drill runtime verification passed'],
        startedAt: new Date(),
      };
    },
    async stop() {},
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
  await runBuildCommand(
    'deterministic real-project build drill',
    {
      dir: projectRoot,
      model: 'deterministic-build-drill',
      agent: 'eval-drill',
    },
    {
      configManager: createEvalConfigManager(),
      agentFactory: createNoopAgentFactory(),
      runtimeFactory: () => createDeterministicRuntime(projectRoot),
      installDependencies: async () => 'deterministic build drill: dependency install skipped',
      testProject: async (dir) => new ProjectTestRunner().run(dir, {
        ...(args.testCommand ? { command: args.testCommand } : {}),
      }),
    },
  );
  success = true;
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    repoRoot,
    projectRoot,
    ...(args.testCommand ? { testCommand: args.testCommand } : {}),
    durationMs: Date.now() - startedAt,
    success,
    ...(errorMessage ? { error: errorMessage } : {}),
  }, null, 2)}\n`);
}

if (!success) {
  process.stderr.write(`${errorMessage ?? 'real-project build eval failed'}\n`);
  process.exit(1);
}
