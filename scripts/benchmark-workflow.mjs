#!/usr/bin/env node

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeStats, ensureBuiltFiles, repoRoot, round, writeBenchmarkReport } from './benchmark-common.mjs';

function parseArgs(argv) {
  const args = new Set(argv);
  const read = (name, fallback) => {
    const index = argv.findIndex((token) => token === `--${name}` || token.startsWith(`--${name}=`));
    if (index === -1) {
      return fallback;
    }
    const token = argv[index];
    if (token.includes('=')) {
      return Number(token.split('=')[1]) || fallback;
    }
    return Number(argv[index + 1]) || fallback;
  };

  return {
    iterations: Math.max(5, read('iterations', 20)),
    maxBuildP95Ms: Math.max(1, read('max-build-p95-ms', 25)),
    maxFixP95Ms: Math.max(1, read('max-fix-p95-ms', 25)),
    strict: process.env.CI === 'true' || args.has('--release'),
  };
}

async function loadDeps() {
  const workflowIndex = path.join(repoRoot, 'packages', 'workflow', 'dist', 'index.js');
  const sharedIndex = path.join(repoRoot, 'packages', 'shared', 'dist', 'index.js');
  ensureBuiltFiles([workflowIndex, sharedIndex]);
  const workflow = await import(pathToFileURL(workflowIndex).href);
  const shared = await import(pathToFileURL(sharedIndex).href);
  return { workflow, shared };
}

async function runBuildBench(iterations, runBuildProjectFlow, enums) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    const result = await runBuildProjectFlow({
      userRequest: '生成一个最小可运行的 benchmark fixture',
      projectConfig: {
        rootDir: '/tmp/xqoder-benchmark-build',
        type: enums.ProjectType.Node,
        name: 'benchmark-build',
      },
      analyzeRequirements: async () => 'benchmark requirements',
      generateStructure: async () => 'structure generated',
      generateCode: async () => 'code generated',
      installDependencies: async () => 'dependencies installed',
      runtimeFactory: () => ({
        start: async () => ({
          status: enums.RuntimeStatus.Running,
          projectDir: '/tmp/xqoder-benchmark-build',
          projectType: enums.ProjectType.Node,
          packageManager: 'npm',
          command: 'npm run dev',
          url: 'http://localhost:3000',
          errors: [],
          logs: [],
          startedAt: new Date(),
        }),
        stop: async () => {},
      }),
      testProject: async () => ({
        status: enums.TestStatus.Passed,
        projectDir: '/tmp/xqoder-benchmark-build',
        packageManager: 'npm',
        command: 'npm run test',
        output: 'tests passed',
        passed: 1,
        failed: 0,
        skipped: 0,
        failures: [],
        startedAt: new Date(),
        completedAt: new Date(),
      }),
    });

    if (result.status !== enums.WorkflowStatus.Completed) {
      throw new Error(result.error ?? 'build workflow benchmark failed');
    }
    samples.push(performance.now() - started);
  }
  return computeStats(samples);
}

async function runFixBench(iterations, runFixProjectFlow, enums) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    let startCalls = 0;
    const started = performance.now();
    const result = await runFixProjectFlow({
      userRequest: '修复 benchmark fixture',
      projectConfig: {
        rootDir: '/tmp/xqoder-benchmark-fix',
        type: enums.ProjectType.Node,
        name: 'benchmark-fix',
      },
      maxAttempts: 2,
      runtimeFactory: () => ({
        start: async () => {
          startCalls += 1;
          return startCalls === 1
            ? {
              status: enums.RuntimeStatus.Error,
              projectDir: '/tmp/xqoder-benchmark-fix',
              projectType: enums.ProjectType.Node,
              packageManager: 'npm',
              command: 'npm run dev',
              errors: [{
                type: enums.RuntimeErrorType.CompileError,
                message: 'Synthetic compile error',
              }],
              logs: [],
              startedAt: new Date(),
            }
            : {
              status: enums.RuntimeStatus.Running,
              projectDir: '/tmp/xqoder-benchmark-fix',
              projectType: enums.ProjectType.Node,
              packageManager: 'npm',
              command: 'npm run dev',
              errors: [],
              logs: [],
              url: 'http://localhost:3000',
              startedAt: new Date(),
            };
        },
        stop: async () => {},
        analyzeErrors: () => (startCalls === 1
          ? {
            errors: [{
              type: enums.RuntimeErrorType.CompileError,
              message: 'Synthetic compile error',
            }],
            autoFixCommands: [],
            summaryForAgent: 'Synthetic compile error',
          }
          : {
            errors: [],
            autoFixCommands: [],
            summaryForAgent: '没有检测到错误。',
          }),
      }),
      repairProject: async () => 'patched',
    });

    if (result.status !== enums.WorkflowStatus.Completed) {
      throw new Error(result.error ?? 'fix workflow benchmark failed');
    }
    samples.push(performance.now() - started);
  }
  return computeStats(samples);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {
    workflow: {
      runBuildProjectFlow,
      runFixProjectFlow,
    },
    shared: {
      LogLevel,
      logger,
      ProjectType,
      RuntimeStatus,
      RuntimeErrorType,
      TestStatus,
      WorkflowStatus,
    },
  } = await loadDeps();

  const enums = {
    ProjectType,
    RuntimeStatus,
    RuntimeErrorType,
    TestStatus,
    WorkflowStatus,
  };

  logger.setLevel(LogLevel.Silent);

  const buildStats = await runBuildBench(args.iterations, runBuildProjectFlow, enums);
  const fixStats = await runFixBench(args.iterations, runFixProjectFlow, enums);
  const report = {
    slug: 'workflow-core',
    title: 'Workflow Core Benchmark',
    generatedAt: new Date().toISOString(),
    summary: 'Measures orchestration overhead for the build/fix workflow engine with deterministic fake runtimes.',
    meta: {
      iterations: args.iterations,
    },
    sections: [
      {
        title: 'Build Flow Latency (ms)',
        metrics: {
          min: round(buildStats.min),
          p50: round(buildStats.p50),
          p95: round(buildStats.p95),
          avg: round(buildStats.avg),
          max: round(buildStats.max),
        },
      },
      {
        title: 'Fix Flow Latency (ms)',
        metrics: {
          min: round(fixStats.min),
          p50: round(fixStats.p50),
          p95: round(fixStats.p95),
          avg: round(fixStats.avg),
          max: round(fixStats.max),
        },
      },
    ],
    acceptance: [
      {
        label: 'Build flow p95',
        target: `< ${args.maxBuildP95Ms}ms`,
        actual: `${round(buildStats.p95)}ms`,
        pass: buildStats.p95 <= args.maxBuildP95Ms,
      },
      {
        label: 'Fix flow p95',
        target: `< ${args.maxFixP95Ms}ms`,
        actual: `${round(fixStats.p95)}ms`,
        pass: fixStats.p95 <= args.maxFixP95Ms,
      },
    ],
  };

  const { jsonPath, markdownPath } = writeBenchmarkReport('workflow-core', report);
  process.stdout.write(`workflow benchmark written:\n- ${path.relative(repoRoot, jsonPath)}\n- ${path.relative(repoRoot, markdownPath)}\n`);

  if (args.strict && report.acceptance.some((entry) => !entry.pass)) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
