import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBaseRefCandidates = ['origin/main', 'origin/master', 'main', 'master'];

const areaDefinitions = [
  {
    id: 'skills-vendoring',
    label: 'Skills vendoring',
    matches(filePath) {
      return filePath.startsWith('.agents/skills/')
        || filePath.startsWith('.codex/skills/');
    },
  },
  {
    id: 'ci-workflows',
    label: 'CI workflows',
    matches(filePath) {
      return filePath.startsWith('.github/workflows/');
    },
  },
  {
    id: 'generated-artifacts',
    label: 'Generated artifacts',
    matches(filePath) {
      return filePath.startsWith('.pnpm-store/')
        || filePath.startsWith('.xqoder/')
        || /^packages\/[^/]+\/target\//.test(filePath);
    },
  },
  {
    id: 'release-governance',
    label: 'Release governance',
    matches(filePath) {
      return filePath.startsWith('docs/artifacts/release/')
        || filePath === 'docs/quality-report.md'
        || filePath.startsWith('scripts/release/')
        || filePath === 'scripts/capture-release-plans.mjs'
        || filePath === 'scripts/generate-quality-reports.mjs'
        || filePath === 'scripts/quality-report-common.mjs'
        || filePath === 'scripts/quality-report-common.test.mjs'
        || filePath === 'scripts/release-check-strict.mjs'
        || filePath === 'scripts/report-release-state.mjs'
        || filePath === 'scripts/report-workflow-parity.mjs'
        || filePath === 'scripts/verify-release-prepare.mjs'
        || filePath === 'scripts/verify-repo-hygiene.mjs'
        || filePath === 'scripts/verify-repo-hygiene.test.mjs'
        || filePath === 'scripts/verify-ship-scope.mjs'
        || filePath === 'scripts/ship-scope-common.mjs'
        || filePath === 'scripts/ship-scope-common.test.mjs';
    },
  },
  {
    id: 'quality-evidence',
    label: 'Quality evidence',
    matches(filePath) {
      return filePath.startsWith('docs/benchmarks/')
        || filePath.startsWith('docs/evals/')
        || filePath === 'docs/opencode-comparison.md'
        || filePath.startsWith('scripts/benchmark-')
        || filePath === 'scripts/eval-workflow-fixtures.mjs'
        || filePath === 'scripts/golden-test.mjs'
        || filePath.startsWith('scripts/run-real-project-')
        || filePath === 'scripts/generate-real-project-eval-report.mjs'
        || filePath === 'scripts/real-project-eval-report-common.mjs'
        || filePath === 'scripts/real-project-targets-common.mjs'
        || filePath === 'scripts/real-project-targets-common.test.mjs'
        || filePath.startsWith('scripts/capture-week')
        || filePath === 'scripts/verify-day30-gates.mjs'
        || filePath === 'scripts/verify-session-lifecycle.mjs'
        || filePath === 'scripts/verify-session-recovery.mjs'
        || filePath === 'scripts/verify-tui-visual.mjs'
        || filePath === 'scripts/verify-week4-navigation.mjs'
        || filePath === 'scripts/verify-week5-interaction.mjs'
        || filePath === 'scripts/verify-week5-tool-toggle.mjs'
        || filePath === 'scripts/verify-week6-stability-report.mjs';
    },
  },
  {
    id: 'terminal-surface',
    label: 'Terminal surface',
    matches(filePath) {
      return filePath.startsWith('packages/cli/src/tui/')
        || filePath.startsWith('packages/cli/src/terminal-app/')
        || filePath.startsWith('packages/cli/src/terminal-core/')
        || filePath.startsWith('packages/client/')
        || filePath.startsWith('packages/daemon/')
        || filePath.startsWith('packages/gui-electron/')
        || filePath.startsWith('packages/renderer/');
    },
  },
  {
    id: 'automation-runtime',
    label: 'Automation/runtime',
    matches(filePath) {
      return filePath.startsWith('packages/agent/')
        || filePath.startsWith('packages/runtime/')
        || filePath.startsWith('packages/workflow/')
        || filePath.startsWith('packages/storage-sqlite/')
        || filePath.startsWith('packages/shared/')
        || filePath.startsWith('packages/protocol/')
        || filePath.startsWith('packages/llm-api/')
        || filePath.startsWith('packages/permissions/')
        || filePath.startsWith('packages/plugin-sdk/')
        || filePath.startsWith('packages/provider-')
        || filePath.startsWith('packages/deploy/')
        || filePath.startsWith('packages/core-runtime/')
        || filePath.startsWith('packages/cli/src/commands/')
        || filePath.startsWith('packages/cli/src/services/')
        || filePath.startsWith('packages/cli/src/server/')
        || filePath.startsWith('packages/cli/src/parity/')
        || filePath === 'packages/cli/src/program.ts'
        || filePath === 'packages/cli/src/program.test.ts'
        || filePath === 'packages/cli/src/session-assets.ts'
        || filePath === 'packages/cli/src/command-plugins.ts'
        || filePath === 'packages/cli/src/command-plugins.test.ts'
        || filePath === 'packages/cli/src/cli.main-path.smoke.test.ts'
        || filePath === 'packages/cli/package.json';
    },
  },
  {
    id: 'docs-strategy',
    label: 'Docs and strategy',
    matches(filePath) {
      return filePath.startsWith('docs/');
    },
  },
  {
    id: 'root-packaging',
    label: 'Root packaging',
    matches(filePath) {
      return filePath === 'package.json'
        || filePath === 'pnpm-lock.yaml'
        || filePath === 'README.md'
        || filePath === 'index.html';
    },
  },
  {
    id: 'misc',
    label: 'Miscellaneous',
    matches() {
      return true;
    },
  },
];

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

export function uniqueSorted(paths) {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

export function classifyShipScopePath(filePath) {
  for (const definition of areaDefinitions) {
    if (definition.matches(filePath)) {
      return definition.id;
    }
  }
  return 'misc';
}

export function resolveBaseRef(repoRoot, candidates = defaultBaseRefCandidates) {
  for (const candidate of candidates) {
    try {
      runGit(repoRoot, ['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function createAreaReport(paths) {
  const pathsByArea = new Map();
  for (const filePath of paths) {
    const areaId = classifyShipScopePath(filePath);
    const bucket = pathsByArea.get(areaId) ?? [];
    bucket.push(filePath);
    pathsByArea.set(areaId, bucket);
  }

  return areaDefinitions
    .map((definition) => {
      const areaPaths = uniqueSorted(pathsByArea.get(definition.id) ?? []);
      return {
        id: definition.id,
        label: definition.label,
        count: areaPaths.length,
        samples: areaPaths.slice(0, 8),
      };
    })
    .filter((area) => area.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });
}

export function analyzeShipScope(pathsBySource, options = {}) {
  const normalizedBySource = {
    branch: uniqueSorted(pathsBySource.branch ?? []),
    staged: uniqueSorted(pathsBySource.staged ?? []),
    unstaged: uniqueSorted(pathsBySource.unstaged ?? []),
    untracked: uniqueSorted(pathsBySource.untracked ?? []),
  };

  const totalPaths = uniqueSorted([
    ...normalizedBySource.branch,
    ...normalizedBySource.staged,
    ...normalizedBySource.unstaged,
    ...normalizedBySource.untracked,
  ]);
  const areas = createAreaReport(totalPaths);

  const thresholds = {
    maxPaths: options.maxPaths ?? 160,
    maxSignificantAreas: options.maxSignificantAreas ?? 4,
    significantAreaMinPaths: options.significantAreaMinPaths ?? 5,
    maxPathsForEvidenceMix: options.maxPathsForEvidenceMix ?? 40,
  };

  const significantAreas = areas.filter((area) => area.id !== 'misc' && area.count >= thresholds.significantAreaMinPaths);
  const significantAreaIds = new Set(significantAreas.map((area) => area.id));
  const productAreas = significantAreas.filter((area) => area.id === 'terminal-surface' || area.id === 'automation-runtime');
  const issues = [];

  if (significantAreaIds.has('skills-vendoring')) {
    issues.push({
      id: 'skills-vendoring-present',
      severity: 'error',
      message: 'Detected vendored skill/tooling content in the candidate PR scope. Keep local agent assets out of the repo diff.',
    });
  }

  if (significantAreaIds.has('generated-artifacts')) {
    issues.push({
      id: 'generated-artifacts-present',
      severity: 'error',
      message: 'Detected generated artifact paths in the candidate PR scope. Keep cache/build output out of reviewable commits.',
    });
  }

  if (productAreas.length > 1) {
    issues.push({
      id: 'mixed-product-areas',
      severity: 'error',
      message: 'Detected more than one major product area in scope. Split terminal-surface changes from automation/runtime changes before shipping.',
    });
  }

  const evidenceAreas = ['release-governance', 'quality-evidence', 'ci-workflows'];
  const mixedEvidenceAreas = evidenceAreas.filter((areaId) => significantAreaIds.has(areaId));
  if (productAreas.length > 0 && mixedEvidenceAreas.length > 0 && totalPaths.length > thresholds.maxPathsForEvidenceMix) {
    issues.push({
      id: 'evidence-mixed-with-product',
      severity: 'error',
      message: `Detected product code mixed with ${mixedEvidenceAreas.join(', ')} changes in one ship scope. Refresh evidence after the product slice is isolated.`,
    });
  }

  if (significantAreas.length > thresholds.maxSignificantAreas) {
    issues.push({
      id: 'too-many-areas',
      severity: 'error',
      message: `Detected ${significantAreas.length} significant change areas (limit ${thresholds.maxSignificantAreas}). Narrow the branch before opening a PR.`,
    });
  }

  if (totalPaths.length > thresholds.maxPaths) {
    issues.push({
      id: 'too-many-paths',
      severity: 'error',
      message: `Detected ${totalPaths.length} changed paths in candidate ship scope (limit ${thresholds.maxPaths}). This is too large for a safe review.`,
    });
  }

  return {
    baseRef: options.baseRef ?? null,
    thresholds,
    counts: {
      branch: normalizedBySource.branch.length,
      staged: normalizedBySource.staged.length,
      unstaged: normalizedBySource.unstaged.length,
      untracked: normalizedBySource.untracked.length,
      total: totalPaths.length,
    },
    areas,
    issues,
  };
}

export function inspectShipScope(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const baseRef = options.baseRef ?? resolveBaseRef(repoRoot);
  const branchPaths = baseRef
    ? readNullSeparatedGitPaths(repoRoot, ['diff', '--name-only', '-z', `${baseRef}...HEAD`])
    : [];
  const stagedPaths = readNullSeparatedGitPaths(repoRoot, ['diff', '--cached', '--name-only', '-z']);
  const unstagedPaths = readNullSeparatedGitPaths(repoRoot, ['diff', '--name-only', '-z']);
  const untrackedPaths = readNullSeparatedGitPaths(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);

  return {
    repoRoot,
    ...analyzeShipScope({
      branch: branchPaths,
      staged: stagedPaths,
      unstaged: unstagedPaths,
      untracked: untrackedPaths,
    }, {
      ...options,
      baseRef,
    }),
  };
}

export function hasShipScopeIssues(report) {
  return report.issues.length > 0;
}

export function printShipScopeReport(report) {
  process.stdout.write('Ship Scope Summary\n');
  if (report.baseRef) {
    process.stdout.write(`Base ref: ${report.baseRef}\n`);
  } else {
    process.stdout.write('Base ref: unavailable (analyzing worktree only)\n');
  }
  process.stdout.write(
    `Changed paths: total=${report.counts.total}, branch=${report.counts.branch}, staged=${report.counts.staged}, unstaged=${report.counts.unstaged}, untracked=${report.counts.untracked}\n`,
  );

  process.stdout.write('\nAreas\n');
  for (const area of report.areas) {
    process.stdout.write(`- ${area.label} (${area.count})\n`);
    for (const sample of area.samples) {
      process.stdout.write(`  - ${sample}\n`);
    }
  }

  if (report.issues.length === 0) {
    process.stdout.write('\n✓ ship scope looks reviewable\n');
    return;
  }

  process.stderr.write('\nShip scope issues\n');
  for (const issue of report.issues) {
    process.stderr.write(`- ${issue.message}\n`);
  }
}
