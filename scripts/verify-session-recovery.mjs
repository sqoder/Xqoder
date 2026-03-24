#!/usr/bin/env node

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ensureBuiltFiles,
  repoRoot,
} from './benchmark-common.mjs';

async function loadDeps() {
  const agentIndex = path.join(repoRoot, 'packages', 'agent', 'dist', 'index.js');
  ensureBuiltFiles([agentIndex]);
  return await import(pathToFileURL(agentIndex).href);
}

async function main() {
  process.stdout.write('Running verify:session:recovery\n');
  const injectedRegression = process.env.XQODER_INJECT_SESSION_RECOVERY_REGRESSION;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-session-recovery-'));
  const dbPath = path.join(tempRoot, 'sessions.sqlite');

  try {
    const { AgentSession, SQLiteSessionStore } = await loadDeps();

    const firstStore = new SQLiteSessionStore(dbPath);
    const session = new AgentSession({
      id: 'session_recovery_e2e',
      title: 'Recovery E2E',
      createdAt: new Date('2026-03-23T00:00:00.000Z'),
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'run the failing tests' },
        { role: 'tool', content: '错误: test failure', toolCallId: 'tool-crash-1' },
      ],
      metadata: {
        fixHistory: {
          totalRuns: 1,
          successfulRuns: 0,
          failedRuns: 1,
          successRate: 0,
          updatedAt: new Date('2026-03-23T00:00:03.000Z'),
          rollingWindows: [{
            label: '7d',
            totalRuns: 1,
            successfulRuns: 0,
            failedRuns: 1,
            successRate: 0,
          }],
          recentRuns: [{
            id: 'fix_run_crash',
            success: false,
            attemptCount: 1,
            totalDurationMs: 1500,
            startedAt: new Date('2026-03-23T00:00:01.000Z'),
            completedAt: new Date('2026-03-23T00:00:02.500Z'),
            remediationPolicyIds: ['compile-error-v1'],
            suspectedFailureBuckets: ['runtime_compile_error'],
            automaticActionIds: [],
          }],
        },
      },
    });
    session.recordToolExecution({
      id: 'tool-crash-1',
      name: 'run_command',
      args: { command: 'pnpm test' },
      success: false,
      output: 'test failure',
      error: 'simulated daemon crash',
      startedAt: new Date('2026-03-23T00:00:01.000Z'),
      completedAt: new Date('2026-03-23T00:00:02.000Z'),
      metadata: {
        command: 'pnpm test',
        cwd: tempRoot,
      },
    });

    firstStore.saveSessionSnapshot({
      session,
      projectRoot: tempRoot,
      cwd: tempRoot,
      model: 'gpt-4.1',
    });
    firstStore.close();
    process.stdout.write('✓ initial crash-checkpoint snapshot persisted\n');

    const reopenedStore = new SQLiteSessionStore(dbPath);
    const recovered = reopenedStore.getSessionSnapshot('session_recovery_e2e');
    const summary = reopenedStore.getSessionSummary('session_recovery_e2e');

    if (injectedRegression === 'missing-command-history' && recovered) {
      process.stdout.write('! Injecting session recovery regression: missing command history\n');
      recovered.metadata.commandHistory = [];
      if (summary) {
        summary.commandCount = 0;
      }
    }

    assert.ok(recovered, 'recovered session should exist after reopening sqlite');
    assert.deepEqual(
      recovered.messages.map((message) => message.role),
      ['system', 'user', 'tool'],
      'message roles should survive reopen',
    );
    assert.equal(recovered.messages.at(-1)?.toolCallId, 'tool-crash-1');
    assert.equal(recovered.metadata.commandHistory[0]?.command, 'pnpm test');
    assert.equal(recovered.metadata.fixHistory?.recentRuns[0]?.id, 'fix_run_crash');
    assert.equal(summary?.commandCount, 1);
    reopenedStore.close();
    process.stdout.write('✓ reopened sqlite store recovered checkpoint metadata\n');

    process.stdout.write('\n✅ Session recovery verification passed.\n');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`✗ verify:session:recovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
  if (error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(1);
});
