import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeThemePrPlan,
  classifyThemePrPath,
  renderThemePrPlanMarkdown,
  resolveThemeExtractionPaths,
  resolveThemeExtractionStack,
} from './theme-pr-plan-common.mjs';

test('classifyThemePrPath maps representative files into expected themes', () => {
  assert.equal(classifyThemePrPath('packages/cli/src/commands/import.ts'), 'session-truth-source');
  assert.equal(classifyThemePrPath('packages/agent/src/project-memory.ts'), 'session-truth-source');
  assert.equal(classifyThemePrPath('packages/agent/src/project-memory.test.ts'), 'session-truth-source');
  assert.equal(classifyThemePrPath('packages/shared/src/project-memory.ts'), 'session-truth-source');
  assert.equal(classifyThemePrPath('packages/cli/src/session-bundle.ts'), 'session-truth-source');
  assert.equal(classifyThemePrPath('scripts/verify-session-theme-boundary.mjs'), 'session-truth-source');
  assert.equal(classifyThemePrPath('packages/cli/src/tui/agent-service.ts'), 'terminal-boundary-cleanup');
  assert.equal(classifyThemePrPath('packages/cli/src/attachment-references.ts'), 'terminal-boundary-cleanup');
  assert.equal(classifyThemePrPath('packages/cli/src/context-references.ts'), 'terminal-boundary-cleanup');
  assert.equal(classifyThemePrPath('packages/cli/src/commands/rollbacks.ts'), 'terminal-boundary-cleanup');
  assert.equal(classifyThemePrPath('packages/cli/src/services/today-session-stats.ts'), 'terminal-boundary-cleanup');
  assert.equal(classifyThemePrPath('scripts/verify-terminal-theme-slice.mjs'), 'terminal-boundary-cleanup');
  assert.equal(classifyThemePrPath('packages/cli/package.json'), 'terminal-boundary-cleanup');
  assert.equal(classifyThemePrPath('packages/cli/src/server/index.ts'), 'server-modularization');
  assert.equal(classifyThemePrPath('packages/storage-sqlite/src/runtime-session-store-adapter.ts'), 'storage-decoupling');
  assert.equal(classifyThemePrPath('packages/runtime/package.json'), 'storage-decoupling');
  assert.equal(classifyThemePrPath('packages/runtime/src/index.ts'), 'storage-decoupling');
  assert.equal(classifyThemePrPath('packages/runtime/src/core/event-bus.ts'), 'storage-decoupling');
  assert.equal(classifyThemePrPath('scripts/verify-storage-theme-slice.mjs'), 'storage-decoupling');
  assert.equal(classifyThemePrPath('scripts/release-check-strict.mjs'), 'release-gate-hardening');
  assert.equal(classifyThemePrPath('scripts/check-daemon-env.mjs'), 'release-gate-hardening');
  assert.equal(classifyThemePrPath('scripts/extract-theme-pr-slice.mjs'), 'release-gate-hardening');
  assert.equal(classifyThemePrPath('scripts/theme-pr-extract-common.mjs'), 'release-gate-hardening');
  assert.equal(classifyThemePrPath('scripts/verify-renderer-load.mjs'), 'release-gate-hardening');
  assert.equal(classifyThemePrPath('packages/shared/src/schema.ts'), 'shared-contract-extraction');
  assert.equal(classifyThemePrPath('packages/protocol/src/messages.ts'), 'shared-contract-extraction');
  assert.equal(classifyThemePrPath('packages/runtime/src/error-analyzer.ts'), 'shared-contract-extraction');
  assert.equal(classifyThemePrPath('packages/agent/package.json'), 'shared-contract-extraction');
  assert.equal(classifyThemePrPath('packages/agent/src/agent.permissions.test.ts'), 'shared-contract-extraction');
  assert.equal(classifyThemePrPath('packages/agent/src/sub-agents.ts'), 'shared-contract-extraction');
  assert.equal(classifyThemePrPath('packages/agent/src/deploy/index.ts'), 'shared-contract-extraction');
  assert.equal(classifyThemePrPath('.agents/skills/gstack/SKILL.md'), 'skills-vendoring');
  assert.equal(classifyThemePrPath('.pnpm-store/v10/files/00/example'), 'generated-or-noise');
});

test('analyzeThemePrPlan groups canonical, supporting, and noise slices', () => {
  const report = analyzeThemePrPlan({
    branch: [
      'packages/agent/src/session/store.ts',
      'packages/cli/src/tui/agent-service.ts',
      'packages/cli/src/server/index.ts',
      'packages/storage-sqlite/src/runtime-session-store-adapter.ts',
      'scripts/release-check-strict.mjs',
      'packages/shared/src/schema.ts',
      'packages/cli/src/commands/fix.ts',
      'docs/stability/stability-board.md',
      '.pnpm-store/v10/files/00/example',
    ],
    untracked: [
      'docs/artifacts/release/theme-pr-plan.md',
    ],
  }, {
    baseRef: 'origin/main',
    repoRoot: '/tmp/xqoder',
    generatedAt: '2026-03-24T12:00:00.000Z',
  });

  assert.equal(report.counts.total, 10);
  assert.ok(report.themes.some((theme) => theme.id === 'session-truth-source' && theme.counts.total === 1));
  assert.ok(report.themes.some((theme) => theme.id === 'terminal-boundary-cleanup' && theme.counts.total === 1));
  assert.ok(report.themes.some((theme) => theme.id === 'server-modularization' && theme.counts.total === 1));
  assert.ok(report.themes.some((theme) => theme.id === 'storage-decoupling' && theme.counts.total === 1));
  assert.ok(report.themes.some((theme) => theme.id === 'release-gate-hardening' && theme.counts.total === 2));
  assert.ok(report.themes.some((theme) => theme.id === 'shared-contract-extraction' && theme.counts.total === 1));
  assert.ok(report.themes.some((theme) => theme.id === 'fix-orchestration' && theme.counts.total === 1));
  assert.ok(report.themes.some((theme) => theme.id === 'stability-docs' && theme.counts.total === 1));
  assert.ok(report.themes.some((theme) => theme.id === 'generated-or-noise' && theme.counts.total === 1));
});

test('resolveThemeExtractionPaths includes prerequisite and support paths for stacked terminal slices', () => {
  const report = analyzeThemePrPlan({
    branch: [
      'packages/agent/src/session/store.ts',
      'packages/cli/src/tui/agent-service.ts',
      'packages/storage-sqlite/src/runtime-session-store-adapter.ts',
    ],
    untracked: [
      'packages/cli/src/server/in-memory-client.ts',
    ],
  }, {
    baseRef: 'origin/main',
    repoRoot: '/tmp/xqoder',
    generatedAt: '2026-03-24T12:00:00.000Z',
  });

  assert.deepEqual(
    resolveThemeExtractionStack(report, 'terminal-boundary-cleanup').map((theme) => theme.id),
    ['session-truth-source', 'storage-decoupling', 'terminal-boundary-cleanup'],
  );
  assert.deepEqual(resolveThemeExtractionPaths(report, 'terminal-boundary-cleanup'), [
    'packages/agent/src/session/store.ts',
    'packages/cli/src/server/in-memory-client.ts',
    'packages/cli/src/tui/agent-service.ts',
    'packages/storage-sqlite/src/runtime-session-store-adapter.ts',
    'scripts/benchmark-common.mjs',
    'scripts/postbuild-renderer.mjs',
    'scripts/quality-report-common.mjs',
    'scripts/real-project-eval-report-common.mjs',
    'scripts/real-project-targets-common.mjs',
    'scripts/verify-session-recovery.mjs',
  ]);
});

test('renderThemePrPlanMarkdown includes suggested branch and validation summary', () => {
  const report = analyzeThemePrPlan({
    branch: [
      'packages/agent/src/session/store.ts',
      'packages/cli/src/tui/agent-service.ts',
      'packages/cli/src/server/index.ts',
      'packages/storage-sqlite/src/runtime-session-store-adapter.ts',
      'scripts/release-check-strict.mjs',
    ],
  }, {
    baseRef: 'origin/main',
    currentBranch: 'codex/phase4-gate-close-20260323',
    repoRoot: '/tmp/xqoder',
    generatedAt: '2026-03-24T12:00:00.000Z',
  });

  const markdown = renderThemePrPlanMarkdown(report);
  assert.match(markdown, /## Canonical Theme PRs/);
  assert.match(markdown, /### Server modularization/);
  assert.match(markdown, /Suggested branch: `codex\/server-modularization`/);
  assert.match(markdown, /Extraction: `node \.\/scripts\/extract-theme-pr-slice\.mjs --theme server-modularization --target \.\.\/xqoder-server-modularization --base origin\/main`/);
  assert.match(markdown, /### Release gate hardening/);
  assert.match(markdown, /Prerequisites: `session-truth-source`, `terminal-boundary-cleanup`, `storage-decoupling`/);
  assert.match(markdown, /### Terminal boundary cleanup/);
  assert.match(markdown, /Prerequisites: `session-truth-source`, `shared-contract-extraction`, `storage-decoupling`/);
  assert.match(markdown, /pnpm verify:contracts/);
  assert.match(markdown, /Source branch: `codex\/phase4-gate-close-20260323`/);
});
