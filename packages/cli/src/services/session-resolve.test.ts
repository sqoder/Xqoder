import { describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { InMemorySessionStore, RuntimeKernel } from '@xqoder/runtime';
import {
    resolveSessionById,
    resolveSessionExistsById,
    resolveSessionForExport,
    resolveSessionForReuse,
    resolveSessionForTui,
    resolveSessionSummaryById,
    toPersistedSessionSummary,
} from './session-resolve.js';

describe('session-resolve', () => {
    it('prefers latest session snapshots for export resolution', async () => {
        const session = new AgentSession({
            id: 'session_latest',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'latest question' },
                { role: 'assistant', content: 'latest answer' },
            ],
        });
        const listSessions = vi.fn().mockReturnValue([{
            id: 'session_latest',
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
            title: 'latest',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            updatedAt: new Date('2026-03-08T00:05:00.000Z'),
            maxMessages: 100,
            messageCount: 3,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        }]);

        const resolved = await resolveSessionForExport({
            getSessionSnapshot: vi.fn().mockReturnValue(session.toSnapshot()),
            getSessionSummary: vi.fn().mockReturnValue({
                id: 'session_latest',
                projectRoot: '/workspace/demo',
                cwd: '/workspace/demo',
                model: 'gpt-4o',
                title: 'latest',
                createdAt: new Date('2026-03-08T00:00:00.000Z'),
                updatedAt: new Date('2026-03-08T00:05:00.000Z'),
                maxMessages: 100,
                messageCount: 3,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            }),
            listSessions,
        }, undefined, '/workspace/demo');

        expect(resolved.session.id).toBe('session_latest');
        expect(listSessions).toHaveBeenCalledWith('/workspace/demo', 1);
    });

    it('prefers latest session snapshots for tui resolution', async () => {
        const session = new AgentSession({
            id: 'session_latest',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'latest question' },
            ],
        });
        const listSessions = vi.fn().mockReturnValue([{
            id: 'session_latest',
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
            title: 'latest',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            updatedAt: new Date('2026-03-08T00:05:00.000Z'),
            maxMessages: 100,
            messageCount: 2,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        }]);

        const resolved = await resolveSessionForTui({
            getSessionSnapshot: vi.fn().mockReturnValue(session.toSnapshot()),
            getSessionSummary: vi.fn().mockReturnValue({
                id: 'session_latest',
                projectRoot: '/workspace/demo',
                cwd: '/workspace/demo',
                model: 'gpt-4o',
                title: 'latest',
                createdAt: new Date('2026-03-08T00:00:00.000Z'),
                updatedAt: new Date('2026-03-08T00:05:00.000Z'),
                maxMessages: 100,
                messageCount: 2,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            }),
            listSessions,
        }, '/workspace/demo', 'latest');

        expect(resolved).toEqual({
            sessionId: 'session_latest',
            title: 'latest',
        });
        expect(listSessions).toHaveBeenCalledWith('/workspace/demo', 1);
    });

    it('resolves sessions from runtime-kernel records', async () => {
        const kernel = new RuntimeKernel({
            sessionStore: new InMemorySessionStore(),
            permissionPolicy: {
                evaluate: async () => 'allow' as const,
            },
        });

        await kernel.saveSessionSnapshot({
            id: 'session_runtime',
            cwd: '/workspace/demo',
            title: 'runtime session',
            createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
            updatedAt: new Date('2026-03-08T00:05:00.000Z').getTime(),
            messages: [
                {
                    id: 'msg_1',
                    sessionId: 'session_runtime',
                    role: 'user',
                    content: 'runtime user question',
                    createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
                },
                {
                    id: 'msg_2',
                    sessionId: 'session_runtime',
                    role: 'assistant',
                    content: 'runtime answer',
                    createdAt: new Date('2026-03-08T00:01:00.000Z').getTime(),
                },
            ],
            metadata: {
                projectRoot: '/workspace/demo',
                model: 'gpt-4o',
                maxMessages: 100,
                messageCount: 2,
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
                commandCount: 1,
                fileChangeCount: 1,
                compactionCount: 0,
            },
        });

        const resolved = await resolveSessionForExport(kernel, undefined, '/workspace/demo');

        expect(resolved.summary.id).toBe('session_runtime');
        expect(resolved.summary.model).toBe('gpt-4o');
        expect(resolved.session.getMessages()).toHaveLength(2);
        expect(resolved.session.getMessages()[0]?.content).toBe('runtime user question');
    });

    it('derives summary counters from metadata arrays when explicit counter fields are absent', () => {
        const summary = toPersistedSessionSummary({
            id: 'session_summary_fallbacks',
            cwd: '/workspace/demo',
            title: 'summary fallbacks',
            createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
            updatedAt: new Date('2026-03-08T00:05:00.000Z').getTime(),
            messages: [
                {
                    id: 'msg_1',
                    sessionId: 'session_summary_fallbacks',
                    role: 'user',
                    content: 'hello',
                    createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
                },
                {
                    id: 'msg_2',
                    sessionId: 'session_summary_fallbacks',
                    role: 'assistant',
                    content: 'world',
                    createdAt: new Date('2026-03-08T00:01:00.000Z').getTime(),
                },
            ],
            metadata: {
                projectRoot: '/workspace/demo',
                model: 'gpt-4o',
                maxMessages: 120,
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
                compactions: [{
                    id: 'compact-1',
                    createdAt: '2026-03-08T00:02:00.000Z',
                    messageCountBefore: 5,
                    messageCountAfter: 2,
                    summary: 'compacted',
                }],
                commandHistory: [{
                    id: 'cmd-1',
                    command: 'pnpm test',
                    cwd: '/workspace/demo',
                    success: true,
                    outputPreview: 'ok',
                    startedAt: '2026-03-08T00:03:00.000Z',
                    completedAt: '2026-03-08T00:03:10.000Z',
                }],
                fileChanges: [{
                    id: 'file-1',
                    path: '/workspace/demo/src/index.ts',
                    changeType: 'write',
                    bytes: 42,
                    success: true,
                    timestamp: '2026-03-08T00:04:00.000Z',
                }],
            },
        });

        expect(summary.messageCount).toBe(2);
        expect(summary.compactionCount).toBe(1);
        expect(summary.commandCount).toBe(1);
        expect(summary.fileChangeCount).toBe(1);
        expect(summary.usage.totalTokens).toBe(15);
    });

    it('preserves full message metadata when resolving runtime-kernel records', async () => {
        const kernel = new RuntimeKernel({
            sessionStore: new InMemorySessionStore(),
            permissionPolicy: {
                evaluate: async () => 'allow' as const,
            },
        });

        await kernel.saveSessionSnapshot({
            id: 'session_full',
            cwd: '/workspace/demo',
            title: 'full fidelity session',
            createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
            updatedAt: new Date('2026-03-08T00:05:00.000Z').getTime(),
            messages: [
                {
                    id: 'msg_full',
                    sessionId: 'session_full',
                    role: 'assistant',
                    content: 'full reply',
                    createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
                    toolCallId: 'tool-1',
                    thinking: 'planning the next step',
                    toolCalls: [{
                        id: 'tool-1',
                        name: 'read_file',
                        arguments: '{"path":"/workspace/demo/README.md"}',
                    }],
                    attachments: [{
                        kind: 'file',
                        mimeType: 'text/plain',
                        data: 'Y29udGVudA==',
                        fileName: 'notes.txt',
                        filePath: '/workspace/demo/notes.txt',
                        url: 'file:///workspace/demo/notes.txt',
                    }],
                    parts: [
                        { type: 'text', text: 'full reply' },
                        { type: 'reasoning', text: 'planning the next step' },
                        {
                            type: 'tool_call',
                            toolCall: {
                                id: 'tool-1',
                                name: 'read_file',
                                arguments: '{"path":"/workspace/demo/README.md"}',
                            },
                        },
                        { type: 'finish', reason: 'stop' },
                    ],
                },
            ],
            metadata: {
                projectRoot: '/workspace/demo',
                model: 'gpt-4o',
                maxMessages: 100,
                messageCount: 1,
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
                commandCount: 0,
                fileChangeCount: 0,
                compactionCount: 0,
            },
        });

        const resolved = await resolveSessionForExport(kernel, undefined, '/workspace/demo');
        const message = resolved.session.getMessages()[0];

        expect(message).toMatchObject({
            role: 'assistant',
            content: 'full reply',
            toolCallId: 'tool-1',
            thinking: 'planning the next step',
            toolCalls: [{
                id: 'tool-1',
                name: 'read_file',
                arguments: '{"path":"/workspace/demo/README.md"}',
            }],
            attachments: [{
                kind: 'file',
                mimeType: 'text/plain',
                data: 'Y29udGVudA==',
                fileName: 'notes.txt',
                filePath: '/workspace/demo/notes.txt',
                url: 'file:///workspace/demo/notes.txt',
            }],
            parts: [
                { type: 'text', text: 'full reply' },
                { type: 'reasoning', text: 'planning the next step' },
                {
                    type: 'tool_call',
                    toolCall: {
                        id: 'tool-1',
                        name: 'read_file',
                        arguments: '{"path":"/workspace/demo/README.md"}',
                    },
                },
                { type: 'finish', reason: 'stop' },
            ],
        });
    });

    it('reuses the latest runtime-kernel session for chat-like flows', async () => {
        const kernel = new RuntimeKernel({
            sessionStore: new InMemorySessionStore(),
            permissionPolicy: {
                evaluate: async () => 'allow' as const,
            },
        });

        await kernel.saveSessionSnapshot({
            id: 'session_reuse',
            cwd: '/workspace/demo',
            title: 'reuse session',
            createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
            updatedAt: new Date('2026-03-08T00:06:00.000Z').getTime(),
            messages: [
                {
                    id: 'msg_user',
                    sessionId: 'session_reuse',
                    role: 'user',
                    content: 'continue from latest',
                    createdAt: new Date('2026-03-08T00:05:00.000Z').getTime(),
                },
            ],
            metadata: {
                projectRoot: '/workspace/demo',
                model: 'gpt-4o',
                maxMessages: 100,
                messageCount: 1,
                promptTokens: 8,
                completionTokens: 0,
                totalTokens: 8,
                commandCount: 0,
                fileChangeCount: 0,
                compactionCount: 0,
            },
        });

        const resolved = await resolveSessionForReuse(kernel, {
            projectRoot: '/workspace/demo',
            newSession: false,
        });

        expect(resolved?.id).toBe('session_reuse');
        expect(resolved?.getMessages()[0]?.content).toBe('continue from latest');
    });

    it('reuses a snapshot-only legacy store without requiring getSession()', async () => {
        const session = new AgentSession({
            id: 'session_snapshot_only',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'user', content: 'snapshot only message' },
            ],
        });

        const resolved = await resolveSessionForReuse({
            getSessionSnapshot: vi.fn().mockReturnValue(session.toSnapshot()),
            listSessions: vi.fn().mockReturnValue([{
                id: 'session_snapshot_only',
                projectRoot: '/workspace/snapshot-only',
                cwd: '/workspace/snapshot-only',
                model: 'gpt-4.1',
                title: 'snapshot only',
                createdAt: new Date('2026-03-08T00:00:00.000Z'),
                updatedAt: new Date('2026-03-08T00:05:00.000Z'),
                maxMessages: 100,
                messageCount: 1,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            }]),
        }, {
            projectRoot: '/workspace/snapshot-only',
            newSession: false,
        });

        expect(resolved?.id).toBe('session_snapshot_only');
        expect(resolved?.getMessages()[0]?.content).toBe('snapshot only message');
    });

    it('resolves session + summary by id through runtime-kernel store', async () => {
        const kernel = new RuntimeKernel({
            sessionStore: new InMemorySessionStore(),
            permissionPolicy: {
                evaluate: async () => 'allow' as const,
            },
        });

        await kernel.saveSessionSnapshot({
            id: 'session_by_id',
            cwd: '/workspace/demo',
            title: 'session by id',
            createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
            updatedAt: new Date('2026-03-08T00:05:00.000Z').getTime(),
            messages: [
                {
                    id: 'msg_user',
                    sessionId: 'session_by_id',
                    role: 'user',
                    content: 'load me by id',
                    createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
                },
            ],
            metadata: {
                projectRoot: '/workspace/demo',
                model: 'gpt-4o',
                maxMessages: 100,
                messageCount: 1,
                promptTokens: 1,
                completionTokens: 0,
                totalTokens: 1,
                commandCount: 0,
                fileChangeCount: 0,
                compactionCount: 0,
            },
        });

        const resolved = await resolveSessionById(kernel, 'session_by_id');
        expect(resolved?.session.id).toBe('session_by_id');
        expect(resolved?.session.getMessages()[0]?.content).toBe('load me by id');
        expect(resolved?.summary.title).toBe('session by id');
    });

    it('returns null when legacy store cannot provide summary for an existing snapshot', async () => {
        const session = new AgentSession({
            id: 'session_snapshot_only_no_summary',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'user', content: 'snapshot exists, summary missing' },
            ],
        });

        const resolved = await resolveSessionById({
            getSessionSnapshot: vi.fn().mockReturnValue(session.toSnapshot()),
        }, session.id);

        expect(resolved).toBeNull();
    });

    it('resolves summary by id from legacy summary-only store', async () => {
        const now = new Date('2026-03-08T00:00:00.000Z');
        const resolved = await resolveSessionSummaryById({
            getSessionSummary: vi.fn().mockReturnValue({
                id: 'session_summary_only',
                projectRoot: '/workspace/summary-only',
                cwd: '/workspace/summary-only',
                model: 'gpt-4.1',
                title: 'summary only',
                createdAt: now,
                updatedAt: now,
                maxMessages: 100,
                messageCount: 0,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            }),
        }, 'session_summary_only');

        expect(resolved?.id).toBe('session_summary_only');
        expect(resolved?.title).toBe('summary only');
    });

    it('prefers runtime snapshot records when resolving summary by id', async () => {
        const loadSessionSnapshot = vi.fn().mockResolvedValue({
            id: 'session_summary_runtime',
            cwd: '/workspace/runtime',
            title: 'runtime summary',
            createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
            updatedAt: new Date('2026-03-08T00:05:00.000Z').getTime(),
            messages: [],
            metadata: {
                projectRoot: '/workspace/runtime',
                model: 'gpt-4.1',
                maxMessages: 100,
                messageCount: 0,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                commandCount: 0,
                fileChangeCount: 0,
                compactionCount: 0,
            },
        });
        const resolved = await resolveSessionSummaryById({
            listSessions: vi.fn().mockResolvedValue([]),
            loadSessionSnapshot,
        }, 'session_summary_runtime');

        expect(resolved?.id).toBe('session_summary_runtime');
        expect(loadSessionSnapshot).toHaveBeenCalledWith('session_summary_runtime');
    });

    it('checks session existence by id through runtime-kernel store', async () => {
        const kernel = new RuntimeKernel({
            sessionStore: new InMemorySessionStore(),
            permissionPolicy: {
                evaluate: async () => 'allow' as const,
            },
        });
        await kernel.saveSessionSnapshot({
            id: 'session_exists_runtime',
            cwd: '/workspace/demo',
            title: 'runtime exists',
            createdAt: new Date('2026-03-08T00:00:00.000Z').getTime(),
            updatedAt: new Date('2026-03-08T00:05:00.000Z').getTime(),
            messages: [],
            metadata: {
                projectRoot: '/workspace/demo',
                model: 'gpt-4.1',
                maxMessages: 100,
                messageCount: 0,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                commandCount: 0,
                fileChangeCount: 0,
                compactionCount: 0,
            },
        });

        await expect(resolveSessionExistsById(kernel, 'session_exists_runtime')).resolves.toBe(true);
        await expect(resolveSessionExistsById(kernel, 'session_not_exists_runtime')).resolves.toBe(false);
    });

    it('checks session existence by id through legacy summary-only store', async () => {
        const getSessionSummary = vi.fn((sessionId: string) => (
            sessionId === 'session_exists_summary'
                ? {
                    id: 'session_exists_summary',
                    projectRoot: '/workspace/summary-only',
                    cwd: '/workspace/summary-only',
                    model: 'gpt-4.1',
                    title: 'summary exists',
                    createdAt: new Date('2026-03-08T00:00:00.000Z'),
                    updatedAt: new Date('2026-03-08T00:05:00.000Z'),
                    maxMessages: 100,
                    messageCount: 0,
                    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                    compactionCount: 0,
                    commandCount: 0,
                    fileChangeCount: 0,
                }
                : null
        ));
        const listSessions = vi.fn().mockReturnValue([]);

        const exists = await resolveSessionExistsById({
            getSessionSummary,
            listSessions,
        }, 'session_exists_summary');

        const missing = await resolveSessionExistsById({
            getSessionSummary: vi.fn().mockReturnValue(null),
            listSessions: vi.fn().mockReturnValue([]),
        }, 'session_missing_summary');

        expect(exists).toBe(true);
        expect(missing).toBe(false);
        expect(getSessionSummary).toHaveBeenCalledWith('session_exists_summary');
        expect(listSessions).not.toHaveBeenCalled();
    });

    it('returns undefined when legacy snapshot is missing', async () => {
        const resolved = await resolveSessionForReuse({
            getSessionSnapshot: vi.fn().mockReturnValue(null),
            listSessions: vi.fn().mockReturnValue([{
                id: 'session_no_snapshot',
                projectRoot: '/workspace/no-snapshot',
                cwd: '/workspace/no-snapshot',
                model: 'gpt-4.1',
                title: 'no snapshot',
                createdAt: new Date('2026-03-08T00:00:00.000Z'),
                updatedAt: new Date('2026-03-08T00:05:00.000Z'),
                maxMessages: 100,
                messageCount: 1,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            }]),
        }, {
            projectRoot: '/workspace/no-snapshot',
            newSession: false,
        });

        expect(resolved).toBeUndefined();
    });
});
