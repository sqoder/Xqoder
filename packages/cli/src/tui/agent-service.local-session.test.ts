import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentSession, SQLiteSessionStore, SummarizerAgent, type AgentCallbacks, type AgentConfig, type PersistedSessionSummary, type RuntimeAgentSessionStore, type SaveSessionInput } from '@xqoder/agent';
import type { AppEvent } from '@xqoder/protocol';
import { TuiAgentService } from './agent-service.js';

function createLocalSessionStore(options: { snapshotOnly?: boolean } = {}) {
    const sessions = new Map<string, { session: AgentSession; summary: PersistedSessionSummary }>();

    const toSummary = (
        session: AgentSession,
        input: { projectRoot: string; cwd: string; model: string; title?: string },
    ): PersistedSessionSummary => ({
        id: session.id,
        projectRoot: input.projectRoot,
        cwd: input.cwd,
        model: input.model,
        title: input.title ?? session.getTitle() ?? 'Session',
        createdAt: session.createdAt,
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
        maxMessages: session.toSnapshot().maxMessages,
        messageCount: session.messageCount,
        usage: session.getUsage(),
        ...(session.toSnapshot().metadata.compactSummary
            ? { lastUserMessage: session.getMessages().filter((message) => message.role === 'user').at(-1)?.content }
            : {}),
        compactionCount: session.getCompactions().length,
        commandCount: session.getCommandHistory().length,
        fileChangeCount: session.getFileChanges().length,
    });

    const store: Pick<RuntimeAgentSessionStore, 'getSessionSnapshot' | 'getSessionSummary' | 'listSessions' | 'saveSessionSnapshot' | 'appendSessionMessage'> & {
        getSession?: (sessionId: string) => AgentSession | null;
    } = {
        getSessionSnapshot(sessionId: string) {
            return sessions.get(sessionId)?.session.toSnapshot() ?? null;
        },
        getSessionSummary(sessionId: string) {
            return sessions.get(sessionId)?.summary ?? null;
        },
        listSessions(projectRoot?: string, limit = 20) {
            return [...sessions.values()]
                .map((entry) => entry.summary)
                .filter((summary) => (!projectRoot || summary.projectRoot === projectRoot))
                .slice(0, limit);
        },
        saveSessionSnapshot(input: SaveSessionInput) {
            const summary = toSummary(input.session, input);
            sessions.set(summary.id, {
                session: AgentSession.fromSnapshot(input.session.toSnapshot()),
                summary,
            });
            return summary;
        },
        appendSessionMessage(input) {
            const existing = sessions.get(input.sessionId)?.session;
            const next = existing
                ? AgentSession.fromSnapshot(existing.toSnapshot())
                : new AgentSession({ id: input.sessionId });
            next.addMessage(input.message);
            if (input.title) {
                next.setTitle(input.title);
            }
            const summary = toSummary(next, input);
            sessions.set(summary.id, { session: next, summary });
            return summary;
        },
    };

    if (!options.snapshotOnly) {
        store.getSession = (sessionId: string) => sessions.get(sessionId)?.session ?? null;
    }

    return {
        store,
        seed(session: AgentSession, input: { projectRoot: string; cwd: string; model: string; title?: string }) {
            const summary = toSummary(session, input);
            sessions.set(summary.id, {
                session: AgentSession.fromSnapshot(session.toSnapshot()),
                summary,
            });
        },
    };
}

describe('TuiAgentService local session mutation', () => {
    it('sendMessage persists assistant completion for successful local runs', async () => {
        class SuccessfulLocalAgent {
            private readonly session: AgentSession;

            constructor(config: AgentConfig) {
                this.session = AgentSession.fromSnapshot(
                    (config.session ?? new AgentSession({ systemPrompt: config.systemPrompt })).toSnapshot(),
                );
            }

            async run(prompt: string): Promise<string> {
                this.session.addUserMessage(prompt);
                this.session.addAssistantMessage({
                    role: 'assistant',
                    content: 'all green',
                });
                return 'all green';
            }

            cancel(): void {}

            getSessionSnapshot() {
                return this.session.toSnapshot();
            }

            async dispose(): Promise<void> {}
        }

        const seeded = new AgentSession({
            id: 'session-local-success',
            title: 'Existing Title',
            createdAt: new Date('2026-03-22T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system' },
            ],
        });
        const sessionStore = createLocalSessionStore();
        sessionStore.seed(seeded, {
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Existing Title',
        });

        const events: AppEvent[] = [];
        const service = new TuiAgentService(sessionStore.store, {
            createAgent: (config) => new SuccessfulLocalAgent(config),
        });

        const result = await service.sendMessage('ship it', seeded.id, {
            dir: '/workspace/demo',
            model: 'gpt-4.1',
            agent: 'general',
            sandboxMode: 'project',
        }, [], {
            onEvent: (event) => {
                events.push(event);
            },
        });

        expect(result).toEqual({
            sessionId: seeded.id,
            sessionTitle: 'Existing Title',
        });

        const snapshot = sessionStore.store.getSessionSnapshot(seeded.id);
        expect(snapshot?.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant']);
        expect(snapshot?.messages.at(-1)?.content).toBe('all green');
        expect(events).toContainEqual(expect.objectContaining({
            type: 'message.completed',
            message: expect.objectContaining({
                role: 'assistant',
                content: 'all green',
            }),
        }));
    });

    it('replaceSessionMessages updates messages through runtime kernel without dropping metadata history', async () => {
        const seeded = new AgentSession({
            id: 'session-local-1',
            title: 'Local Session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system' },
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'world' },
            ],
            metadata: {
                compactSummary: 'summary text',
                compactions: [{
                    id: 'compact-1',
                    createdAt: new Date('2026-03-20T00:00:01.000Z'),
                    messageCountBefore: 6,
                    messageCountAfter: 3,
                    summary: 'summary text',
                }],
                toolHistory: [{
                    id: 'tool-1',
                    name: 'read_file',
                    args: { path: '/tmp/demo.ts' },
                    success: true,
                    outputPreview: 'ok',
                    startedAt: new Date('2026-03-20T00:00:02.000Z'),
                    completedAt: new Date('2026-03-20T00:00:03.000Z'),
                }],
                commandHistory: [],
                fileChanges: [],
            },
        });
        const sessionStore = createLocalSessionStore();
        sessionStore.seed(seeded, {
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Local Session',
        });

        const service = new TuiAgentService(sessionStore.store);
        await service.replaceSessionMessages({
            sessionId: seeded.id,
            cwd: '/workspace/demo',
            projectRoot: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Local Session',
            messages: seeded.getMessages().slice(0, 2),
        });

        const snapshot = sessionStore.store.getSessionSnapshot(seeded.id);
        expect(snapshot?.messages.map((message) => message.content)).toEqual(['system', 'hello']);
        expect(snapshot?.metadata.compactSummary).toBe('summary text');
        expect(snapshot?.metadata.compactions).toEqual([
            expect.objectContaining({ id: 'compact-1', summary: 'summary text' }),
        ]);
        expect(snapshot?.metadata.toolHistory).toEqual([
            expect.objectContaining({ id: 'tool-1', name: 'read_file' }),
        ]);
    });

    it('persistSessionSnapshot keeps compaction metadata and usage through kernel sync', async () => {
        const session = new AgentSession({
            id: 'session-local-2',
            title: 'Compact Session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system' },
                { role: 'user', content: 'a' },
                { role: 'assistant', content: 'b' },
                { role: 'user', content: 'c' },
                { role: 'assistant', content: 'd' },
                { role: 'user', content: 'e' },
            ],
        });
        session.recordUsage({
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
            cacheReadTokens: 10,
            cacheCreationTokens: 5,
            cost: 0.12,
        });
        session.performCompaction('new compact summary');

        const sessionStore = createLocalSessionStore();
        sessionStore.seed(session, {
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Compact Session',
        });

        const service = new TuiAgentService(sessionStore.store);
        await service.persistSessionSnapshot({
            session,
            cwd: '/workspace/demo',
            projectRoot: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Compact Session',
        });

        const snapshot = sessionStore.store.getSessionSnapshot(session.id);
        expect(snapshot?.metadata.compactSummary).toBe('new compact summary');
        expect(snapshot?.metadata.compactions).toEqual([
            expect.objectContaining({ summary: 'new compact summary' }),
        ]);
        expect(snapshot?.usage).toMatchObject({
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
            cacheReadTokens: 10,
            cacheCreationTokens: 5,
            cost: 0.12,
        });
    });

    it('compactSession preserves the configured recent window and stores the layered summary', async () => {
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-compact-session-'));
        fs.mkdirSync(path.join(projectDir, '.xqoder'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, '.xqoder', 'config.json'), JSON.stringify({
            llm: {
                provider: 'openai',
                apiKey: 'test-key',
                model: 'gpt-4.1-mini',
            },
            compaction: {
                auto: true,
                reserved: 3,
            },
        }));

        const session = new AgentSession({
            id: 'session-local-compact',
            title: 'Compact Session',
            createdAt: new Date('2026-03-22T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system' },
                { role: 'user', content: 'u1' },
                { role: 'assistant', content: 'a1' },
                { role: 'user', content: 'u2' },
                { role: 'assistant', content: 'a2' },
                { role: 'user', content: 'u3' },
                { role: 'assistant', content: 'a3' },
            ],
        });
        const sessionStore = createLocalSessionStore();
        sessionStore.seed(session, {
            projectRoot: projectDir,
            cwd: projectDir,
            model: 'gpt-4.1-mini',
            title: 'Compact Session',
        });

        const summarizeSpy = vi.spyOn(SummarizerAgent.prototype, 'summarizeForCompaction').mockResolvedValue(
            '## Historical Summary\n- compacted history',
        );

        try {
            const service = new TuiAgentService(sessionStore.store);
            const summary = await service.compactSession(session.id, {
                dir: projectDir,
                model: 'gpt-4.1-mini',
                agent: 'coder',
                sandboxMode: 'project',
            });

            expect(summary).toBe('## Historical Summary\n- compacted history');
            expect(summarizeSpy).toHaveBeenCalledTimes(1);
            expect(summarizeSpy.mock.calls[0]?.[0].compactedMessages.map((message) => message.content)).toEqual([
                'u1',
                'a1',
                'u2',
            ]);
            expect(summarizeSpy.mock.calls[0]?.[0].recentMessages?.map((message) => message.content)).toEqual([
                'a2',
                'u3',
                'a3',
            ]);

            const snapshot = sessionStore.store.getSessionSnapshot(session.id);
            expect(snapshot?.messages.map((message) => message.content)).toEqual([
                'system',
                '[XQoder auto-compact summary]\n## Historical Summary\n- compacted history',
                'a2',
                'u3',
                'a3',
            ]);
            expect(snapshot?.metadata.compactSummary).toBe('## Historical Summary\n- compacted history');
            expect(snapshot?.metadata.compactions).toHaveLength(1);
        } finally {
            summarizeSpy.mockRestore();
            fs.rmSync(projectDir, { recursive: true, force: true });
        }
    });

    it('replaceSessionMessages works with snapshot-only stores (no getSession fallback)', async () => {
        const seeded = new AgentSession({
            id: 'session-local-snapshot-only',
            title: 'Snapshot only',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system' },
                { role: 'user', content: 'message-1' },
                { role: 'assistant', content: 'message-2' },
            ],
        });
        const sessionStore = createLocalSessionStore({ snapshotOnly: true });
        sessionStore.seed(seeded, {
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Snapshot only',
        });

        const service = new TuiAgentService(sessionStore.store);
        await service.replaceSessionMessages({
            sessionId: seeded.id,
            cwd: '/workspace/demo',
            projectRoot: '/workspace/demo',
            model: 'gpt-4.1',
            messages: seeded.getMessages().slice(0, 1),
        });

        const snapshot = sessionStore.store.getSessionSnapshot(seeded.id);
        expect(snapshot?.messages.map((message) => message.content)).toEqual(['system']);
    });

    it('checkpoints session metadata when an in-flight run crashes after tool execution', async () => {
        class CrashCheckpointAgent {
            private readonly session: AgentSession;

            constructor(config: AgentConfig) {
                this.session = AgentSession.fromSnapshot(
                    (config.session ?? new AgentSession({ systemPrompt: config.systemPrompt })).toSnapshot(),
                );
            }

            async run(prompt: string, callbacks?: AgentCallbacks): Promise<string> {
                const startedAt = new Date('2026-03-22T00:00:02.000Z');
                const completedAt = new Date('2026-03-22T00:00:03.000Z');
                this.session.addUserMessage(prompt);
                callbacks?.onToolStart?.('run_command', { command: 'pnpm test' });
                callbacks?.onToolEnd?.('run_command', 'test failure', false, {
                    toolCallId: 'tool-crash-1',
                    command: 'pnpm test',
                    cwd: '/workspace/demo',
                });
                this.session.recordToolExecution({
                    id: 'tool-crash-1',
                    name: 'run_command',
                    args: { command: 'pnpm test' },
                    success: false,
                    output: 'test failure',
                    error: 'simulated daemon crash',
                    startedAt,
                    completedAt,
                    metadata: {
                        command: 'pnpm test',
                        cwd: '/workspace/demo',
                    },
                });
                this.session.addToolResult('tool-crash-1', '错误: test failure');
                throw new Error('simulated daemon crash');
            }

            cancel(): void {}

            getSessionSnapshot() {
                return this.session.toSnapshot();
            }

            async dispose(): Promise<void> {}
        }

        const seeded = new AgentSession({
            id: 'session-local-crash-checkpoint',
            title: 'Crash checkpoint',
            createdAt: new Date('2026-03-22T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system' },
            ],
        });
        const sessionStore = createLocalSessionStore();
        sessionStore.seed(seeded, {
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Crash checkpoint',
        });

        const service = new TuiAgentService(sessionStore.store, {
            createAgent: (config) => new CrashCheckpointAgent(config),
        });

        await expect(service.sendMessage('run the failing tests', seeded.id, {
            dir: '/workspace/demo',
            model: 'gpt-4.1',
            agent: 'general',
            sandboxMode: 'project',
        }, [], {
            onEvent: () => {},
        })).rejects.toThrow('simulated daemon crash');

        const snapshot = sessionStore.store.getSessionSnapshot(seeded.id);
        expect(snapshot?.messages.map((message) => message.role)).toEqual(['system', 'user', 'tool']);
        expect(snapshot?.messages.at(-1)).toMatchObject({
            role: 'tool',
            toolCallId: 'tool-crash-1',
            content: '错误: test failure',
        });
        expect(snapshot?.metadata.toolHistory).toEqual([
            expect.objectContaining({
                id: 'tool-crash-1',
                name: 'run_command',
                success: false,
            }),
        ]);
        expect(snapshot?.metadata.commandHistory).toEqual([
            expect.objectContaining({
                command: 'pnpm test',
                cwd: '/workspace/demo',
            }),
        ]);
        expect(sessionStore.store.getSessionSummary(seeded.id)).toMatchObject({
            commandCount: 1,
        });
    });

    it('persists crash checkpoints durably through sqlite-backed session stores', async () => {
        class CrashCheckpointAgent {
            private readonly session: AgentSession;

            constructor(config: AgentConfig) {
                this.session = AgentSession.fromSnapshot(
                    (config.session ?? new AgentSession({ systemPrompt: config.systemPrompt })).toSnapshot(),
                );
            }

            async run(prompt: string, callbacks?: AgentCallbacks): Promise<string> {
                this.session.addUserMessage(prompt);
                callbacks?.onToolStart?.('run_command', { command: 'pnpm test' });
                callbacks?.onToolEnd?.('run_command', 'test failure', false, {
                    toolCallId: 'tool-crash-sqlite',
                    command: 'pnpm test',
                    cwd: '/workspace/sqlite-demo',
                });
                this.session.recordToolExecution({
                    id: 'tool-crash-sqlite',
                    name: 'run_command',
                    args: { command: 'pnpm test' },
                    success: false,
                    output: 'test failure',
                    error: 'simulated daemon crash',
                    startedAt: new Date('2026-03-23T00:00:02.000Z'),
                    completedAt: new Date('2026-03-23T00:00:03.000Z'),
                    metadata: {
                        command: 'pnpm test',
                        cwd: '/workspace/sqlite-demo',
                    },
                });
                this.session.addToolResult('tool-crash-sqlite', '错误: test failure');
                throw new Error('simulated daemon crash');
            }

            cancel(): void {}

            getSessionSnapshot() {
                return this.session.toSnapshot();
            }

            async dispose(): Promise<void> {}
        }

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-sqlite-crash-checkpoint-'));
        const dbPath = path.join(tempDir, 'sessions.sqlite');
        const sessionStore = new SQLiteSessionStore(dbPath);
        const seeded = new AgentSession({
            id: 'session-sqlite-crash-checkpoint',
            title: 'Crash checkpoint sqlite',
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system' },
            ],
        });

        try {
            sessionStore.saveSessionSnapshot({
                session: seeded,
                projectRoot: '/workspace/sqlite-demo',
                cwd: '/workspace/sqlite-demo',
                model: 'gpt-4.1',
                title: seeded.getTitle(),
            });

            const service = new TuiAgentService(sessionStore, {
                createAgent: (config) => new CrashCheckpointAgent(config),
            });

            await expect(service.sendMessage('run the failing tests', seeded.id, {
                dir: '/workspace/sqlite-demo',
                model: 'gpt-4.1',
                agent: 'general',
                sandboxMode: 'project',
            }, [], {
                onEvent: () => {},
            })).rejects.toThrow('simulated daemon crash');
        } finally {
            sessionStore.close();
        }

        const reopenedStore = new SQLiteSessionStore(dbPath);
        try {
            const snapshot = reopenedStore.getSessionSnapshot(seeded.id);
            expect(snapshot?.messages.map((message) => message.role)).toEqual(['system', 'user', 'tool']);
            expect(snapshot?.messages.at(-1)).toMatchObject({
                role: 'tool',
                toolCallId: 'tool-crash-sqlite',
                content: '错误: test failure',
            });
            expect(snapshot?.metadata.commandHistory).toEqual([
                expect.objectContaining({
                    command: 'pnpm test',
                    cwd: '/workspace/sqlite-demo',
                    success: false,
                }),
            ]);
        } finally {
            reopenedStore.close();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
