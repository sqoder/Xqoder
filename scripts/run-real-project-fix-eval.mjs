#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFixCommand } from '../packages/cli/dist/commands/fix.js';
import { ProjectTestRunner } from '../packages/runtime/dist/index.js';
import {
  ProjectType,
  RuntimeErrorType,
  RuntimeStatus,
} from '../packages/shared/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markerRelativePath = path.join('.xqoder', 'real-project-fix-drill.json');

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
        model: 'deterministic-fix-drill',
        apiKey: '',
      },
      debug: false,
      recentProjects: [],
    }),
  };
}

function createDeterministicRuntime(projectRoot, markerFile) {
  return {
    async start(rootDir) {
      const markerExists = fs.existsSync(markerFile);
      const startedAt = new Date();

      if (markerExists) {
        return {
          status: RuntimeStatus.Error,
          projectDir: rootDir,
          projectType: ProjectType.Node,
          packageManager: 'pnpm',
          command: 'xqoder eval:real-projects --scenario fix-drill --phase detect',
          errors: [{
            type: RuntimeErrorType.CompileError,
            message: 'deterministic real-project fix drill marker present',
            file: path.relative(projectRoot, markerFile),
            line: 1,
          }],
          logs: ['deterministic real-project fix drill marker present'],
          startedAt,
          completedAt: startedAt,
        };
      }

      return {
        status: RuntimeStatus.Running,
        projectDir: rootDir,
        projectType: ProjectType.Node,
        packageManager: 'pnpm',
        command: 'xqoder eval:real-projects --scenario fix-drill --phase verify',
        errors: [],
        logs: ['deterministic real-project fix drill marker cleared'],
        url: `xqoder://real-project-fix/${path.basename(rootDir)}`,
        startedAt,
      };
    },
    analyzeErrors() {
      if (!fs.existsSync(markerFile)) {
        return {
          errors: [],
          autoFixCommands: [],
          summaryForAgent: '没有检测到错误。',
        };
      }

      return {
        errors: [{
          type: RuntimeErrorType.CompileError,
          message: 'deterministic real-project fix drill marker present',
          file: path.relative(projectRoot, markerFile),
          line: 1,
        }],
        autoFixCommands: [],
        summaryForAgent: '检测到 deterministic real-project fix drill marker，需要清理 .xqoder/real-project-fix-drill.json。',
      };
    },
    async stop() {},
  };
}

function writeMarker(markerFile, projectRoot) {
  fs.mkdirSync(path.dirname(markerFile), { recursive: true });
  fs.writeFileSync(markerFile, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    projectRoot,
    protocol: 'deterministic-real-project-fix-drill',
  }, null, 2)}\n`, 'utf8');
}

function cleanupMarker(markerFile) {
  if (!fs.existsSync(markerFile)) {
    return;
  }
  fs.rmSync(markerFile, { force: true });
}

const args = parseArgs(process.argv.slice(2));

if (!args.dir) {
  process.stderr.write('Missing required --dir <projectRoot>\n');
  process.exit(1);
}

const projectRoot = args.dir;
const markerFile = path.join(projectRoot, markerRelativePath);
const startedAt = Date.now();
let success = false;
let errorMessage;

writeMarker(markerFile, projectRoot);

try {
  await runFixCommand({
    dir: projectRoot,
    model: 'deterministic-fix-drill',
    agent: 'eval-drill',
    maxAttempts: 2,
  }, {
    configManager: createEvalConfigManager(),
    runtimeFactory: () => createDeterministicRuntime(projectRoot, markerFile),
    testRunnerFactory: () => ({
      run: (dir) => new ProjectTestRunner().run(dir, {
        ...(args.testCommand ? { command: args.testCommand } : {}),
      }),
    }),
    repairProject: async () => {
      cleanupMarker(markerFile);
      return 'removed deterministic real-project fix drill marker';
    },
  });
  success = true;
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
} finally {
  cleanupMarker(markerFile);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    repoRoot,
    projectRoot,
    markerFile,
    ...(args.testCommand ? { testCommand: args.testCommand } : {}),
    durationMs: Date.now() - startedAt,
    success,
    ...(errorMessage ? { error: errorMessage } : {}),
  }, null, 2)}\n`);
}

if (!success) {
  process.stderr.write(`${errorMessage ?? 'real-project fix eval failed'}\n`);
  process.exit(1);
}
