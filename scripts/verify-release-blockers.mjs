#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const strictGateScript = path.join(repoRoot, 'scripts', 'release-check-strict.mjs');

const drills = [
  {
    label: 'Session recovery blocker drill',
    only: 'session-recovery',
    env: {
      XQODER_INJECT_SESSION_RECOVERY_REGRESSION: 'missing-command-history',
    },
    expected: ['Strict release gate failed.', 'Session recovery gate'],
  },
  {
    label: 'Terminal main-path blocker drill',
    only: 'terminal-main-path',
    env: {
      XQODER_INJECT_TERMINAL_REGRESSION: 'legacy-role-label',
    },
    expected: ['Strict release gate failed.', 'Terminal main-path gate'],
  },
];

for (const drill of drills) {
  process.stdout.write(`\n=== ${drill.label} ===\n`);
  const result = spawnSync(process.execPath, [strictGateScript, `--only=${drill.only}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...drill.env,
    },
  });

  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  assert.notEqual(
    result.status,
    0,
    `${drill.label} should fail when the injected regression is enabled.`,
  );
  for (const marker of drill.expected) {
    assert.match(combinedOutput, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  process.stdout.write(`✓ ${drill.label} was blocked by strict release gate\n`);
}

process.stdout.write('\nRelease blocker drills passed.\n');
