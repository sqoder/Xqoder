import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBaseRefCandidates = ['origin/main', 'origin/master', 'main', 'master'];

const themeDefinitions = [
  {
    id: 'session-truth-source',
    label: 'Session truth-source',
    tier: 'canonical',
    branch: 'codex/session-truth-source',
    rationale: '聚焦 session snapshot 真相源、旧 API 退役和恢复链路边界。',
    validation: [
      'node ./scripts/verify-session-theme-boundary.mjs',
      'node ./scripts/verify-no-agent-compat-imports.mjs',
      'node ./scripts/verify-session-lifecycle.mjs',
    ],
    matches(filePath) {
      return filePath.startsWith('packages/agent/src/session/')
        || filePath === 'packages/agent/src/project-memory.ts'
        || filePath === 'packages/agent/src/project-memory.test.ts'
        || filePath === 'packages/agent/src/session.ts'
        || filePath.startsWith('packages/runtime/src/core/session-')
        || filePath === 'packages/runtime/src/core/runtime-kernel.contract.test.ts'
        || filePath === 'packages/shared/src/config-types.ts'
        || filePath === 'packages/shared/src/cost-calculator.ts'
        || filePath === 'packages/shared/src/custom-commands.ts'
        || filePath === 'packages/shared/src/deploy-types.ts'
        || filePath === 'packages/shared/src/index.ts'
        || filePath === 'packages/shared/src/llm-types.ts'
        || filePath === 'packages/shared/src/message-types.ts'
        || filePath === 'packages/shared/src/project-memory.ts'
        || filePath === 'packages/shared/src/project-permissions.ts'
        || filePath === 'packages/shared/src/project-types.ts'
        || filePath === 'packages/shared/src/runtime-types.ts'
        || filePath === 'packages/shared/src/test-types.ts'
        || filePath === 'packages/shared/src/tool-permissions.ts'
        || filePath === 'packages/shared/src/tool-types.ts'
        || filePath === 'packages/shared/src/workflow-types.ts'
        || filePath === 'packages/cli/src/session-assets.ts'
        || filePath === 'packages/cli/src/session-bundle.ts'
        || filePath === 'packages/cli/src/session-bundle.test.ts'
        || filePath.startsWith('packages/cli/src/commands/acp')
        || filePath.startsWith('packages/cli/src/commands/chat')
        || filePath.startsWith('packages/cli/src/commands/export')
        || filePath.startsWith('packages/cli/src/commands/import')
        || filePath.startsWith('packages/cli/src/commands/sessions')
        || filePath.startsWith('packages/cli/src/commands/share')
        || filePath.startsWith('packages/cli/src/commands/stats')
        || filePath === 'packages/cli/src/services/chat-service.ts'
        || filePath === 'packages/cli/src/services/session-resolve.ts'
        || filePath === 'packages/cli/src/services/session-resolve.test.ts'
        || filePath === 'packages/cli/src/services/runtime-session-kernel.ts'
        || filePath === 'packages/cli/src/services/runtime-session-kernel.test.ts'
        || filePath === 'packages/cli/src/services/chat-service.test.ts'
        || filePath.startsWith('scripts/verify-no-direct-get-session')
        || filePath.startsWith('scripts/verify-no-legacy-session')
        || filePath.startsWith('scripts/verify-no-agent-compat')
        || filePath.startsWith('scripts/verify-chat-session-store')
        || filePath === 'scripts/verify-session-lifecycle.mjs'
        || filePath === 'scripts/verify-session-theme-boundary.mjs';
    },
  },
  {
    id: 'terminal-boundary-cleanup',
    label: 'Terminal boundary cleanup',
    tier: 'canonical',
    branch: 'codex/terminal-boundary-cleanup',
    rationale: '聚焦 terminal-app / terminal-core / tui 主路径削薄与 typed contract 收口。',
    prerequisites: [
      'session-truth-source',
      'shared-contract-extraction',
      'storage-decoupling',
    ],
    validation: [
      'node ./scripts/verify-terminal-theme-slice.mjs',
    ],
    supportPaths: [
      'packages/cli/src/server/in-memory-client.ts',
      'scripts/postbuild-renderer.mjs',
    ],
    matches(filePath) {
      return filePath.startsWith('packages/cli/src/tui/')
        || filePath.startsWith('packages/cli/src/terminal-app/')
        || filePath.startsWith('packages/cli/src/terminal-core/')
        || filePath === 'packages/cli/src/attachment-references.ts'
        || filePath === 'packages/cli/src/context-references.ts'
        || filePath === 'packages/cli/src/commands/rollbacks.ts'
        || filePath === 'packages/cli/src/services/today-session-stats.ts'
        || filePath === 'packages/cli/package.json'
        || filePath === 'scripts/verify-terminal-theme-slice.mjs'
        || filePath.startsWith('packages/renderer/')
        || filePath.startsWith('packages/client/')
        || filePath.startsWith('packages/daemon/')
        || filePath.startsWith('packages/gui-electron/');
    },
  },
  {
    id: 'server-modularization',
    label: 'Server modularization',
    tier: 'canonical',
    branch: 'codex/server-modularization',
    rationale: '聚焦 CLI server 路由拆分、入口削薄和 server 集成回归。',
    validation: [
      'pnpm --filter @xqoder/cli typecheck',
      'pnpm --filter @xqoder/cli exec vitest run src/server/index.test.ts',
    ],
    matches(filePath) {
      return filePath.startsWith('packages/cli/src/server/');
    },
  },
  {
    id: 'storage-decoupling',
    label: 'Storage decoupling',
    tier: 'canonical',
    branch: 'codex/storage-decoupling',
    rationale: '聚焦 storage/runtime append 边界、DTO 收口和 runtime session backing-store 解耦。',
    prerequisites: [
      'session-truth-source',
      'shared-contract-extraction',
    ],
    supportPaths: [
      'scripts/benchmark-common.mjs',
      'scripts/quality-report-common.mjs',
      'scripts/real-project-eval-report-common.mjs',
      'scripts/real-project-targets-common.mjs',
      'scripts/verify-session-recovery.mjs',
    ],
    validation: [
      'node ./scripts/verify-storage-theme-slice.mjs',
    ],
    matches(filePath) {
      return filePath.startsWith('packages/storage-sqlite/')
        || filePath === 'packages/runtime/package.json'
        || filePath === 'packages/runtime/src/index.ts'
        || filePath.startsWith('packages/runtime/src/core/')
        || filePath === 'packages/cli/src/services/runtime-session-backing-store.ts'
        || filePath === 'scripts/verify-storage-theme-slice.mjs';
    },
  },
  {
    id: 'release-gate-hardening',
    label: 'Release gate hardening',
    tier: 'canonical',
    branch: 'codex/release-gate-hardening',
    rationale: '聚焦 strict gate、contract/session/terminal blocker、CI 串联与 release artifact 对齐。',
    prerequisites: [
      'session-truth-source',
      'terminal-boundary-cleanup',
      'storage-decoupling',
    ],
    validation: [
      'pnpm verify:contracts',
      'pnpm verify:terminal:main-path',
      'pnpm verify:release:blockers',
      'pnpm release:check:strict:dry-run',
    ],
    matches(filePath) {
      return filePath.startsWith('.github/workflows/')
        || filePath.startsWith('docs/artifacts/release/')
        || filePath.startsWith('docs/benchmarks/')
        || filePath.startsWith('docs/evals/')
        || filePath === 'docs/quality-report.md'
        || filePath === 'docs/opencode-comparison.md'
        || filePath === 'package.json'
        || filePath === 'scripts/capture-release-plans.mjs'
        || filePath === 'scripts/check-daemon-env.mjs'
        || filePath === 'scripts/generate-quality-reports.mjs'
        || filePath === 'scripts/quality-report-common.mjs'
        || filePath === 'scripts/quality-report-common.test.mjs'
        || filePath === 'scripts/release-check-strict.mjs'
        || filePath === 'scripts/report-release-state.mjs'
        || filePath === 'scripts/report-workflow-parity.mjs'
        || filePath === 'scripts/report-theme-pr-plan.mjs'
        || filePath === 'scripts/extract-theme-pr-slice.mjs'
        || filePath === 'scripts/theme-pr-plan-common.mjs'
        || filePath === 'scripts/theme-pr-plan-common.test.mjs'
        || filePath === 'scripts/theme-pr-extract-common.mjs'
        || filePath === 'scripts/theme-pr-extract-common.test.mjs'
        || filePath === 'scripts/verify-contract-gates.mjs'
        || filePath === 'scripts/verify-release-blockers.mjs'
        || filePath === 'scripts/verify-release-prepare.mjs'
        || filePath === 'scripts/verify-renderer-load.mjs'
        || filePath === 'scripts/verify-repo-hygiene.mjs'
        || filePath === 'scripts/verify-repo-hygiene.test.mjs'
        || filePath === 'scripts/verify-ship-scope.mjs'
        || filePath === 'scripts/ship-scope-common.mjs'
        || filePath === 'scripts/ship-scope-common.test.mjs'
        || filePath === 'scripts/verify-session-recovery.mjs'
        || filePath === 'scripts/verify-terminal-main-path.mjs'
        || filePath === 'scripts/verify-tui-visual.mjs'
        || filePath === 'scripts/verify-week4-navigation.mjs'
        || filePath === 'scripts/verify-week5-interaction.mjs'
        || filePath === 'scripts/verify-week5-tool-toggle.mjs'
        || filePath === 'scripts/golden-test.mjs'
        || filePath.startsWith('scripts/benchmark-')
        || filePath === 'scripts/eval-workflow-fixtures.mjs'
        || filePath.startsWith('scripts/run-real-project-')
        || filePath === 'scripts/generate-real-project-eval-report.mjs'
        || filePath === 'scripts/real-project-eval-report-common.mjs'
        || filePath === 'scripts/real-project-targets-common.mjs'
        || filePath === 'scripts/real-project-targets-common.test.mjs'
        || filePath.startsWith('scripts/capture-week');
    },
  },
  {
    id: 'shared-contract-extraction',
    label: 'Shared contract extraction',
    tier: 'supporting',
    branch: 'codex/shared-contract-extraction',
    rationale: '承接 Day 12 shared 配置/协议拆分与跨包消费面收口。',
    validation: [
      'pnpm --filter @xqoder/shared typecheck',
      'pnpm --filter @xqoder/shared exec vitest run src/config.test.ts src/tool-permissions.test.ts src/project-permissions.test.ts',
      'pnpm --filter @xqoder/shared build',
      'pnpm --filter @xqoder/agent typecheck',
      'pnpm --filter @xqoder/cli typecheck',
    ],
    matches(filePath) {
      return filePath.startsWith('packages/shared/')
        || filePath.startsWith('packages/protocol/')
        || filePath === 'packages/runtime/src/error-analyzer.ts'
        || filePath === 'packages/runtime/src/test-runner.ts'
        || filePath === 'packages/runtime/src/test-runner.test.ts'
        || filePath.startsWith('packages/workflow/')
        || filePath === 'packages/agent/package.json'
        || filePath === 'packages/agent/src/agent.permissions.test.ts'
        || filePath.startsWith('packages/agent/src/llm/')
        || filePath === 'packages/agent/src/agent-provider.ts'
        || filePath === 'packages/agent/src/agent-provider.test.ts'
        || filePath === 'packages/agent/src/index.ts'
        || filePath === 'packages/agent/src/agent.ts'
        || filePath === 'packages/agent/src/agents.ts'
        || filePath === 'packages/agent/src/agents.test.ts'
        || filePath === 'packages/agent/src/sub-agents.ts'
        || filePath === 'packages/agent/src/sub-agents.test.ts'
        || filePath.startsWith('packages/agent/src/deploy/');
    },
  },
  {
    id: 'fix-orchestration',
    label: 'Fix orchestration cleanup',
    tier: 'supporting',
    branch: 'codex/fix-orchestration',
    rationale: '承接 fix command 拆分与 post-fix 校验链路。',
    validation: [
      'pnpm --filter @xqoder/cli typecheck',
      'pnpm --filter @xqoder/cli exec vitest run src/commands/fix.test.ts src/commands/fix.integration.test.ts',
    ],
    matches(filePath) {
      return filePath.startsWith('packages/cli/src/commands/fix');
    },
  },
  {
    id: 'stability-docs',
    label: 'Stability docs only',
    tier: 'supporting',
    branch: 'codex/stability-docs',
    rationale: '承接 stability board / baseline / daily log 等纯文档同步面。',
    validation: [
      'pnpm verify:quality:reports',
    ],
    matches(filePath) {
      return filePath.startsWith('docs/stability/');
    },
  },
  {
    id: 'skills-vendoring',
    label: 'Skills vendoring',
    tier: 'noise',
    branch: null,
    rationale: '本地 agent skill 资产不应该混进 reviewable PR，需先剥离。',
    validation: [],
    matches(filePath) {
      return filePath.startsWith('.agents/skills/')
        || filePath.startsWith('.codex/skills/');
    },
  },
  {
    id: 'generated-or-noise',
    label: 'Generated or noise',
    tier: 'noise',
    branch: null,
    rationale: '这些路径不适合作为 reviewable PR 内容，应先清掉或单独处理。',
    validation: [],
    matches(filePath) {
      return filePath.startsWith('.pnpm-store/')
        || filePath.startsWith('.xqoder/')
        || /^packages\/[^/]+\/target\//.test(filePath);
    },
  },
  {
    id: 'unassigned',
    label: 'Unassigned',
    tier: 'noise',
    branch: null,
    rationale: '当前规则还没覆盖的路径，需要人工再分流。',
    validation: [],
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

export function resolveBaseRef(repoRoot = defaultRepoRoot, candidates = defaultBaseRefCandidates) {
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

export function classifyThemePrPath(filePath) {
  for (const definition of themeDefinitions) {
    if (definition.matches(filePath)) {
      return definition.id;
    }
  }
  return 'unassigned';
}

export function inspectThemePrPlan(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const baseRef = options.baseRef ?? resolveBaseRef(repoRoot);
  const currentBranch = runGit(repoRoot, ['branch', '--show-current']).trim() || null;
  const branchPaths = baseRef
    ? readNullSeparatedGitPaths(repoRoot, ['diff', '--name-only', '-z', `${baseRef}...HEAD`])
    : [];
  const stagedPaths = readNullSeparatedGitPaths(repoRoot, ['diff', '--cached', '--name-only', '-z']);
  const unstagedPaths = readNullSeparatedGitPaths(repoRoot, ['diff', '--name-only', '-z']);
  const untrackedPaths = readNullSeparatedGitPaths(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);

  return analyzeThemePrPlan({
    branch: branchPaths,
    staged: stagedPaths,
    unstaged: unstagedPaths,
    untracked: untrackedPaths,
  }, {
    currentBranch,
    repoRoot,
    baseRef,
  });
}

export function analyzeThemePrPlan(pathsBySource, options = {}) {
  const normalizedBySource = {
    branch: uniqueSorted(pathsBySource.branch ?? []),
    staged: uniqueSorted(pathsBySource.staged ?? []),
    unstaged: uniqueSorted(pathsBySource.unstaged ?? []),
    untracked: uniqueSorted(pathsBySource.untracked ?? []),
  };

  const pathToSources = new Map();
  for (const [source, paths] of Object.entries(normalizedBySource)) {
    for (const filePath of paths) {
      const bucket = pathToSources.get(filePath) ?? new Set();
      bucket.add(source);
      pathToSources.set(filePath, bucket);
    }
  }

  const grouped = new Map();
  for (const definition of themeDefinitions) {
    grouped.set(definition.id, {
      id: definition.id,
      label: definition.label,
      tier: definition.tier,
      branch: definition.branch,
      rationale: definition.rationale,
      validation: definition.validation,
      paths: [],
      counts: {
        branch: 0,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        total: 0,
      },
      samples: [],
    });
  }

  for (const [filePath, sources] of pathToSources.entries()) {
    const themeId = classifyThemePrPath(filePath);
    const entry = grouped.get(themeId);
    if (!entry) {
      continue;
    }
    entry.paths.push(filePath);
    entry.counts.total += 1;
    for (const source of sources) {
      entry.counts[source] += 1;
    }
  }

  const themes = themeDefinitions
    .map((definition) => {
      const entry = grouped.get(definition.id);
      if (!entry) {
        return null;
      }
      const paths = uniqueSorted(entry.paths);
      return {
        ...entry,
        paths,
        prerequisites: definition.prerequisites ?? [],
        supportPaths: uniqueSorted(definition.supportPaths ?? []),
        samples: paths.slice(0, 12),
      };
    })
    .filter((entry) => entry && entry.counts.total > 0);

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    currentBranch: options.currentBranch ?? null,
    repoRoot: path.resolve(options.repoRoot ?? defaultRepoRoot),
    baseRef: options.baseRef ?? null,
    counts: {
      branch: normalizedBySource.branch.length,
      staged: normalizedBySource.staged.length,
      unstaged: normalizedBySource.unstaged.length,
      untracked: normalizedBySource.untracked.length,
      total: pathToSources.size,
    },
    themes,
  };
}

export function resolveThemeExtractionStack(report, themeOrId) {
  const themeId = typeof themeOrId === 'string' ? themeOrId : themeOrId?.id;
  if (!themeId) {
    return [];
  }

  const themeLookup = new Map(report.themes.map((theme) => [theme.id, theme]));
  const ordered = [];
  const visited = new Set();

  function visit(currentId) {
    if (visited.has(currentId)) {
      return;
    }
    visited.add(currentId);

    const currentTheme = themeLookup.get(currentId);
    if (!currentTheme) {
      return;
    }

    for (const prerequisiteId of currentTheme.prerequisites ?? []) {
      visit(prerequisiteId);
    }

    ordered.push(currentTheme);
  }

  visit(themeId);
  return ordered;
}

export function resolveThemeExtractionPaths(report, themeOrId) {
  const stack = resolveThemeExtractionStack(report, themeOrId);
  return uniqueSorted(stack.flatMap((theme) => [
    ...theme.paths,
    ...(theme.supportPaths ?? []),
  ]));
}

export function renderThemePrPlanMarkdown(report) {
  const lines = [
    '# Theme PR Plan',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Source branch: \`${report.currentBranch ?? 'detached'}\``,
    `- Base ref: \`${report.baseRef ?? 'unavailable'}\``,
    `- Changed paths: total=\`${report.counts.total}\`, branch=\`${report.counts.branch}\`, staged=\`${report.counts.staged}\`, unstaged=\`${report.counts.unstaged}\`, untracked=\`${report.counts.untracked}\``,
    '',
  ];

  renderThemeSection(lines, report, 'canonical', 'Canonical Theme PRs');
  renderThemeSection(lines, report, 'supporting', 'Supporting Slices');
  renderThemeSection(lines, report, 'noise', 'Reviewability Risks');

  return `${lines.join('\n')}\n`;
}

function renderThemeSection(lines, report, tier, title) {
  const { themes } = report;
  const matches = themes.filter((theme) => theme.tier === tier);
  if (matches.length === 0) {
    return;
  }
  lines.push(`## ${title}`, '');
  for (const theme of matches) {
    lines.push(`### ${theme.label}`, '');
    if (theme.branch) {
      lines.push(`- Suggested branch: \`${theme.branch}\``);
    }
    lines.push(`- Why this slice: ${theme.rationale}`);
    if (theme.prerequisites.length > 0) {
      lines.push(`- Prerequisites: \`${theme.prerequisites.join('`, `')}\``);
    }
    lines.push(`- Path count: total=\`${theme.counts.total}\`, branch=\`${theme.counts.branch}\`, staged=\`${theme.counts.staged}\`, unstaged=\`${theme.counts.unstaged}\`, untracked=\`${theme.counts.untracked}\``);
    if (theme.branch) {
      lines.push(`- Extraction: \`${buildThemeExtractionCommand(theme, report)}\``);
    }
    if (theme.validation.length > 0) {
      lines.push(`- Validation: \`${theme.validation.join(' && ')}\``);
    }
    if (theme.samples.length > 0) {
      lines.push('- Sample paths:');
      for (const sample of theme.samples) {
        lines.push(`  - ${sample}`);
      }
    }
    lines.push('');
  }
}

function buildThemeExtractionCommand(theme, report) {
  const targetDir = `../xqoder-${theme.id}`;
  const parts = [
    'node ./scripts/extract-theme-pr-slice.mjs',
    `--theme ${theme.id}`,
    `--target ${targetDir}`,
  ];
  if (report.baseRef) {
    parts.push(`--base ${report.baseRef}`);
  }
  return parts.join(' ');
}
