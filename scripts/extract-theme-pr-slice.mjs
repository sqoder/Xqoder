#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectThemePrPlan,
  resolveThemeExtractionPaths,
  resolveThemeExtractionStack,
} from './theme-pr-plan-common.mjs';
import {
  applyThemeSliceOperations,
  buildThemeSliceOperations,
} from './theme-pr-extract-common.mjs';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(args.repoRoot ?? defaultRepoRoot);
const report = inspectThemePrPlan({
  repoRoot,
  ...(args.baseRef ? { baseRef: args.baseRef } : {}),
});
const theme = report.themes.find((entry) => entry.id === args.themeId);

if (!theme) {
  process.stderr.write(`Unknown or empty theme id: ${args.themeId}\n`);
  process.exit(1);
}

if (theme.tier === 'noise') {
  process.stderr.write(`Theme ${theme.id} is marked as noise; extract a canonical/supporting slice instead.\n`);
  process.exit(1);
}

const targetRoot = path.resolve(args.targetRoot ?? path.join(path.dirname(repoRoot), `xqoder-${theme.id}`));
const extractionStack = resolveThemeExtractionStack(report, theme);
const operations = buildThemeSliceOperations({
  paths: resolveThemeExtractionPaths(report, theme),
}, repoRoot);

if (args.dryRun) {
  printSummary({
    report,
    theme,
    extractionStack,
    targetRoot,
    operations,
    dryRun: true,
  });
  process.exit(0);
}

prepareWorktree({
  repoRoot,
  targetRoot,
  baseRef: report.baseRef ?? 'origin/main',
  branchName: args.branchName ?? theme.branch ?? null,
  force: args.force,
});

applyThemeSliceOperations({
  operations,
  targetRoot,
});

printSummary({
  report,
  theme,
  extractionStack,
  targetRoot,
  operations,
  dryRun: false,
});

const status = spawnSync('git', ['-C', targetRoot, 'status', '--short'], {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});
if ((status.stdout ?? '').trim().length > 0) {
  process.stdout.write('\nTarget worktree status\n');
  process.stdout.write(status.stdout);
}

function prepareWorktree({ repoRoot, targetRoot, baseRef, branchName, force }) {
  const targetExists = fs.existsSync(targetRoot);
  if (targetExists) {
    const entries = fs.readdirSync(targetRoot);
    if (entries.length > 0 && !force) {
      process.stderr.write(`Target path already exists and is not empty: ${targetRoot}\n`);
      process.stderr.write('Pass --force to reuse an existing worktree directory.\n');
      process.exit(1);
    }
  }

  if (!targetExists || !fs.existsSync(path.join(targetRoot, '.git'))) {
    const addArgs = ['worktree', 'add', '--detach', targetRoot, baseRef];
    const add = spawnSync('git', addArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (add.status !== 0) {
      const output = `${add.stdout ?? ''}\n${add.stderr ?? ''}`.trim();
      process.stderr.write(`Failed to create worktree: ${output}\n`);
      process.exit(add.status ?? 1);
    }
  }

  if (branchName) {
    const branchExists = spawnSync('git', ['-C', targetRoot, 'rev-parse', '--verify', branchName], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (branchExists.status === 0) {
      const switchExisting = spawnSync('git', ['-C', targetRoot, 'switch', branchName], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (switchExisting.status !== 0) {
        const output = `${switchExisting.stdout ?? ''}\n${switchExisting.stderr ?? ''}`.trim();
        process.stderr.write(`Failed to switch existing branch ${branchName}: ${output}\n`);
        process.exit(switchExisting.status ?? 1);
      }
      return;
    }

    const createBranch = spawnSync('git', ['-C', targetRoot, 'switch', '-c', branchName], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (createBranch.status !== 0) {
      const output = `${createBranch.stdout ?? ''}\n${createBranch.stderr ?? ''}`.trim();
      process.stderr.write(`Failed to create branch ${branchName}: ${output}\n`);
      process.exit(createBranch.status ?? 1);
    }
  }
}

function printSummary({ report, theme, extractionStack, targetRoot, operations, dryRun }) {
  const copyCount = operations.filter((entry) => entry.action === 'copy').length;
  const deleteCount = operations.length - copyCount;
  process.stdout.write(`Theme slice ${dryRun ? 'dry-run' : 'prepared'}\n`);
  process.stdout.write(`- theme: ${theme.id}\n`);
  process.stdout.write(`- source branch: ${report.currentBranch ?? 'detached'}\n`);
  process.stdout.write(`- base ref: ${report.baseRef ?? 'unavailable'}\n`);
  if (extractionStack.length > 1) {
    process.stdout.write(`- includes prerequisites: ${extractionStack.map((entry) => entry.id).join(' -> ')}\n`);
  }
  process.stdout.write(`- target: ${targetRoot}\n`);
  process.stdout.write(`- suggested branch: ${theme.branch ?? 'n/a'}\n`);
  process.stdout.write(`- operations: copy=${copyCount}, delete=${deleteCount}, total=${operations.length}\n`);
  process.stdout.write(`- validation: ${theme.validation.join(' && ') || 'n/a'}\n`);
  process.stdout.write('- sample paths:\n');
  for (const sample of operations.slice(0, 12)) {
    process.stdout.write(`  - [${sample.action}] ${sample.path}\n`);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--theme') {
      options.themeId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--target') {
      options.targetRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--base') {
      options.baseRef = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--branch') {
      options.branchName = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--repo-root') {
      options.repoRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--force') {
      options.force = true;
    }
  }
  if (!options.themeId) {
    process.stderr.write('Usage: node ./scripts/extract-theme-pr-slice.mjs --theme <id> [--target <dir>] [--base <ref>] [--branch <name>] [--dry-run]\n');
    process.exit(1);
  }
  return options;
}
