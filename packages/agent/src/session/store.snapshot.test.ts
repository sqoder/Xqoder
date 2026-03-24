import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentSession } from './session.js';
import { SQLiteSessionStore } from './store.js';

function createTempDbPath(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'xqoder-session-snapshot-'));
    return path.join(dir, 'sessions.sqlite');
}

describe('SQLiteSessionStore snapshot path', () => {
    it('returns session snapshots with messages and metadata intact', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);

        try {
            const session = new AgentSession({
                id: 'snapshot_roundtrip',
                systemPrompt: 'system prompt',
                metadata: {
                    fixHistory: {
                        totalRuns: 1,
                        successfulRuns: 1,
                        failedRuns: 0,
                        successRate: 1,
                        updatedAt: new Date('2026-03-24T00:00:00.000Z'),
                        rollingWindows: [],
                        recentRuns: [],
                    },
                },
            });
            session.addUserMessage('hello');

            store.saveSessionSnapshot({
                session,
                projectRoot: '/workspace/demo',
                cwd: '/workspace/demo',
                model: 'gpt-4o',
            });

            const snapshot = store.getSessionSnapshot('snapshot_roundtrip');

            expect(snapshot).not.toBeNull();
            expect(snapshot?.messages.map((message) => message.content)).toEqual(['system prompt', 'hello']);
            expect(snapshot?.metadata.fixHistory).toMatchObject({
                totalRuns: 1,
                successfulRuns: 1,
                failedRuns: 0,
                successRate: 1,
            });
        } finally {
            store.close();
            rmSync(path.dirname(dbPath), { recursive: true, force: true });
        }
    });

    it('appends messages through snapshot loading before persisting', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);

        try {
            const session = new AgentSession({
                id: 'snapshot_append',
                systemPrompt: 'system prompt',
            });
            session.addUserMessage('first');

            store.saveSessionSnapshot({
                session,
                projectRoot: '/workspace/demo',
                cwd: '/workspace/demo',
                model: 'gpt-4o',
            });

            store.appendSessionMessage({
                sessionId: 'snapshot_append',
                message: { role: 'assistant', content: 'second' },
                projectRoot: '/workspace/demo',
                cwd: '/workspace/demo',
                model: 'gpt-4o',
            });

            const snapshot = store.getSessionSnapshot('snapshot_append');
            expect(snapshot?.messages.map((message) => message.content)).toEqual([
                'system prompt',
                'first',
                'second',
            ]);
        } finally {
            store.close();
            rmSync(path.dirname(dbPath), { recursive: true, force: true });
        }
    });
});
