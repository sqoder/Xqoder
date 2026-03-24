import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hasRepoHygieneIssues, inspectRepoHygiene, requiredIgnorePatterns } from './verify-repo-hygiene.mjs';

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function initRepo() {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'xqoder-repo-hygiene-'));
  runGit(repoRoot, ['init']);
  runGit(repoRoot, ['config', 'user.name', 'XQoder Test']);
  runGit(repoRoot, ['config', 'user.email', 'xqoder@example.com']);
  writeFileSync(path.join(repoRoot, '.gitignore'), `${requiredIgnorePatterns.join('\n')}\n`, 'utf8');
  return repoRoot;
}

test('inspectRepoHygiene passes for a clean repo with required ignores', () => {
  const repoRoot = initRepo();
  try {
    const report = inspectRepoHygiene({ repoRoot });
    assert.equal(hasRepoHygieneIssues(report), false);
    assert.deepEqual(report.missingPatterns, []);
    assert.deepEqual(report.forbiddenTrackedFiles, []);
    assert.deepEqual(report.dirtyGeneratedArtifacts, {
      staged: [],
      unstaged: [],
      untracked: [],
    });
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('inspectRepoHygiene catches forbidden tracked artifacts', () => {
  const repoRoot = initRepo();
  try {
    const generatedPath = path.join(repoRoot, '.pnpm-store', 'v10', 'files', 'demo.txt');
    mkdirSync(path.dirname(generatedPath), { recursive: true });
    writeFileSync(generatedPath, 'cached dependency\n', 'utf8');

    runGit(repoRoot, ['add', '.gitignore']);
    runGit(repoRoot, ['add', '-f', '.pnpm-store/v10/files/demo.txt']);
    runGit(repoRoot, ['commit', '-m', 'seed forbidden artifact']);

    const report = inspectRepoHygiene({ repoRoot });
    assert.equal(hasRepoHygieneIssues(report), true);
    assert.deepEqual(report.forbiddenTrackedFiles, ['.pnpm-store/v10/files/demo.txt']);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('inspectRepoHygiene catches staged deletion of forbidden generated artifacts', () => {
  const repoRoot = initRepo();
  try {
    const generatedPath = path.join(repoRoot, '.pnpm-store', 'v10', 'files', 'demo.txt');
    mkdirSync(path.dirname(generatedPath), { recursive: true });
    writeFileSync(generatedPath, 'cached dependency\n', 'utf8');

    runGit(repoRoot, ['add', '.gitignore']);
    runGit(repoRoot, ['add', '-f', '.pnpm-store/v10/files/demo.txt']);
    runGit(repoRoot, ['commit', '-m', 'seed forbidden artifact']);
    runGit(repoRoot, ['rm', '--cached', '.pnpm-store/v10/files/demo.txt']);

    const report = inspectRepoHygiene({ repoRoot });
    assert.equal(hasRepoHygieneIssues(report), true);
    assert.deepEqual(report.forbiddenTrackedFiles, []);
    assert.deepEqual(report.dirtyGeneratedArtifacts.staged, ['.pnpm-store/v10/files/demo.txt']);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
