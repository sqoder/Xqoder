#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  appendReportHistory,
  computeStats,
  ensureBuiltFiles,
  repoRoot,
  round,
  formatMetric,
} from './benchmark-common.mjs';
import { writeQualityOverviewReports } from './quality-report-common.mjs';

const evalsDir = path.join(repoRoot, 'docs', 'evals');

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

  const strict = process.env.CI === 'true' || args.has('--release');
  const defaultOverall = strict ? 1 : 0.98;
  const defaultFixture = strict ? 1 : 0.95;

  return {
    repeats: Math.max(1, read('repeats', 3)),
    minOverallSuccessRate: Math.min(1, Math.max(0, read('min-overall-success-rate', defaultOverall))),
    minFixtureSuccessRate: Math.min(1, Math.max(0, read('min-fixture-success-rate', defaultFixture))),
    strict,
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

function buildRunReportOk(enums, projectDir) {
  return {
    status: enums.RuntimeStatus.Running,
    projectDir,
    projectType: enums.ProjectType.Node,
    packageManager: 'npm',
    command: 'npm run dev',
    url: 'http://localhost:3000',
    errors: [],
    logs: [],
    startedAt: new Date(),
  };
}

function buildRunReportError(
  enums,
  projectDir,
  message,
  errorType = enums.RuntimeErrorType.CompileError,
  packageManager = 'npm',
) {
  return {
    status: enums.RuntimeStatus.Error,
    projectDir,
    projectType: enums.ProjectType.Node,
    packageManager,
    command: 'npm run dev',
    errors: [{
      type: errorType,
      message,
    }],
    logs: [],
    startedAt: new Date(),
  };
}

function healthyAnalysis() {
  return {
    errors: [],
    autoFixCommands: [],
    summaryForAgent: 'No runtime errors detected.',
  };
}

function failedAnalysis(
  enums,
  message,
  errorType = enums.RuntimeErrorType.CompileError,
  autoFixCommands = [],
) {
  return {
    errors: [{
      type: errorType,
      message,
    }],
    autoFixCommands,
    summaryForAgent: message,
  };
}

function createFixRuntimeFactory(captures) {
  let index = 0;
  return () => {
    const capture = captures[Math.min(index, captures.length - 1)];
    index += 1;
    return {
      start: async () => capture.runReport,
      stop: async () => {},
      analyzeErrors: () => capture.analysis,
    };
  };
}

function expectedPass(condition, expected, actual, extra = {}) {
  return {
    ok: condition,
    expected,
    actual,
    ...extra,
  };
}

function buildFixtures({ workflow, enums }) {
  const {
    runBuildProjectFlow,
    runDeployProjectFlow,
    runFixProjectFlow,
    runTestProjectFlow,
  } = workflow;

  return [
    {
      id: 'build_success_tests_passed',
      flow: 'build',
      expectedWorkflowSuccess: true,
      description: 'Build flow completes when runtime and tests are both healthy.',
      run: async () => {
        const result = await runBuildProjectFlow({
          userRequest: 'generate a minimal project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-build-ok',
            type: enums.ProjectType.Node,
            name: 'build-ok',
          },
          analyzeRequirements: async () => 'analysis',
          generateStructure: async () => 'structure generated',
          generateCode: async () => 'code generated',
          installDependencies: async () => 'deps installed',
          runtimeFactory: () => ({
            start: async () => buildRunReportOk(enums, '/tmp/xqoder-eval-build-ok'),
            stop: async () => {},
          }),
          testProject: async () => ({
            status: enums.TestStatus.Passed,
            projectDir: '/tmp/xqoder-eval-build-ok',
            packageManager: 'npm',
            command: 'npm run test',
            output: 'tests passed',
            passed: 4,
            failed: 0,
            skipped: 0,
            failures: [],
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Completed,
          'WorkflowStatus.Completed',
          result.status,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'build_runtime_failure',
      flow: 'build',
      expectedWorkflowSuccess: false,
      description: 'Build flow fails fast when runtime startup reports errors.',
      run: async () => {
        const message = 'Synthetic startup failure';
        const result = await runBuildProjectFlow({
          userRequest: 'generate a minimal project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-build-runtime-fail',
            type: enums.ProjectType.Node,
            name: 'build-runtime-fail',
          },
          analyzeRequirements: async () => 'analysis',
          generateStructure: async () => 'structure generated',
          generateCode: async () => 'code generated',
          installDependencies: async () => 'deps installed',
          runtimeFactory: () => ({
            start: async () => buildRunReportError(enums, '/tmp/xqoder-eval-build-runtime-fail', message),
            stop: async () => {},
          }),
          testProject: async () => ({
            status: enums.TestStatus.Passed,
            projectDir: '/tmp/xqoder-eval-build-runtime-fail',
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
        return expectedPass(
          result.status === enums.WorkflowStatus.Failed && String(result.error ?? '').includes(message),
          `WorkflowStatus.Failed with error containing "${message}"`,
          `${result.status}; error=${result.error ?? 'none'}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'build_test_failure',
      flow: 'build',
      expectedWorkflowSuccess: false,
      description: 'Build flow fails when tests return failed status.',
      run: async () => {
        const message = 'Synthetic test failure';
        const result = await runBuildProjectFlow({
          userRequest: 'generate a minimal project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-build-test-fail',
            type: enums.ProjectType.Node,
            name: 'build-test-fail',
          },
          analyzeRequirements: async () => 'analysis',
          generateStructure: async () => 'structure generated',
          generateCode: async () => 'code generated',
          installDependencies: async () => 'deps installed',
          runtimeFactory: () => ({
            start: async () => buildRunReportOk(enums, '/tmp/xqoder-eval-build-test-fail'),
            stop: async () => {},
          }),
          testProject: async () => ({
            status: enums.TestStatus.Failed,
            projectDir: '/tmp/xqoder-eval-build-test-fail',
            packageManager: 'npm',
            command: 'npm run test',
            output: 'tests failed',
            passed: 0,
            failed: 1,
            skipped: 0,
            failures: [{ file: 'src/main.test.ts', testName: 'should fail', message }],
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Failed && String(result.error ?? '').includes(message),
          `WorkflowStatus.Failed with error containing "${message}"`,
          `${result.status}; error=${result.error ?? 'none'}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'build_tests_skipped',
      flow: 'build',
      expectedWorkflowSuccess: true,
      description: 'Build flow remains successful when tests are explicitly skipped.',
      run: async () => {
        const result = await runBuildProjectFlow({
          userRequest: 'generate a minimal project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-build-skip-tests',
            type: enums.ProjectType.Node,
            name: 'build-skip-tests',
          },
          analyzeRequirements: async () => 'analysis',
          generateStructure: async () => 'structure generated',
          generateCode: async () => 'code generated',
          installDependencies: async () => 'deps installed',
          runtimeFactory: () => ({
            start: async () => buildRunReportOk(enums, '/tmp/xqoder-eval-build-skip-tests'),
            stop: async () => {},
          }),
          testProject: async () => ({
            status: enums.TestStatus.Skipped,
            projectDir: '/tmp/xqoder-eval-build-skip-tests',
            packageManager: 'npm',
            command: 'npm run test',
            output: 'tests skipped by fixture',
            passed: 0,
            failed: 0,
            skipped: 1,
            failures: [],
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Completed,
          'WorkflowStatus.Completed',
          result.status,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'fix_dependency_missing_auto_action',
      flow: 'fix',
      expectedWorkflowSuccess: true,
      description: 'Fix flow resolves runtime_dependency_missing via automatic action before any agent repair is needed.',
      run: async () => {
        const dependencyMessage = 'Cannot find module react';
        const result = await runFixProjectFlow({
          userRequest: 'fix project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-fix-dependency-auto',
            type: enums.ProjectType.Node,
            name: 'fix-dependency-auto',
          },
          maxAttempts: 2,
          runtimeFactory: createFixRuntimeFactory([
            {
              runReport: buildRunReportError(
                enums,
                '/tmp/xqoder-eval-fix-dependency-auto',
                dependencyMessage,
                enums.RuntimeErrorType.DependencyMissing,
              ),
              analysis: failedAnalysis(
                enums,
                dependencyMessage,
                enums.RuntimeErrorType.DependencyMissing,
                ['npm install react'],
              ),
            },
            {
              runReport: buildRunReportOk(enums, '/tmp/xqoder-eval-fix-dependency-auto'),
              analysis: healthyAnalysis(),
            },
          ]),
          repairProject: async () => {
            throw new Error('repairProject should not run for dependency auto action fixture');
          },
          applySafeAutomaticRemediation: async (input) => {
            if (input.suspectedFailureBucket !== 'runtime_dependency_missing') {
              return null;
            }
            return {
              actionId: 'auto-install-dependency-v1',
              summary: 'installed react automatically',
            };
          },
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Completed
            && result.automaticActionIds.includes('auto-install-dependency-v1')
            && result.appliedPolicyIds.includes('dependency-missing-v1')
            && result.observedFailureBuckets.includes('runtime_dependency_missing'),
          'WorkflowStatus.Completed with promoted dependency auto action evidence',
          `${result.status}; actions=${result.automaticActionIds.join(',') || 'none'}; policies=${result.appliedPolicyIds.join(',') || 'none'}; buckets=${result.observedFailureBuckets.join(',') || 'none'}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
            automaticActionIds: result.automaticActionIds,
            appliedPolicyIds: result.appliedPolicyIds,
            observedFailureBuckets: result.observedFailureBuckets,
          },
        );
      },
    },
    {
      id: 'fix_immediate_healthy',
      flow: 'fix',
      expectedWorkflowSuccess: true,
      description: 'Fix flow exits immediately when runtime state is already healthy.',
      run: async () => {
        const result = await runFixProjectFlow({
          userRequest: 'fix project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-fix-immediate',
            type: enums.ProjectType.Node,
            name: 'fix-immediate',
          },
          maxAttempts: 2,
          runtimeFactory: createFixRuntimeFactory([{
            runReport: buildRunReportOk(enums, '/tmp/xqoder-eval-fix-immediate'),
            analysis: healthyAnalysis(),
          }]),
          repairProject: async () => 'no-op',
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Completed && (result.attempts.length === 1),
          'WorkflowStatus.Completed with exactly 1 attempt',
          `${result.status}; attempts=${result.attempts.length}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'fix_compile_error_single_repair',
      flow: 'fix',
      expectedWorkflowSuccess: true,
      description: 'Fix flow repairs runtime_compile_error in one attempt and records compile-error policy evidence.',
      run: async () => {
        const compileMessage = 'TypeScript compile error';
        const result = await runFixProjectFlow({
          userRequest: 'fix project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-fix-compile-single',
            type: enums.ProjectType.Node,
            name: 'fix-compile-single',
          },
          maxAttempts: 2,
          runtimeFactory: createFixRuntimeFactory([
            {
              runReport: buildRunReportError(
                enums,
                '/tmp/xqoder-eval-fix-compile-single',
                compileMessage,
              ),
              analysis: failedAnalysis(enums, compileMessage),
            },
            {
              runReport: buildRunReportOk(enums, '/tmp/xqoder-eval-fix-compile-single'),
              analysis: healthyAnalysis(),
            },
          ]),
          repairProject: async () => 'patched',
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Completed
            && result.attempts.length === 1
            && result.appliedPolicyIds.includes('compile-error-v1')
            && result.observedFailureBuckets.includes('runtime_compile_error'),
          'WorkflowStatus.Completed with compile-error policy evidence',
          `${result.status}; attempts=${result.attempts.length}; policies=${result.appliedPolicyIds.join(',') || 'none'}; buckets=${result.observedFailureBuckets.join(',') || 'none'}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
            appliedPolicyIds: result.appliedPolicyIds,
            observedFailureBuckets: result.observedFailureBuckets,
          },
        );
      },
    },
    {
      id: 'fix_success_on_second_attempt',
      flow: 'fix',
      expectedWorkflowSuccess: true,
      description: 'Fix flow retries and succeeds on the second attempt.',
      run: async () => {
        const result = await runFixProjectFlow({
          userRequest: 'fix project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-fix-second',
            type: enums.ProjectType.Node,
            name: 'fix-second',
          },
          maxAttempts: 2,
          runtimeFactory: createFixRuntimeFactory([
            {
              runReport: buildRunReportError(enums, '/tmp/xqoder-eval-fix-second', 'Failure A'),
              analysis: failedAnalysis(enums, 'Failure A'),
            },
            {
              runReport: buildRunReportError(enums, '/tmp/xqoder-eval-fix-second', 'Failure A'),
              analysis: failedAnalysis(enums, 'Failure A'),
            },
            {
              runReport: buildRunReportError(enums, '/tmp/xqoder-eval-fix-second', 'Failure B'),
              analysis: failedAnalysis(enums, 'Failure B'),
            },
            {
              runReport: buildRunReportOk(enums, '/tmp/xqoder-eval-fix-second'),
              analysis: healthyAnalysis(),
            },
          ]),
          repairProject: async () => 'patched',
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Completed && result.attempts.length === 2,
          'WorkflowStatus.Completed with exactly 2 attempts',
          `${result.status}; attempts=${result.attempts.length}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'fix_exhausted_attempts',
      flow: 'fix',
      expectedWorkflowSuccess: false,
      description: 'Fix flow returns failed when max attempts are exhausted.',
      run: async () => {
        const result = await runFixProjectFlow({
          userRequest: 'fix project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-fix-exhaust',
            type: enums.ProjectType.Node,
            name: 'fix-exhaust',
          },
          maxAttempts: 2,
          runtimeFactory: createFixRuntimeFactory([
            {
              runReport: buildRunReportError(enums, '/tmp/xqoder-eval-fix-exhaust', 'Failure A'),
              analysis: failedAnalysis(enums, 'Failure A'),
            },
            {
              runReport: buildRunReportError(enums, '/tmp/xqoder-eval-fix-exhaust', 'Failure A'),
              analysis: failedAnalysis(enums, 'Failure A'),
            },
            {
              runReport: buildRunReportError(enums, '/tmp/xqoder-eval-fix-exhaust', 'Failure B'),
              analysis: failedAnalysis(enums, 'Failure B'),
            },
            {
              runReport: buildRunReportError(enums, '/tmp/xqoder-eval-fix-exhaust', 'Failure B'),
              analysis: failedAnalysis(enums, 'Failure B'),
            },
          ]),
          repairProject: async () => 'patched',
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Failed,
          'WorkflowStatus.Failed',
          result.status,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'fix_repair_exception',
      flow: 'fix',
      expectedWorkflowSuccess: false,
      description: 'Fix flow surfaces repair exceptions as workflow failure.',
      run: async () => {
        const failureMessage = 'Synthetic patch apply failure';
        const result = await runFixProjectFlow({
          userRequest: 'fix project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-fix-repair-throw',
            type: enums.ProjectType.Node,
            name: 'fix-repair-throw',
          },
          maxAttempts: 1,
          runtimeFactory: createFixRuntimeFactory([{
            runReport: buildRunReportError(enums, '/tmp/xqoder-eval-fix-repair-throw', 'Failure'),
            analysis: failedAnalysis(enums, 'Failure'),
          }]),
          repairProject: async () => {
            throw new Error(failureMessage);
          },
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Failed && String(result.error ?? '').includes(failureMessage),
          `WorkflowStatus.Failed with error containing "${failureMessage}"`,
          `${result.status}; error=${result.error ?? 'none'}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'test_success',
      flow: 'test',
      expectedWorkflowSuccess: true,
      description: 'Test flow completes when the project test command passes.',
      run: async () => {
        const result = await runTestProjectFlow({
          userRequest: 'run tests',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-test-ok',
            type: enums.ProjectType.Node,
            name: 'test-ok',
          },
          testProject: async () => ({
            status: enums.TestStatus.Passed,
            projectDir: '/tmp/xqoder-eval-test-ok',
            packageManager: 'npm',
            command: 'npm run test',
            output: '3 passed',
            passed: 3,
            failed: 0,
            skipped: 0,
            failures: [],
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Completed,
          'WorkflowStatus.Completed',
          result.status,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'test_skipped',
      flow: 'test',
      expectedWorkflowSuccess: true,
      description: 'Test flow remains successful when tests are explicitly skipped.',
      run: async () => {
        const result = await runTestProjectFlow({
          userRequest: 'run tests',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-test-skip',
            type: enums.ProjectType.Node,
            name: 'test-skip',
          },
          testProject: async () => ({
            status: enums.TestStatus.Skipped,
            projectDir: '/tmp/xqoder-eval-test-skip',
            packageManager: 'npm',
            command: 'npm run test',
            output: 'tests skipped',
            passed: 0,
            failed: 0,
            skipped: 1,
            failures: [],
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Completed,
          'WorkflowStatus.Completed',
          result.status,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'test_failure',
      flow: 'test',
      expectedWorkflowSuccess: false,
      description: 'Test flow returns failed when the test command reports a failure.',
      run: async () => {
        const result = await runTestProjectFlow({
          userRequest: 'run tests',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-test-fail',
            type: enums.ProjectType.Node,
            name: 'test-fail',
          },
          testProject: async () => ({
            status: enums.TestStatus.Failed,
            projectDir: '/tmp/xqoder-eval-test-fail',
            packageManager: 'npm',
            command: 'npm run test',
            output: 'FAIL should fail',
            passed: 0,
            failed: 1,
            skipped: 0,
            failures: [{ message: 'FAIL should fail' }],
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Failed && result.failureBucket === 'test_failed',
          'WorkflowStatus.Failed with failureBucket test_failed',
          `${result.status}; bucket=${result.failureBucket ?? 'none'}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'deploy_success',
      flow: 'deploy',
      expectedWorkflowSuccess: true,
      description: 'Deploy flow completes when config validation and deploy succeed.',
      run: async () => {
        const result = await runDeployProjectFlow({
          userRequest: 'deploy project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-deploy-ok',
            type: enums.ProjectType.Node,
            name: 'deploy-ok',
          },
          prepareDeployConfig: async () => ({
            target: enums.DeployTarget.Vercel,
            projectDir: '/tmp/xqoder-eval-deploy-ok',
            buildCommand: 'npm run build',
            outputDir: 'dist',
          }),
          validateDeployConfig: async () => ({
            valid: true,
            errors: [],
          }),
          deployProject: async () => ({
            status: enums.DeployStatus.Ready,
            projectDir: '/tmp/xqoder-eval-deploy-ok',
            buildCommand: 'npm run build',
            outputDir: 'dist',
            url: 'https://deploy-ok.vercel.app',
            target: enums.DeployTarget.Vercel,
            deployId: 'deploy-ok',
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Completed,
          'WorkflowStatus.Completed',
          result.status,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
    {
      id: 'deploy_validation_failure',
      flow: 'deploy',
      expectedWorkflowSuccess: false,
      description: 'Deploy flow fails when validation rejects the generated config.',
      run: async () => {
        const result = await runDeployProjectFlow({
          userRequest: 'deploy project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-deploy-validate-fail',
            type: enums.ProjectType.Node,
            name: 'deploy-validate-fail',
          },
          prepareDeployConfig: async () => ({
            target: enums.DeployTarget.Vercel,
            projectDir: '/tmp/xqoder-eval-deploy-validate-fail',
            buildCommand: 'npm run build',
            outputDir: '',
          }),
          validateDeployConfig: async () => ({
            valid: false,
            errors: ['输出目录不能为空'],
          }),
          deployProject: async () => ({
            status: enums.DeployStatus.Failed,
            projectDir: '/tmp/xqoder-eval-deploy-validate-fail',
            buildCommand: 'npm run build',
            outputDir: '',
            target: enums.DeployTarget.Vercel,
            error: '输出目录不能为空',
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Failed
            && result.failureBucket === 'deploy_validation_failed'
            && result.automaticActionIds.includes('deploy-config-preflight-v1'),
          'WorkflowStatus.Failed with deploy_validation_failed and preflight evidence',
          `${result.status}; bucket=${result.failureBucket ?? 'none'}; actions=${result.automaticActionIds.join(',') || 'none'}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
            automaticActionIds: result.automaticActionIds,
          },
        );
      },
    },
    {
      id: 'deploy_provider_failure',
      flow: 'deploy',
      expectedWorkflowSuccess: false,
      description: 'Deploy flow classifies provider auth failures into a stable bucket.',
      run: async () => {
        const result = await runDeployProjectFlow({
          userRequest: 'deploy project',
          projectConfig: {
            rootDir: '/tmp/xqoder-eval-deploy-provider-fail',
            type: enums.ProjectType.Node,
            name: 'deploy-provider-fail',
          },
          prepareDeployConfig: async () => ({
            target: enums.DeployTarget.Vercel,
            projectDir: '/tmp/xqoder-eval-deploy-provider-fail',
            buildCommand: 'npm run build',
            outputDir: 'dist',
          }),
          validateDeployConfig: async () => ({
            valid: true,
            errors: [],
          }),
          deployProject: async () => ({
            status: enums.DeployStatus.Failed,
            projectDir: '/tmp/xqoder-eval-deploy-provider-fail',
            buildCommand: 'npm run build',
            outputDir: 'dist',
            target: enums.DeployTarget.Vercel,
            error: 'token invalid',
            startedAt: new Date(),
            completedAt: new Date(),
          }),
        });
        return expectedPass(
          result.status === enums.WorkflowStatus.Failed && result.failureBucket === 'deploy_auth_failed',
          'WorkflowStatus.Failed with failureBucket deploy_auth_failed',
          `${result.status}; bucket=${result.failureBucket ?? 'none'}`,
          {
            workflowSucceeded: result.status === enums.WorkflowStatus.Completed,
            failureBucket: result.failureBucket,
            attemptCount: result.attemptCount,
            resultLabel: result.resultLabel,
          },
        );
      },
    },
  ];
}

function buildFailureBuckets(runs) {
  const buckets = new Map();
  for (const run of runs) {
    if (run.ok) continue;
    const key = run.error ?? 'unknown';
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));
}

function buildMarkdown(report) {
  const lines = [
    `# ${report.title}`,
    '',
    `- Generated: ${report.generatedAt}`,
    `- Summary: ${report.summary}`,
    '',
    '## Meta',
    '',
    '| Key | Value |',
    '| --- | --- |',
  ];
  for (const [key, value] of Object.entries(report.meta ?? {})) {
    lines.push(`| ${key} | ${formatMetric(value)} |`);
  }

  for (const section of report.sections ?? []) {
    lines.push('', `## ${section.title}`, '', '| Metric | Value |', '| --- | ---: |');
    for (const [key, value] of Object.entries(section.metrics)) {
      lines.push(`| ${key} | ${formatMetric(value)} |`);
    }
  }

  lines.push('', '## Fixture Results', '', '| Fixture | Flow | Success Rate | Passed | Failed | p95 (ms) |', '| --- | --- | ---: | ---: | ---: | ---: |');
  for (const fixture of report.fixtures ?? []) {
    lines.push(`| ${fixture.id} | ${fixture.flow} | ${formatMetric(fixture.successRate)} | ${fixture.passed} | ${fixture.failed} | ${formatMetric(fixture.latency.p95)} |`);
  }

  if ((report.failures ?? []).length > 0) {
    lines.push('', '## Failure Buckets', '', '| Reason | Count |', '| --- | ---: |');
    for (const item of report.failures) {
      lines.push(`| ${item.reason} | ${item.count} |`);
    }
  }

  if ((report.acceptance ?? []).length > 0) {
    lines.push('', '## Acceptance', '', '| Check | Target | Actual | Result |', '| --- | --- | --- | --- |');
    for (const item of report.acceptance) {
      lines.push(`| ${item.label} | ${item.target} | ${item.actual} | ${item.pass ? 'PASS' : 'FAIL'} |`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function writeEvalReport(slug, report) {
  fs.mkdirSync(evalsDir, { recursive: true });
  const jsonPath = path.join(evalsDir, `${slug}.json`);
  const markdownPath = path.join(evalsDir, `${slug}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, buildMarkdown(report), 'utf8');
  const { historyPath } = appendReportHistory(evalsDir, slug, report);
  writeQualityOverviewReports({ projectRoot: repoRoot });
  return { jsonPath, markdownPath, historyPath };
}

async function runFixture(fixture, repeatIndex) {
  const started = performance.now();
  try {
    const verdict = await fixture.run();
    const elapsed = performance.now() - started;
    return {
      repeat: repeatIndex,
      ok: !!verdict.ok,
      durationMs: elapsed,
      expected: verdict.expected,
      actual: verdict.actual,
      workflowSucceeded: verdict.workflowSucceeded ?? false,
      failureBucket: verdict.failureBucket,
      attemptCount: verdict.attemptCount,
      resultLabel: verdict.resultLabel,
      automaticActionIds: verdict.automaticActionIds ?? [],
      appliedPolicyIds: verdict.appliedPolicyIds ?? [],
      observedFailureBuckets: verdict.observedFailureBuckets ?? [],
      error: verdict.ok ? undefined : `${fixture.id} expectation mismatch: expected ${verdict.expected}; got ${verdict.actual}`,
    };
  } catch (error) {
    const elapsed = performance.now() - started;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    return {
      repeat: repeatIndex,
      ok: false,
      durationMs: elapsed,
      expected: 'no exception',
      actual: message,
      workflowSucceeded: false,
      automaticActionIds: [],
      appliedPolicyIds: [],
      observedFailureBuckets: [],
      error: message,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {
    workflow,
    shared: {
      LogLevel,
      logger,
      ProjectType,
      DeployStatus,
      DeployTarget,
      RuntimeStatus,
      RuntimeErrorType,
      TestStatus,
      WorkflowStatus,
    },
  } = await loadDeps();

  logger.setLevel(LogLevel.Silent);

  const enums = {
    ProjectType,
    DeployStatus,
    DeployTarget,
    RuntimeStatus,
    RuntimeErrorType,
    TestStatus,
    WorkflowStatus,
  };

  const fixtures = buildFixtures({ workflow, enums });
  const fixtureRuns = [];

  for (const fixture of fixtures) {
    for (let repeat = 1; repeat <= args.repeats; repeat += 1) {
      const run = await runFixture(fixture, repeat);
      fixtureRuns.push({
        fixtureId: fixture.id,
        flow: fixture.flow,
        description: fixture.description,
        expectedWorkflowSuccess: fixture.expectedWorkflowSuccess,
        ...run,
      });
    }
  }

  const totalRuns = fixtureRuns.length;
  const passedRuns = fixtureRuns.filter((run) => run.ok).length;
  const failedRuns = totalRuns - passedRuns;
  const overallSuccessRate = totalRuns === 0 ? 0 : passedRuns / totalRuns;
  const allLatencies = computeStats(fixtureRuns.map((run) => run.durationMs));

  const fixtureSummaries = fixtures.map((fixture) => {
    const runs = fixtureRuns.filter((run) => run.fixtureId === fixture.id);
    const passed = runs.filter((run) => run.ok).length;
    const failed = runs.length - passed;
    const successRate = runs.length === 0 ? 0 : passed / runs.length;
    const latency = computeStats(runs.map((run) => run.durationMs));
    return {
      id: fixture.id,
      flow: fixture.flow,
      description: fixture.description,
      runs: runs.length,
      passed,
      failed,
      successRate: round(successRate, 4),
      latency: {
        min: round(latency.min),
        p50: round(latency.p50),
        p95: round(latency.p95),
        avg: round(latency.avg),
        max: round(latency.max),
      },
    };
  });

  const flowSummaries = ['build', 'fix', 'test', 'deploy'].map((flow) => {
    const runs = fixtureRuns.filter((run) => run.flow === flow && run.expectedWorkflowSuccess);
    const passed = runs.filter((run) => run.workflowSucceeded).length;
    const successRate = runs.length === 0 ? 0 : passed / runs.length;
    return {
      flow,
      runs: runs.length,
      passed,
      failed: runs.length - passed,
      successRate: round(successRate, 4),
    };
  });

  const minFixtureSuccess = fixtureSummaries.reduce(
    (min, fixture) => Math.min(min, fixture.successRate),
    1,
  );
  const failures = buildFailureBuckets(fixtureRuns);
  const dependencyAutoActionFixture = fixtureSummaries.find((fixture) => fixture.id === 'fix_dependency_missing_auto_action');
  const compileErrorRepairFixture = fixtureSummaries.find((fixture) => fixture.id === 'fix_compile_error_single_repair');
  const deployValidationFixture = fixtureSummaries.find((fixture) => fixture.id === 'deploy_validation_failure');
  const dependencyAutoActionSuccessRate = dependencyAutoActionFixture?.successRate ?? 0;
  const compileErrorRepairSuccessRate = compileErrorRepairFixture?.successRate ?? 0;
  const deployValidationClassificationRate = deployValidationFixture?.successRate ?? 0;
  const dependencyAutoActionEvidenceRuns = fixtureRuns.filter((run) => (
    run.automaticActionIds.includes('auto-install-dependency-v1')
    && run.observedFailureBuckets.includes('runtime_dependency_missing')
  )).length;
  const compileErrorRepairEvidenceRuns = fixtureRuns.filter((run) => (
    run.appliedPolicyIds.includes('compile-error-v1')
    && run.observedFailureBuckets.includes('runtime_compile_error')
  )).length;
  const deployValidationEvidenceRuns = fixtureRuns.filter((run) => (
    run.failureBucket === 'deploy_validation_failed'
    && run.automaticActionIds.includes('deploy-config-preflight-v1')
  )).length;

  const report = {
    slug: 'workflow-fixtures',
    title: 'Workflow Fixture Eval',
    generatedAt: new Date().toISOString(),
    summary: 'Evaluates deterministic build/fix/test/deploy workflow fixtures with focused evidence for dependency auto actions, compile-error repair, and deploy validation classification.',
    meta: {
      repeats: args.repeats,
      fixtures: fixtures.length,
      totalRuns,
      strictMode: args.strict,
    },
    sections: [
      {
        title: 'Overview',
        metrics: {
          passedRuns,
          failedRuns,
          overallSuccessRate: round(overallSuccessRate, 4),
          minFixtureSuccessRate: round(minFixtureSuccess, 4),
        },
      },
      {
        title: 'Flow Success Rate',
        metrics: {
          buildSuccessRate: flowSummaries.find((item) => item.flow === 'build')?.successRate ?? 0,
          fixSuccessRate: flowSummaries.find((item) => item.flow === 'fix')?.successRate ?? 0,
          testSuccessRate: flowSummaries.find((item) => item.flow === 'test')?.successRate ?? 0,
          deploySuccessRate: flowSummaries.find((item) => item.flow === 'deploy')?.successRate ?? 0,
        },
      },
      {
        title: 'Automation Evidence',
        metrics: {
          dependencyAutoActionSuccessRate: round(dependencyAutoActionSuccessRate, 4),
          compileErrorRepairSuccessRate: round(compileErrorRepairSuccessRate, 4),
          deployValidationClassificationRate: round(deployValidationClassificationRate, 4),
          dependencyAutoActionEvidenceRuns,
          compileErrorRepairEvidenceRuns,
          deployValidationEvidenceRuns,
        },
      },
      {
        title: 'Latency (ms)',
        metrics: {
          min: round(allLatencies.min),
          p50: round(allLatencies.p50),
          p95: round(allLatencies.p95),
          avg: round(allLatencies.avg),
          max: round(allLatencies.max),
        },
      },
    ],
    fixtures: fixtureSummaries,
    failures,
    acceptance: [
      {
        label: 'Overall success rate',
        target: `>= ${args.minOverallSuccessRate}`,
        actual: `${round(overallSuccessRate, 4)}`,
        pass: overallSuccessRate >= args.minOverallSuccessRate,
      },
      {
        label: 'Per-fixture minimum success rate',
        target: `>= ${args.minFixtureSuccessRate}`,
        actual: `${round(minFixtureSuccess, 4)}`,
        pass: minFixtureSuccess >= args.minFixtureSuccessRate,
      },
      {
        label: 'Dependency auto-action fixture success rate',
        target: `>= ${args.minFixtureSuccessRate}`,
        actual: `${round(dependencyAutoActionSuccessRate, 4)}`,
        pass: dependencyAutoActionSuccessRate >= args.minFixtureSuccessRate,
      },
      {
        label: 'Compile-error repair fixture success rate',
        target: `>= ${args.minFixtureSuccessRate}`,
        actual: `${round(compileErrorRepairSuccessRate, 4)}`,
        pass: compileErrorRepairSuccessRate >= args.minFixtureSuccessRate,
      },
      {
        label: 'Deploy validation classification rate',
        target: `>= ${args.minFixtureSuccessRate}`,
        actual: `${round(deployValidationClassificationRate, 4)}`,
        pass: deployValidationClassificationRate >= args.minFixtureSuccessRate,
      },
      {
        label: 'No unexpected fixture failures',
        target: '0 failures',
        actual: `${failedRuns}`,
        pass: failedRuns === 0,
      },
    ],
  };

  const { jsonPath, markdownPath } = writeEvalReport('workflow-fixtures', report);
  process.stdout.write(`workflow eval written:\n- ${path.relative(repoRoot, jsonPath)}\n- ${path.relative(repoRoot, markdownPath)}\n`);

  if (args.strict && report.acceptance.some((item) => !item.pass)) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
