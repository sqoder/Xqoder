import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentSession } from './session.js';
import { SQLiteSessionStore } from './store.js';

const tempDirs: string[] = [];

function createTempDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-session-store-'));
    tempDirs.push(dir);
    return path.join(dir, 'sessions.sqlite');
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('SQLiteSessionStore', () => {
    it('persists and reloads a complete agent session snapshot', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);
        const session = new AgentSession({
            id: 'session_demo',
            title: 'Inspect demo project',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            maxMessages: 6,
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '帮我看下这个项目' },
                { role: 'assistant', content: '先看一下结构。' },
                { role: 'tool', content: 'README.md', toolCallId: 'tool_1' },
            ],
            usage: {
                promptTokens: 120,
                completionTokens: 32,
                totalTokens: 152,
            },
        });
        session.recordToolExecution({
            id: 'tool_1',
            name: 'run_command',
            args: {
                command: 'pnpm test',
            },
            success: true,
            output: 'all green',
            metadata: {
                command: 'pnpm test',
                cwd: '/workspace/demo',
            },
        });
        session.recordToolExecution({
            id: 'tool_2',
            name: 'write_file',
            args: {
                path: 'README.md',
                content: '# Demo',
            },
            success: true,
            output: 'README updated',
            metadata: {
                path: '/workspace/demo/README.md',
                changeType: 'write',
                bytes: 6,
                existedBefore: true,
            },
        });

        const summary = store.saveSessionSnapshot({
            session,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });
        const loaded = store.getSessionSnapshot('session_demo');

        expect(summary).toMatchObject({
            id: 'session_demo',
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
            title: 'Inspect demo project',
            messageCount: 4,
            usage: {
                promptTokens: 120,
                completionTokens: 32,
                totalTokens: 152,
            },
            commandCount: 1,
            fileChangeCount: 1,
            compactionCount: 0,
        });
        expect(loaded?.id).toBe('session_demo');
        expect(loaded?.title).toBe('Inspect demo project');
        expect(loaded?.messages).toEqual(session.getMessages());
        expect(loaded?.usage).toEqual(session.getUsage());
        expect(loaded?.metadata.commandHistory).toEqual(session.getCommandHistory());
        expect(loaded?.metadata.fileChanges).toEqual(session.getFileChanges());
        expect(store.getSessionSummary('session_demo')).toMatchObject({
            id: 'session_demo',
            commandCount: 1,
            fileChangeCount: 1,
        });
    });

    it('appends messages via kernel-oriented appendSessionMessage API', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);

        store.appendSessionMessage({
            sessionId: 'session_kernel_append',
            message: { role: 'user', content: 'Investigate runtime kernel flow' },
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });
        store.appendSessionMessage({
            sessionId: 'session_kernel_append',
            message: { role: 'assistant', content: 'Kernel now persists protocol message events.' },
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });

        const loaded = store.getSessionSnapshot('session_kernel_append');
        const summary = store.getSessionSummary('session_kernel_append');
        expect(loaded?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
        expect(loaded?.messages[1]?.content).toBe('Kernel now persists protocol message events.');
        expect(summary?.messageCount).toBe(2);
        expect(summary?.title).toContain('Investigate runtime kernel flow');
    });

    it('updates a persisted session title by resaving the snapshot without changing transcript content', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);
        const session = new AgentSession({
            id: 'session_title_update',
            title: 'Initial title',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'Help me inspect the repo' },
            ],
        });

        store.saveSessionSnapshot({
            session,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });

        const snapshot = store.getSessionSnapshot('session_title_update');
        expect(snapshot).not.toBeNull();

        const next = AgentSession.fromSnapshot({
            ...snapshot!,
            title: 'Generated concise title',
        });
        const updated = store.saveSessionSnapshot({
            session: next,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
            title: 'Generated concise title',
        });
        const reloaded = store.getSessionSnapshot('session_title_update');

        expect(updated.title).toBe('Generated concise title');
        expect(reloaded?.title).toBe('Generated concise title');
        expect(reloaded?.messages).toHaveLength(2);
    });

    it('returns the latest summary for a project when multiple snapshots exist', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);

        const first = new AgentSession({
            id: 'session_first',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [{ role: 'system', content: 'system prompt' }],
        });
        const second = new AgentSession({
            id: 'session_second',
            createdAt: new Date('2026-03-08T00:05:00.000Z'),
            messages: [{ role: 'system', content: 'system prompt' }],
        });

        store.saveSessionSnapshot({
            session: first,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });
        store.saveSessionSnapshot({
            session: second,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });

        const latest = store.listSessions('/workspace/demo', 1)[0];
        expect(latest?.id).toBe('session_second');
        expect(store.getSessionSnapshot(latest!.id)?.id).toBe('session_second');
    });

    it('persists fix history metadata through sqlite snapshots', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);
        const session = new AgentSession({
            id: 'session_fix_history',
            createdAt: new Date('2026-03-22T00:00:00.000Z'),
            messages: [{ role: 'user', content: 'run fix and track success rate' }],
            metadata: {
                fixHistory: {
                    totalRuns: 4,
                    successfulRuns: 3,
                    failedRuns: 1,
                    successRate: 0.75,
                    updatedAt: new Date('2026-03-22T00:15:00.000Z'),
                    rollingWindows: [{
                        label: '7d',
                        totalRuns: 4,
                        successfulRuns: 3,
                        failedRuns: 1,
                        successRate: 0.75,
                    }],
                    recentRuns: [{
                        id: 'fix_run_4',
                        success: true,
                        attemptCount: 3,
                        totalDurationMs: 64000,
                        startedAt: new Date('2026-03-22T00:14:00.000Z'),
                        completedAt: new Date('2026-03-22T00:15:04.000Z'),
                        remediationPolicyIds: ['compile-error-v3'],
                        suspectedFailureBuckets: ['runtime_compile_error'],
                        automaticActionIds: [],
                    }],
                },
            },
        });

        store.saveSessionSnapshot({
            session,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4.1',
        });

        const loaded = store.getSessionSnapshot('session_fix_history');
        expect(loaded?.metadata.fixHistory).toMatchObject({
            totalRuns: 4,
            successfulRuns: 3,
            failedRuns: 1,
            successRate: 0.75,
            recentRuns: [{
                id: 'fix_run_4',
                success: true,
                attemptCount: 3,
                totalDurationMs: 64000,
                remediationPolicyIds: ['compile-error-v3'],
                suspectedFailureBuckets: ['runtime_compile_error'],
                automaticActionIds: [],
            }],
        });
    });

    it('persists a minimal user-only session through saveSessionSnapshot', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);
        const session = new AgentSession({
            id: 'session_runtime_save',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'user', content: 'runtime save path' },
            ],
        });

        const summary = store.saveSessionSnapshot({
            session,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        });
        const loaded = store.getSessionSnapshot('session_runtime_save');

        expect(summary.id).toBe('session_runtime_save');
        expect(loaded?.messages[0]?.content).toBe('runtime save path');
    });

    it('persists an empty session snapshot with explicit title', () => {
        const dbPath = createTempDbPath();
        const store = new SQLiteSessionStore(dbPath);
        const session = new AgentSession({
            id: 'session_empty_snapshot',
            title: 'New Session',
        });

        const summary = store.saveSessionSnapshot({
            session,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
            title: 'New Session',
        });
        const loaded = store.getSessionSnapshot(summary.id);

        expect(summary.projectRoot).toBe('/workspace/demo');
        expect(summary.model).toBe('gpt-4o');
        expect(summary.title).toBe('New Session');
        expect(loaded?.messages).toHaveLength(0);
    });

    describe('Day 15: session sanitization and recovery', () => {
        it('redacts Bearer and token in persisted last_user_message and message content', () => {
            const dbPath = createTempDbPath();
            const store = new SQLiteSessionStore(dbPath);
            const session = new AgentSession({
                id: 'session_sanitize',
                createdAt: new Date(),
                messages: [
                    { role: 'user', content: 'Use Bearer sk-abc123def456ghi789 and API_KEY=secret99' },
                    { role: 'assistant', content: 'Authorization: Bearer sk-xyz000' },
                ],
            });

            store.saveSessionSnapshot({
                session,
                projectRoot: '/tmp/demo',
                cwd: '/tmp/demo',
                model: 'gpt-4o',
            });

            const summary = store.getSessionSummary('session_sanitize');
            expect(summary?.lastUserMessage).toBeDefined();
            expect(summary!.lastUserMessage).not.toContain('sk-abc123def456ghi789');
            expect(summary!.lastUserMessage).not.toContain('secret99');
            expect(summary!.lastUserMessage).toContain('***');

            const loaded = store.getSessionSnapshot('session_sanitize');
            expect(loaded).not.toBeNull();
            const msgs = loaded!.messages;
            expect(msgs.some((m) => m.content?.includes('sk-abc123def456ghi789') || m.content?.includes('secret99'))).toBe(false);
            expect(msgs.some((m) => m.content?.includes('***'))).toBe(true);
        });

        it('normal recovery unaffected: message count and structure after save/load', () => {
            const dbPath = createTempDbPath();
            const store = new SQLiteSessionStore(dbPath);
            const session = new AgentSession({
                id: 'session_recovery',
                createdAt: new Date(),
                messages: [
                    { role: 'system', content: 'You are a helper.' },
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi there.' },
                ],
            });

            store.saveSessionSnapshot({
                session,
                projectRoot: '/tmp/demo',
                cwd: '/tmp/demo',
                model: 'gpt-4o',
            });

            const loaded = store.getSessionSnapshot('session_recovery');
            expect(loaded?.messages.length).toBe(3);
            expect(loaded?.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
            expect(loaded?.messages[1]?.content).toBe('Hello');
            expect(loaded?.messages[2]?.content).toBe('Hi there.');
        });

        it('recovers persisted crash-checkpoint snapshots after reopening sqlite', () => {
            const dbPath = createTempDbPath();
            const firstStore = new SQLiteSessionStore(dbPath);
            const session = new AgentSession({
                id: 'session_crash_checkpoint',
                title: 'Crash checkpoint',
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
                    cwd: '/tmp/demo',
                },
            });

            firstStore.saveSessionSnapshot({
                session,
                projectRoot: '/tmp/demo',
                cwd: '/tmp/demo',
                model: 'gpt-4.1',
            });
            firstStore.close();

            const reopenedStore = new SQLiteSessionStore(dbPath);
            const recovered = reopenedStore.getSessionSnapshot('session_crash_checkpoint');

            expect(recovered?.messages.map((message) => message.role)).toEqual(['system', 'user', 'tool']);
            expect(recovered?.messages.at(-1)).toMatchObject({
                role: 'tool',
                toolCallId: 'tool-crash-1',
                content: '错误: test failure',
            });
            expect(recovered?.metadata.commandHistory).toEqual([
                expect.objectContaining({
                    command: 'pnpm test',
                    cwd: '/tmp/demo',
                    success: false,
                }),
            ]);
            expect(recovered?.metadata.fixHistory).toMatchObject({
                totalRuns: 1,
                successfulRuns: 0,
                failedRuns: 1,
                recentRuns: [{
                    id: 'fix_run_crash',
                    success: false,
                }],
            });
            reopenedStore.close();
        });

        it('when persistLastUserMessage is false, summary has no lastUserMessage', () => {
            const dbPath = createTempDbPath();
            const store = new SQLiteSessionStore(dbPath);
            const session = new AgentSession({
                id: 'session_nolast',
                createdAt: new Date(),
                messages: [
                    { role: 'user', content: 'Secret user input' },
                ],
            });

            store.saveSessionSnapshot({
                session,
                projectRoot: '/tmp/demo',
                cwd: '/tmp/demo',
                model: 'gpt-4o',
                options: { persistLastUserMessage: false },
            });

            const summary = store.getSessionSummary('session_nolast');
            expect(summary?.lastUserMessage).toBeUndefined();
            const loaded = store.getSessionSnapshot('session_nolast');
            expect(loaded?.messages.length).toBe(1);
            expect(loaded?.messages[0]?.content).toBe('Secret user input');
        });
    });
});
