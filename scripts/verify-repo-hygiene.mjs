#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitignorePathName = '.gitignore';

export const requiredIgnorePatterns = [
  '.pnpm-store/',
  '.xqoder/',
  'packages/**/target/',
];

export function isForbiddenGeneratedPath(filePath) {
  return filePath.startsWith('.pnpm-store/')
    || filePath.startsWith('.xqoder/')
    || /^packages\/[^/]+\/target\//.test(filePath);
}

function runGit(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function readNullSeparatedGitPaths(repoRoot, args) {
  return runGit(repoRoot, args)
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueSorted(paths) {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

export function inspectRepoHygiene(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const gitignorePath = path.join(repoRoot, gitignorePathName);
  const gitignore = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';

  const missingPatterns = requiredIgnorePatterns.filter((pattern) => !gitignore
    .split('\n')
    .some((line) => line.trim() === pattern));

  const trackedFiles = readNullSeparatedGitPaths(repoRoot, ['ls-files', '-z']);
  const stagedFiles = readNullSeparatedGitPaths(repoRoot, ['diff', '--cached', '--name-only', '-z']);
  const unstagedFiles = readNullSeparatedGitPaths(repoRoot, ['diff', '--name-only', '-z']);
  const untrackedFiles = readNullSeparatedGitPaths(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);

  return {
    repoRoot,
    missingPatterns,
    forbiddenTrackedFiles: uniqueSorted(trackedFiles.filter(isForbiddenGeneratedPath)),
    dirtyGeneratedArtifacts: {
      staged: uniqueSorted(stagedFiles.filter(isForbiddenGeneratedPath)),
      unstaged: uniqueSorted(unstagedFiles.filter(isForbiddenGeneratedPath)),
      untracked: uniqueSorted(untrackedFiles.filter(isForbiddenGeneratedPath)),
    },
  };
}

export function hasRepoHygieneIssues(report) {
  return report.missingPatterns.length > 0
    || report.forbiddenTrackedFiles.length > 0
    || report.dirtyGeneratedArtifacts.staged.length > 0
    || report.dirtyGeneratedArtifacts.unstaged.length > 0
    || report.dirtyGeneratedArtifacts.untracked.length > 0;
}

function printPathSamples(paths) {
  for (const filePath of paths.slice(0, 20)) {
    process.stderr.write(`- ${filePath}\n`);
  }
  if (paths.length > 20) {
    process.stderr.write(`- ... ${paths.length - 20} more\n`);
  }
}

function printDirtySection(label, paths) {
  if (paths.length === 0) {
    return;
  }
  process.stderr.write(`${label} (${paths.length}):\n`);
  printPathSamples(paths);
}

export function printRepoHygieneIssues(report) {
  if (report.missingPatterns.length > 0) {
    process.stderr.write('Missing required .gitignore patterns:\n');
    for (const pattern of report.missingPatterns) {
      process.stderr.write(`- ${pattern}\n`);
    }
  }

  if (report.forbiddenTrackedFiles.length > 0) {
    if (report.missingPatterns.length > 0) {
      process.stderr.write('\n');
    }
    process.stderr.write(`Tracked generated artifacts detected (${report.forbiddenTrackedFiles.length}):\n`);
    printPathSamples(report.forbiddenTrackedFiles);
  }

  const dirty = report.dirtyGeneratedArtifacts;
  if (dirty.staged.length > 0 || dirty.unstaged.length > 0 || dirty.untracked.length > 0) {
    if (report.missingPatterns.length > 0 || report.forbiddenTrackedFiles.length > 0) {
      process.stderr.write('\n');
    }
    process.stderr.write('Dirty generated artifacts detected:\n');
    printDirtySection('Staged', dirty.staged);
    printDirtySection('Unstaged', dirty.unstaged);
    printDirtySection('Untracked', dirty.untracked);
  }
}

export function verifyRepoHygiene(options = {}) {
  const report = inspectRepoHygiene(options);
  if (hasRepoHygieneIssues(report)) {
    printRepoHygieneIssues(report);
    process.exitCode = 1;
    return report;
  }

  process.stdout.write('✓ repository hygiene verified (.gitignore + tracked/generated artifact cleanliness)\n');
  return report;
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  verifyRepoHygiene();
}
