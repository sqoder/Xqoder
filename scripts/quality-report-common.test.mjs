import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { renderRootQualityPage } from './quality-report-common.mjs';

test('renderRootQualityPage keeps release governance as a snapshot summary', () => {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'xqoder-quality-report-'));
  try {
    const releaseDir = path.join(fixtureDir, 'docs', 'artifacts', 'release');
    mkdirSync(releaseDir, { recursive: true });

    writeFileSync(path.join(releaseDir, 'workflow-parity.json'), JSON.stringify({
      generatedAt: '2026-03-23T14:07:48.730Z',
      missingOnRemote: ['Release Gate'],
      remoteOnly: ['Manual E2E'],
    }, null, 2));
    writeFileSync(path.join(releaseDir, 'release-state.json'), JSON.stringify({
      generatedAt: '2026-03-23T14:07:50.379Z',
      stableTag: 'v0.1.0',
      stableTagExists: false,
      latestRcTag: 'v0.1.0-rc.202603230340',
    }, null, 2));

    const markdown = renderRootQualityPage({
      benchmarkReports: [],
      evalReports: [],
      projectRoot: fixtureDir,
    });

    assert.match(markdown, /Remote workflow\/tag data is a point-in-time snapshot/);
    assert.match(markdown, /Workflow parity snapshot: `2026-03-23T14:07:48.730Z`/);
    assert.match(markdown, /Release state snapshot: `2026-03-23T14:07:50.379Z`/);
    assert.match(markdown, /Expected stable tag at snapshot time: `v0.1.0`/);
    assert.match(markdown, /Latest RC tag at snapshot time: `v0.1.0-rc.202603230340`/);
    assert.doesNotMatch(markdown, /Missing workflows on remote:/);
    assert.doesNotMatch(markdown, /Stable tag present on origin:/);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
