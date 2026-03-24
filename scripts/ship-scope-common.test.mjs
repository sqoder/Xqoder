import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeShipScope,
  classifyShipScopePath,
} from './ship-scope-common.mjs';

test('classifyShipScopePath groups representative files into stable areas', () => {
  assert.equal(classifyShipScopePath('packages/cli/src/tui/app.tsx'), 'terminal-surface');
  assert.equal(classifyShipScopePath('packages/runtime/src/core/runtime-kernel.ts'), 'automation-runtime');
  assert.equal(classifyShipScopePath('docs/artifacts/release/latest-index.md'), 'release-governance');
  assert.equal(classifyShipScopePath('docs/benchmarks/report.md'), 'quality-evidence');
  assert.equal(classifyShipScopePath('.github/workflows/ci.yml'), 'ci-workflows');
  assert.equal(classifyShipScopePath('.agents/skills/gstack/SKILL.md'), 'skills-vendoring');
});

test('analyzeShipScope flags mixed product areas plus vendored skills', () => {
  const report = analyzeShipScope({
    branch: [
      'packages/cli/src/tui/app.tsx',
      'packages/cli/src/tui/layout.tsx',
      'packages/cli/src/tui/sidebar.tsx',
      'packages/runtime/src/core/runtime-kernel.ts',
      'packages/workflow/src/flows/fix-flow.ts',
      'packages/agent/src/session/store.ts',
      'packages/shared/src/project-memory.ts',
      'packages/storage-sqlite/src/runtime-session-store-adapter.ts',
      'docs/artifacts/release/latest-index.md',
      'docs/benchmarks/report.md',
      '.github/workflows/ci.yml',
    ],
    untracked: [
      '.agents/skills/gstack/SKILL.md',
      '.agents/skills/gstack/review/SKILL.md',
      '.agents/skills/gstack/ship/SKILL.md',
      '.agents/skills/gstack/investigate/SKILL.md',
      '.agents/skills/gstack/plan-eng-review/SKILL.md',
    ],
  }, {
    maxPaths: 8,
    maxSignificantAreas: 3,
    significantAreaMinPaths: 1,
    maxPathsForEvidenceMix: 6,
  });

  assert.equal(report.counts.total, 16);
  assert.ok(report.issues.some((issue) => issue.id === 'skills-vendoring-present'));
  assert.ok(report.issues.some((issue) => issue.id === 'mixed-product-areas'));
  assert.ok(report.issues.some((issue) => issue.id === 'evidence-mixed-with-product'));
  assert.ok(report.issues.some((issue) => issue.id === 'too-many-areas'));
  assert.ok(report.issues.some((issue) => issue.id === 'too-many-paths'));
});

test('analyzeShipScope accepts a focused release-governance slice', () => {
  const report = analyzeShipScope({
    branch: [
      'docs/artifacts/release/latest-index.md',
      'docs/artifacts/release/release-state.json',
      'scripts/capture-release-plans.mjs',
      'scripts/quality-report-common.mjs',
      'scripts/release-check-strict.mjs',
    ],
  });

  assert.equal(report.areas[0]?.id, 'release-governance');
  assert.deepEqual(report.issues, []);
});
