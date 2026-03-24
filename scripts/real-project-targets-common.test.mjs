import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import {
  commandExists,
  evaluateRealProjectTargetReadiness,
  expandEnvTemplate,
  normalizeRealProjectTarget,
  readRealProjectTargets,
} from './real-project-targets-common.mjs';

test('expandEnvTemplate resolves ${VAR} placeholders', () => {
  assert.equal(
    expandEnvTemplate('${HOME}/code/demo', { HOME: '/tmp/example' }),
    '/tmp/example/code/demo',
  );
});

test('normalizeRealProjectTarget resolves checkoutRoot + projectPath', () => {
  const target = normalizeRealProjectTarget({
    id: 'opencode-app',
    checkoutRoot: '${HOME}/code/opencode-dev',
    projectPath: 'packages/app',
    repo: 'https://github.com/anomalyco/opencode',
  }, {
    manifestDir: '/workspace',
    env: { HOME: '/Users/tester' },
  });

  assert.equal(target.checkoutRoot, '/Users/tester/code/opencode-dev');
  assert.equal(target.projectRoot, '/Users/tester/code/opencode-dev/packages/app');
  assert.equal(target.projectPath, 'packages/app');
});

test('normalizeRealProjectTarget rejects projectPath traversal', () => {
  assert.throws(() => normalizeRealProjectTarget({
    checkoutRoot: '/workspace/demo',
    projectPath: '../outside',
  }, {
    manifestDir: '/workspace',
  }), /projectPath must stay within checkoutRoot/);
});

test('readRealProjectTargets accepts mixed direct and checkout-based targets', () => {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'xqoder-targets-'));
  try {
    const filePath = path.join(fixtureDir, 'targets.json');
    writeFileSync(filePath, JSON.stringify({
      projects: [
        {
          id: 'direct-root',
          projectRoot: './repo-a',
        },
        {
          id: 'subdir-root',
          checkoutRoot: './repo-b',
          projectPath: 'packages/core',
          ref: 'main',
          scenarios: ['test', 'build'],
          requiredCommands: ['node'],
          requiredEnv: ['DEMO_TOKEN'],
          requiredPaths: ['.env'],
          readinessChecks: [
            {
              label: 'env file present',
              command: 'test -f .env',
            },
          ],
          commandEnv: {
            DEMO_MODE: '${DEMO_TOKEN}',
          },
          deployBuildCommand: 'bun run build --single',
          deployOutputDir: 'dist/demo/bin',
        },
      ],
    }, null, 2));

    const targets = readRealProjectTargets(filePath, {
      env: {
        DEMO_TOKEN: 'present',
      },
    });
    assert.equal(targets.length, 2);
    assert.equal(targets[0].projectRoot, path.join(fixtureDir, 'repo-a'));
    assert.equal(targets[1].checkoutRoot, path.join(fixtureDir, 'repo-b'));
    assert.equal(targets[1].projectRoot, path.join(fixtureDir, 'repo-b', 'packages/core'));
    assert.equal(targets[1].ref, 'main');
    assert.deepEqual(targets[1].scenarios, ['test', 'build']);
    assert.deepEqual(targets[1].requiredCommands, ['node']);
    assert.deepEqual(targets[1].requiredEnv, ['DEMO_TOKEN']);
    assert.deepEqual(targets[1].requiredPaths, [path.join(fixtureDir, 'repo-b', 'packages/core', '.env')]);
    assert.deepEqual(targets[1].readinessChecks, [{ label: 'env file present', command: 'test -f .env' }]);
    assert.deepEqual(targets[1].commandEnv, { DEMO_MODE: 'present' });
    assert.equal(targets[1].deployBuildCommand, 'bun run build --single');
    assert.equal(targets[1].deployOutputDir, 'dist/demo/bin');
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('commandExists resolves executables from PATH', () => {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'xqoder-bin-'));
  try {
    const binDir = path.join(fixtureDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const commandPath = path.join(binDir, 'demo-tool');
    writeFileSync(commandPath, '#!/bin/sh\nexit 0\n');
    chmodSync(commandPath, 0o755);

    assert.equal(commandExists('demo-tool', { PATH: binDir }), true);
    assert.equal(commandExists('missing-tool', { PATH: binDir }), false);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('evaluateRealProjectTargetReadiness reports missing requirements', () => {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'xqoder-readiness-'));
  try {
    const repoDir = path.join(fixtureDir, 'repo');
    const binDir = path.join(fixtureDir, 'bin');
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const commandPath = path.join(binDir, 'demo-tool');
    writeFileSync(commandPath, '#!/bin/sh\nexit 0\n');
    chmodSync(commandPath, 0o755);
    writeFileSync(path.join(repoDir, '.env'), 'DEMO=1\n');

    const target = normalizeRealProjectTarget({
      projectRoot: './repo',
      requiredCommands: ['demo-tool'],
      requiredEnv: ['DEMO_TOKEN'],
      requiredPaths: ['.env'],
      readinessChecks: [
        {
          label: 'env file present',
          command: 'test -f .env',
        },
      ],
    }, {
      manifestDir: fixtureDir,
    });

    const ready = evaluateRealProjectTargetReadiness(target, {
      env: {
        PATH: binDir,
        DEMO_TOKEN: 'ok',
      },
    });
    assert.equal(ready.readiness, 'ready');
    assert.deepEqual(ready.blockers, []);

    const blocked = evaluateRealProjectTargetReadiness(target, {
      env: {
        PATH: binDir,
      },
    });
    assert.equal(blocked.readiness, 'blocked');
    assert.deepEqual(blocked.missingEnv, ['DEMO_TOKEN']);
    assert.deepEqual(blocked.missingCommands, []);
    assert.deepEqual(blocked.missingPaths, []);

    const failedCheck = evaluateRealProjectTargetReadiness({
      ...target,
      readinessChecks: [
        {
          label: 'missing marker',
          command: 'test -f does-not-exist',
        },
      ],
    }, {
      env: {
        PATH: binDir,
        DEMO_TOKEN: 'ok',
      },
    });
    assert.equal(failedCheck.readiness, 'blocked');
    assert.deepEqual(failedCheck.failedChecks, ['missing marker']);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
