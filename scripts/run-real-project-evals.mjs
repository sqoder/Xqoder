#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateRealProjectTargetReadiness, readRealProjectTargets } from './real-project-targets-common.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testEvalScript = path.join(repoRoot, 'scripts', 'run-real-project-test-eval.mjs');
const fixEvalScript = path.join(repoRoot, 'scripts', 'run-real-project-fix-eval.mjs');
const buildEvalScript = path.join(repoRoot, 'scripts', 'run-real-project-build-eval.mjs');
const deployEvalScript = path.join(repoRoot, 'scripts', 'run-real-project-deploy-eval.mjs');
const defaultTargetsPath = path.join(repoRoot, 'docs', 'evals', 'real-project-targets.json');
const defaultTimeoutMs = 15 * 60 * 1000;

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

  const scenarios = parseScenarioList(readValue('scenarios', 'test,fix,build,deploy'));
  const legacyRounds = readValue('rounds', '1');
  const testRounds = Number(readValue('test-rounds', legacyRounds));
  const fixRounds = Number(readValue('fix-rounds', scenarios.includes('fix') ? '1' : '0'));
  const buildRounds = Number(readValue('build-rounds', scenarios.includes('build') ? '1' : '0'));
  const deployRounds = Number(readValue('deploy-rounds', scenarios.includes('deploy') ? '1' : '0'));
  const prepareTimeoutMs = Number(readValue('prepare-timeout-ms', `${defaultTimeoutMs}`));
  return {
    scenarios,
    testRounds: Number.isFinite(testRounds) && testRounds > 0 ? Math.floor(testRounds) : 0,
    fixRounds: Number.isFinite(fixRounds) && fixRounds > 0 ? Math.floor(fixRounds) : 0,
    buildRounds: Number.isFinite(buildRounds) && buildRounds > 0 ? Math.floor(buildRounds) : 0,
    deployRounds: Number.isFinite(deployRounds) && deployRounds > 0 ? Math.floor(deployRounds) : 0,
    prepareEnabled: !argv.includes('--no-prepare'),
    prepareTimeoutMs: Number.isFinite(prepareTimeoutMs) && prepareTimeoutMs > 0 ? Math.floor(prepareTimeoutMs) : defaultTimeoutMs,
    reportsEnabled: !argv.includes('--no-reports'),
    targetsPath: path.resolve(readValue('targets', defaultTargetsPath)),
    json: argv.includes('--json'),
  };
}

function parseScenarioList(input) {
  const parsed = String(input ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value === 'test' || value === 'fix' || value === 'build' || value === 'deploy');

  return parsed.length > 0 ? [...new Set(parsed)] : ['test', 'fix', 'build', 'deploy'];
}

function runNodeCommand(commandArgs, cwd = repoRoot, timeout = defaultTimeoutMs, extraEnv = {}) {
  const startedAt = Date.now();
  try {
    execFileSync(process.execPath, commandArgs, {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        ...extraEnv,
        NODE_NO_WARNINGS: '1',
      },
      timeout,
    });
    return {
      success: true,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stdout: error?.stdout?.toString?.() ?? '',
      stderr: error?.stderr?.toString?.() ?? '',
      exitCode: error?.status,
    };
  }
}

function runShellCommand(command, cwd, timeout = defaultTimeoutMs, extraEnv = {}) {
  const startedAt = Date.now();
  try {
    execFileSync('sh', ['-c', command], {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        ...extraEnv,
        NODE_NO_WARNINGS: '1',
      },
      timeout,
    });
    return {
      success: true,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stdout: error?.stdout?.toString?.() ?? '',
      stderr: error?.stderr?.toString?.() ?? '',
      exitCode: error?.status,
    };
  }
}

function runTestForTarget(target) {
  return runNodeCommand([
    testEvalScript,
    '--dir',
    target.projectRoot,
    ...(target.testCommand ? ['--command', target.testCommand] : []),
  ], repoRoot, defaultTimeoutMs, target.commandEnv ?? {});
}

function runFixForTarget(target) {
  return runNodeCommand([
    fixEvalScript,
    '--dir',
    target.projectRoot,
    ...(target.testCommand ? ['--test-command', target.testCommand] : []),
  ], repoRoot, defaultTimeoutMs, target.commandEnv ?? {});
}

function runBuildForTarget(target) {
  return runNodeCommand([
    buildEvalScript,
    '--dir',
    target.projectRoot,
    ...(target.testCommand ? ['--test-command', target.testCommand] : []),
  ], repoRoot, defaultTimeoutMs, target.commandEnv ?? {});
}

function runDeployForTarget(target) {
  return runNodeCommand([
    deployEvalScript,
    '--dir',
    target.projectRoot,
    ...(target.deployBuildCommand ? ['--build-command', target.deployBuildCommand] : []),
    ...(target.deployOutputDir ? ['--output-dir', target.deployOutputDir] : []),
  ], repoRoot, defaultTimeoutMs, target.commandEnv ?? {});
}

function runPrepareForTarget(target, timeout) {
  if (!target.prepareCommand) {
    return {
      success: true,
      durationMs: 0,
      skipped: true,
    };
  }

  return runShellCommand(target.prepareCommand, target.projectRoot, timeout, target.commandEnv ?? {});
}

function hasStructuralReadinessBlockers(readiness) {
  return !readiness.projectExists
    || (readiness.enabled && readiness.readiness === 'sync-needed')
    || readiness.missingCommands.length > 0
    || readiness.missingEnv.length > 0
    || readiness.missingPaths.length > 0;
}

function generateReports(targetsPath) {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-real-project-eval-report.mjs'), '--targets', targetsPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
  });
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-quality-reports.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
  });
}

function printSummary(results, args) {
  const total = results.length;
  const passed = results.filter((result) => result.success).length;
  const failed = total - passed;
  const avgDurationMs = total === 0
    ? 0
    : Math.round(results.reduce((sum, result) => sum + result.durationMs, 0) / total);

  process.stdout.write([
    '',
    'Real project eval run summary',
    `- scenarios: ${args.scenarios.join(', ')}`,
    `- test rounds: ${args.testRounds}`,
    `- fix rounds: ${args.fixRounds}`,
    `- build rounds: ${args.buildRounds}`,
    `- deploy rounds: ${args.deployRounds}`,
    `- total runs: ${total}`,
    `- passed: ${passed}`,
    `- failed: ${failed}`,
    `- avg duration: ${avgDurationMs}ms`,
    '',
  ].join('\n'));

  const scenarioSummaries = [...new Set(results.map((result) => result.scenario))]
    .map((scenario) => {
      const scenarioResults = results.filter((result) => result.scenario === scenario);
      const scenarioPassed = scenarioResults.filter((result) => result.success).length;
      return {
        scenario,
        totalRuns: scenarioResults.length,
        passed: scenarioPassed,
        failed: scenarioResults.length - scenarioPassed,
      };
    });

  if (scenarioSummaries.length > 0) {
    process.stdout.write('By scenario:\n');
    for (const summary of scenarioSummaries) {
      process.stdout.write(`- ${summary.scenario}: ${summary.passed}/${summary.totalRuns} passed (${summary.failed} failed)\n`);
    }
    process.stdout.write('\n');
  }

  if (failed > 0) {
    process.stdout.write('Failed runs:\n');
    for (const result of results.filter((entry) => !entry.success)) {
      process.stdout.write(`- ${result.label} ${result.scenario} round ${result.round}: ${result.error ?? 'unknown error'}\n`);
    }
    process.stdout.write('\n');
  }
}

const args = parseArgs(process.argv.slice(2));
const targets = readRealProjectTargets(args.targetsPath);
const results = [];

for (const target of targets) {
  const targetScenarios = Array.isArray(target.scenarios) && target.scenarios.length > 0
    ? args.scenarios.filter((scenario) => target.scenarios.includes(scenario))
    : args.scenarios;
  process.stdout.write(`\n== ${target.label} ==\n`);
  if (target.enabled === false) {
    process.stdout.write(`SKIP ${target.label} (disabled target)\n`);
    continue;
  }
  if (targetScenarios.length === 0) {
    process.stdout.write(`SKIP ${target.label} (no matching scenarios)\n`);
    continue;
  }

  let readiness = evaluateRealProjectTargetReadiness(target);
  if (readiness.readiness !== 'ready' && (!args.prepareEnabled || !target.prepareCommand || hasStructuralReadinessBlockers(readiness))) {
    process.stdout.write(`SKIP ${target.label} (unready target: ${readiness.blockers.join('; ') || readiness.readiness})\n`);
    continue;
  }

  if (args.prepareEnabled) {
    const prepareResult = runPrepareForTarget(target, args.prepareTimeoutMs);
    if (!prepareResult.skipped) {
      results.push({
        targetId: target.id,
        label: target.label,
        projectRoot: target.projectRoot,
        scenario: 'prepare',
        round: 1,
        ...prepareResult,
      });
      process.stdout.write(`${prepareResult.success ? 'PASS' : 'FAIL'} ${target.label} prepare (${prepareResult.durationMs}ms)\n`);
    }
    if (!prepareResult.success) {
      process.stdout.write(`Skipping scenarios for ${target.label} because prepare failed.\n`);
      continue;
    }

    readiness = evaluateRealProjectTargetReadiness(target);
    if (readiness.readiness !== 'ready') {
      process.stdout.write(`SKIP ${target.label} (unready target after prepare: ${readiness.blockers.join('; ') || readiness.readiness})\n`);
      continue;
    }
  }

  if (targetScenarios.includes('test')) {
    for (let round = 1; round <= args.testRounds; round += 1) {
      process.stdout.write(`Running test round ${round}/${args.testRounds} for ${target.projectRoot}\n`);
      const result = runTestForTarget(target);
      results.push({
        targetId: target.id,
        label: target.label,
        projectRoot: target.projectRoot,
        scenario: 'test',
        round,
        ...result,
      });
      process.stdout.write(`${result.success ? 'PASS' : 'FAIL'} ${target.label} test round ${round} (${result.durationMs}ms)\n`);
    }
  }

  if (targetScenarios.includes('fix')) {
    for (let round = 1; round <= args.fixRounds; round += 1) {
      process.stdout.write(`Running fix round ${round}/${args.fixRounds} for ${target.projectRoot}\n`);
      const result = runFixForTarget(target);
      results.push({
        targetId: target.id,
        label: target.label,
        projectRoot: target.projectRoot,
        scenario: 'fix',
        round,
        ...result,
      });
      process.stdout.write(`${result.success ? 'PASS' : 'FAIL'} ${target.label} fix round ${round} (${result.durationMs}ms)\n`);
    }
  }

  if (targetScenarios.includes('build')) {
    for (let round = 1; round <= args.buildRounds; round += 1) {
      process.stdout.write(`Running build round ${round}/${args.buildRounds} for ${target.projectRoot}\n`);
      const result = runBuildForTarget(target);
      results.push({
        targetId: target.id,
        label: target.label,
        projectRoot: target.projectRoot,
        scenario: 'build',
        round,
        ...result,
      });
      process.stdout.write(`${result.success ? 'PASS' : 'FAIL'} ${target.label} build round ${round} (${result.durationMs}ms)\n`);
    }
  }

  if (targetScenarios.includes('deploy')) {
    for (let round = 1; round <= args.deployRounds; round += 1) {
      process.stdout.write(`Running deploy round ${round}/${args.deployRounds} for ${target.projectRoot}\n`);
      const result = runDeployForTarget(target);
      results.push({
        targetId: target.id,
        label: target.label,
        projectRoot: target.projectRoot,
        scenario: 'deploy',
        round,
        ...result,
      });
      process.stdout.write(`${result.success ? 'PASS' : 'FAIL'} ${target.label} deploy round ${round} (${result.durationMs}ms)\n`);
    }
  }
}

printSummary(results, args);
if (args.reportsEnabled) {
  generateReports(args.targetsPath);
} else {
  process.stdout.write('Skipping report generation (--no-reports)\n');
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    scenarios: args.scenarios,
    testRounds: args.testRounds,
    fixRounds: args.fixRounds,
    buildRounds: args.buildRounds,
    deployRounds: args.deployRounds,
    prepareEnabled: args.prepareEnabled,
    prepareTimeoutMs: args.prepareTimeoutMs,
    reportsEnabled: args.reportsEnabled,
    targets,
    results,
  }, null, 2)}\n`);
}

if (results.some((result) => !result.success)) {
  process.exit(1);
}
