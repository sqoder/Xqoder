import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { normalizeLLMConfig } from '@xqoder/shared';
import { resolveSessionForReuse } from './session-resolve.js';
import { openChatSessionAccess, resolveRuntimeSessionStore, runChatHeadless, runNonInteractivePrompt } from './chat-service.js';
import { createRuntimeSessionKernelHandle, openInMemoryRuntimeSessionKernel } from './runtime-session-kernel.js';

function createSnapshotWritableSessionStore(overrides: Record<string, unknown> = {}) {
    const saveSessionSnapshot = vi.fn((input: {
        session: AgentSession;
        projectRoot: string;
        cwd: string;
        model: string;
        title?: string;
    }) => {
        const snapshot = input.session.toSnapshot();
        let lastUserMessage: string | undefined;
        for (let i = snapshot.messages.length - 1; i >= 0; i--) {
            const message = snapshot.messages[i];
            if (message?.role === 'user') {
                lastUserMessage = message.content;
                break;
            }
        }
        return {
            id: snapshot.id,
            projectRoot: input.projectRoot,
            cwd: input.cwd,
            model: input.model,
            title: input.title?.trim() || snapshot.title?.trim() || 'Session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            updatedAt: new Date('2026-03-20T00:00:00.000Z'),
            maxMessages: snapshot.maxMessages,
            messageCount: snapshot.messages.length,
            usage: snapshot.usage,
            ...(lastUserMessage ? { lastUserMessage } : {}),
            compactionCount: snapshot.metadata.compactions.length,
            commandCount: snapshot.metadata.commandHistory.length,
            fileChangeCount: snapshot.metadata.fileChanges.length,
        };
    });

    return {
        getSessionSnapshot: vi.fn().mockReturnValue(null),
        getSessionSummary: vi.fn().mockReturnValue(null),
        listSessions: vi.fn().mockReturnValue([]),
        saveSessionSnapshot,
        ...overrides,
    };
}

describe('runNonInteractivePrompt', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    afterEach(() => {
        stdoutWrite.mockClear();
    });

    it('builds a non-interactive agent config with session title, shell, and auto approval', async () => {
        const run = vi.fn().mockResolvedValue('done');
        const handle = openInMemoryRuntimeSessionKernel({
            projectRoot: '/tmp/xqoder-non-interactive',
            model: 'gpt-4.1',
        });

        try {
            await runNonInteractivePrompt({
                prompt: 'Explain the use of context in Go',
                cwd: '/tmp/xqoder-non-interactive',
                outputFormat: 'text',
                quiet: true,
                agent: 'coder',
            }, {
                configManager: {
                    load: () => ({
                        llm: normalizeLLMConfig({
                            provider: 'openai',
                            model: 'gpt-4.1',
                            apiKey: 'test-key',
                        }),
                        providers: {
                            openai: {
                                apiKey: 'test-key',
                                defaultModel: 'gpt-4.1',
                            },
                        },
                        defaultAgent: 'general',
                        agents: {},
                        instructions: [],
                        commands: {},
                        permissions: { defaultMode: 'ask', tools: {} },
                        sandbox: {
                            mode: 'project',
                            allowedPaths: [],
                        },
                        shell: {
                            path: '/bin/zsh',
                            args: ['-l'],
                        },
                        vercel: {},
                        mcp: { servers: [] },
                        lsp: { servers: [] },
                        debug: false,
                        recentProjects: [],
                        share: 'manual',
                        autoupdate: true,
                        contextPaths: ['CLAUDE.md'],
                        theme: 'xqoder',
                        tui: { mouseMode: 'terminal', scrollStep: 3 },
                    }),
                },
                sessionKernelHandle: handle,
                agentFactory: (config) => {
                    expect(config.sessionTitle).toBe('Non-interactive: Explain the use of context in Go');
                    expect(config.autoApproveTools).toBe(true);
                    expect(config.shell).toEqual({
                        path: '/bin/zsh',
                        args: ['-l'],
                    });

                    return {
                        run,
                    };
                },
            });
        } finally {
            handle.close();
        }

        expect(run).toHaveBeenCalledWith(
            'Explain the use of context in Go',
            expect.objectContaining({
                onToken: expect.any(Function),
                onToolApproval: expect.any(Function),
            }),
            expect.any(Array),
        );
    });
});

describe('resolveRuntimeSessionStore', () => {
    it('returns the original store when runtime session APIs already exist', () => {
        const store = {
            getSessionSnapshot: vi.fn(),
            getSessionSummary: vi.fn(),
            listSessions: vi.fn(),
            saveSessionSnapshot: vi.fn(),
            appendSessionMessage: vi.fn(),
        };

        const resolved = resolveRuntimeSessionStore(store, {
            projectRoot: '/tmp/xqoder-runtime-store',
            cwd: '/tmp/xqoder-runtime-store',
            model: 'gpt-4.1',
        });

        expect(resolved).toBe(store);
    });

    it('returns the original store when runtime session APIs already exist via saveSessionSnapshot', () => {
        const store = {
            getSessionSnapshot: vi.fn(),
            getSessionSummary: vi.fn(),
            listSessions: vi.fn(),
            saveSessionSnapshot: vi.fn(),
            appendSessionMessage: vi.fn(),
        };

        const resolved = resolveRuntimeSessionStore(store, {
            projectRoot: '/tmp/xqoder-runtime-store-snapshot',
            cwd: '/tmp/xqoder-runtime-store-snapshot',
            model: 'gpt-4.1',
        });

        expect(resolved).toBe(store);
    });

    it('wraps legacy stores only when runtime session APIs are missing', () => {
        const store = createSnapshotWritableSessionStore();

        const resolved = resolveRuntimeSessionStore(store, {
            projectRoot: '/tmp/xqoder-legacy-store',
            cwd: '/tmp/xqoder-legacy-store',
            model: 'gpt-4.1',
        });

        expect(resolved).not.toBe(store);

        const summary = resolved.saveSessionSnapshot({
            session: new AgentSession({
                id: 'session_legacy',
                title: 'legacy session',
            }),
            projectRoot: '/tmp/xqoder-legacy-store',
            cwd: '/tmp/xqoder-legacy-store',
            model: 'gpt-4.1',
        });

        expect(summary).toMatchObject({
            id: 'session_legacy',
            projectRoot: '/tmp/xqoder-legacy-store',
            cwd: '/tmp/xqoder-legacy-store',
            model: 'gpt-4.1',
            title: 'legacy session',
        });
    });

    it('fills lastUserMessage in legacy snapshot fallback summaries', () => {
        const store = createSnapshotWritableSessionStore();

        const resolved = resolveRuntimeSessionStore(store, {
            projectRoot: '/tmp/xqoder-legacy-save',
            cwd: '/tmp/xqoder-legacy-save',
            model: 'gpt-4.1',
        });

        const summary = resolved.saveSessionSnapshot({
            session: new AgentSession({
                id: 'session_legacy_save',
                messages: [
                    { role: 'system', content: 'system prompt' },
                    { role: 'user', content: 'first user message' },
                    { role: 'assistant', content: 'assistant reply' },
                ],
            }),
            projectRoot: '/tmp/xqoder-legacy-save',
            cwd: '/tmp/xqoder-legacy-save',
            model: 'gpt-4.1',
        });

        expect(summary).toMatchObject({
            id: 'session_legacy_save',
            projectRoot: '/tmp/xqoder-legacy-save',
            cwd: '/tmp/xqoder-legacy-save',
            model: 'gpt-4.1',
            title: 'Session',
            messageCount: 3,
            lastUserMessage: 'first user message',
        });
    });

    it('mirrors legacy appendSessionMessage results into the local runtime cache', () => {
        const store = createSnapshotWritableSessionStore();

        const resolved = resolveRuntimeSessionStore(store, {
            projectRoot: '/tmp/xqoder-legacy-append',
            cwd: '/tmp/xqoder-legacy-append',
            model: 'gpt-4.1',
        });

        const summary = resolved.appendSessionMessage({
            sessionId: 'session_legacy_append',
            message: {
                role: 'user',
                content: 'append user message',
            },
            projectRoot: '/tmp/xqoder-legacy-append',
            cwd: '/tmp/xqoder-legacy-append',
            model: 'gpt-4.1',
        });

        expect(summary).toMatchObject({
            id: 'session_legacy_append',
            projectRoot: '/tmp/xqoder-legacy-append',
            cwd: '/tmp/xqoder-legacy-append',
            model: 'gpt-4.1',
            title: 'Session',
            messageCount: 1,
            lastUserMessage: 'append user message',
        });

        const snapshot = resolved.getSessionSnapshot('session_legacy_append');
        expect(snapshot?.messages).toHaveLength(1);
        expect(snapshot?.messages[0]?.content).toBe('append user message');
    });

    it('derives session summaries from cached snapshots when getSessionSummary is unavailable', () => {
        const snapshotOnlySession = new AgentSession({
            id: 'session_snapshot_only_summary',
            title: 'snapshot-only session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'snapshot-only question' },
            ],
        });
        const store = {
            getSessionSnapshot: vi.fn((sessionId: string) => (
                sessionId === snapshotOnlySession.id ? snapshotOnlySession.toSnapshot() : null
            )),
            saveSessionSnapshot: vi.fn((input: {
                session: AgentSession;
                projectRoot: string;
                cwd: string;
                model: string;
                title?: string;
            }) => {
                const snapshot = input.session.toSnapshot();
                return {
                    id: snapshot.id,
                    projectRoot: input.projectRoot,
                    cwd: input.cwd,
                    model: input.model,
                    title: input.title?.trim() || snapshot.title?.trim() || 'Session',
                    createdAt: snapshot.createdAt,
                    updatedAt: new Date('2026-03-20T00:00:00.000Z'),
                    maxMessages: snapshot.maxMessages,
                    messageCount: snapshot.messages.length,
                    usage: snapshot.usage,
                    compactionCount: 0,
                    commandCount: 0,
                    fileChangeCount: 0,
                };
            }),
        };

        const resolved = resolveRuntimeSessionStore(store, {
            projectRoot: '/tmp/xqoder-legacy-snapshot-only',
            cwd: '/tmp/xqoder-legacy-snapshot-only',
            model: 'gpt-4.1',
        });

        const cachedSnapshot = resolved.getSessionSnapshot(snapshotOnlySession.id);
        expect(cachedSnapshot?.id).toBe(snapshotOnlySession.id);

        const summary = resolved.getSessionSummary(snapshotOnlySession.id);
        expect(summary).toMatchObject({
            id: 'session_snapshot_only_summary',
            projectRoot: '/tmp/xqoder-legacy-snapshot-only',
            cwd: '/tmp/xqoder-legacy-snapshot-only',
            model: 'gpt-4.1',
            title: 'snapshot-only session',
            messageCount: 2,
            lastUserMessage: 'snapshot-only question',
        });
        expect(resolved.listSessions('/tmp/xqoder-legacy-snapshot-only', 5).map((entry) => entry.id)).toContain(
            'session_snapshot_only_summary',
        );
    });

    it('keeps compatibility summary reads snapshot-first without touching legacy summary/list APIs', () => {
        const snapshotOnlySession = new AgentSession({
            id: 'session_snapshot_first_summary',
            title: 'snapshot-first session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'snapshot-first question' },
            ],
        });
        const getSessionSummary = vi.fn(() => {
            throw new Error('legacy getSessionSummary should not be called');
        });
        const listSessions = vi.fn(() => {
            throw new Error('legacy listSessions should not be called');
        });
        const store = {
            getSessionSnapshot: vi.fn((sessionId: string) => (
                sessionId === snapshotOnlySession.id ? snapshotOnlySession.toSnapshot() : null
            )),
            getSessionSummary,
            listSessions,
            saveSessionSnapshot: vi.fn((input: {
                session: AgentSession;
                projectRoot: string;
                cwd: string;
                model: string;
                title?: string;
            }) => {
                const snapshot = input.session.toSnapshot();
                return {
                    id: snapshot.id,
                    projectRoot: input.projectRoot,
                    cwd: input.cwd,
                    model: input.model,
                    title: input.title?.trim() || snapshot.title?.trim() || 'Session',
                    createdAt: snapshot.createdAt,
                    updatedAt: new Date('2026-03-20T00:00:00.000Z'),
                    maxMessages: snapshot.maxMessages,
                    messageCount: snapshot.messages.length,
                    usage: snapshot.usage,
                    compactionCount: 0,
                    commandCount: 0,
                    fileChangeCount: 0,
                };
            }),
        };

        const resolved = resolveRuntimeSessionStore(store, {
            projectRoot: '/tmp/xqoder-legacy-snapshot-first',
            cwd: '/tmp/xqoder-legacy-snapshot-first',
            model: 'gpt-4.1',
        });

        const summary = resolved.getSessionSummary(snapshotOnlySession.id);
        expect(summary).toMatchObject({
            id: 'session_snapshot_first_summary',
            projectRoot: '/tmp/xqoder-legacy-snapshot-first',
            cwd: '/tmp/xqoder-legacy-snapshot-first',
            model: 'gpt-4.1',
            title: 'snapshot-first session',
            messageCount: 2,
            lastUserMessage: 'snapshot-first question',
        });
        expect(getSessionSummary).not.toHaveBeenCalled();
        expect(listSessions).not.toHaveBeenCalled();
    });
});

describe('openChatSessionAccess', () => {
    it('prefers an injected runtime-native handle over snapshot-store adaptation', () => {
        const handle = openInMemoryRuntimeSessionKernel({
            projectRoot: '/tmp/xqoder-chat-handle',
            model: 'gpt-4.1',
        });

        const access = openChatSessionAccess(handle, {
            projectRoot: '/tmp/xqoder-chat-handle',
            model: 'gpt-4.1',
        }, {
            allowMemoryFallback: false,
        });

        expect(access?.resolveStore).toBe(handle.kernel);
        expect(access?.runtimeStore).toBe(handle.store);

        access?.close();
    });

    it('adapts injected snapshot stores into a runtime resolve facade', async () => {
        const session = new AgentSession({
            id: 'session_access_adapter',
            title: 'adapter session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            messages: [
                { role: 'user', content: 'adapter question' },
            ],
        });
        const store = createSnapshotWritableSessionStore({
            getSessionSnapshot: vi.fn((sessionId: string) => (
                sessionId === session.id ? session.toSnapshot() : null
            )),
            getSessionSummary: vi.fn((sessionId: string) => (
                sessionId === session.id
                    ? {
                        id: session.id,
                        projectRoot: '/tmp/xqoder-chat-access-adapter',
                        cwd: '/tmp/xqoder-chat-access-adapter',
                        model: 'gpt-4.1',
                        title: 'adapter session',
                        createdAt: new Date('2026-03-20T00:00:00.000Z'),
                        updatedAt: new Date('2026-03-20T00:05:00.000Z'),
                        maxMessages: 100,
                        messageCount: 1,
                        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                        lastUserMessage: 'adapter question',
                        compactionCount: 0,
                        commandCount: 0,
                        fileChangeCount: 0,
                    }
                    : null
            )),
            listSessions: vi.fn().mockReturnValue([{
                id: session.id,
                projectRoot: '/tmp/xqoder-chat-access-adapter',
                cwd: '/tmp/xqoder-chat-access-adapter',
                model: 'gpt-4.1',
                title: 'adapter session',
                createdAt: new Date('2026-03-20T00:00:00.000Z'),
                updatedAt: new Date('2026-03-20T00:05:00.000Z'),
                maxMessages: 100,
                messageCount: 1,
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                lastUserMessage: 'adapter question',
                compactionCount: 0,
                commandCount: 0,
                fileChangeCount: 0,
            }]),
        });

        const access = openChatSessionAccess(store, {
            projectRoot: '/tmp/xqoder-chat-access-adapter',
            model: 'gpt-4.1',
        }, {
            allowMemoryFallback: false,
        });

        const record = await access?.resolveStore.loadSessionSnapshot?.(session.id);
        const listed = await access?.resolveStore.listSessions({
            projectRoot: '/tmp/xqoder-chat-access-adapter',
            limit: 1,
        });

        expect(record?.id).toBe(session.id);
        expect(record?.messages[0]?.content).toBe('adapter question');
        expect(listed?.map((entry) => entry.id)).toEqual([session.id]);
    });

    it('prefers a runtime-kernel handle on the default path', () => {
        const store = {
            getSessionSnapshot: vi.fn(),
            getSessionSummary: vi.fn(),
            listSessions: vi.fn(),
            saveSessionSnapshot: vi.fn(),
            appendSessionMessage: vi.fn(),
            close: vi.fn(),
        };
        const kernel = {
            listSessions: vi.fn(),
            loadSession: vi.fn(),
            loadSessionSnapshot: vi.fn(),
            saveSessionSnapshot: vi.fn(),
            commitSessionSnapshot: vi.fn(),
        };
        const close = vi.fn();
        const openSessionKernel = vi.fn(() => ({
            kernel,
            store,
            close,
        }));

        const access = openChatSessionAccess(undefined, {
            projectRoot: '/tmp/xqoder-chat-access',
            model: 'gpt-4.1',
        }, {
            allowMemoryFallback: false,
            openSessionKernel,
        });

        expect(openSessionKernel).toHaveBeenCalledWith({
            projectRoot: '/tmp/xqoder-chat-access',
            model: 'gpt-4.1',
        });
        expect(access?.resolveStore).toBe(kernel);
        expect(access?.runtimeStore).toBe(store);

        access?.close();
        expect(close).toHaveBeenCalledOnce();
    });

    it('falls back to an in-memory runtime store when kernel open fails and fallback is allowed', async () => {
        const access = openChatSessionAccess(undefined, {
            projectRoot: '/tmp/xqoder-chat-memory',
            model: 'gpt-4.1',
        }, {
            allowMemoryFallback: true,
            openSessionKernel: vi.fn(() => {
                throw new Error('open failed');
            }),
        });

        expect(access).toBeDefined();
        const summary = access!.runtimeStore.saveSessionSnapshot?.({
            session: new AgentSession({
                id: 'session_memory_only',
                messages: [{ role: 'user', content: 'memory message' }],
            }),
            projectRoot: '/tmp/xqoder-chat-memory',
            cwd: '/tmp/xqoder-chat-memory',
            model: 'gpt-4.1',
        });

        expect(summary).toMatchObject({
            id: 'session_memory_only',
            projectRoot: '/tmp/xqoder-chat-memory',
            model: 'gpt-4.1',
            messageCount: 1,
        });

        const reused = await resolveSessionForReuse(access!.resolveStore, {
            projectRoot: '/tmp/xqoder-chat-memory',
            newSession: false,
        });
        expect(reused?.id).toBe('session_memory_only');
        expect(reused?.getMessages()[0]?.content).toBe('memory message');
    });
});

describe('runChatHeadless', () => {
    it('keeps approval callback bridged through runtime policy in headless mode', async () => {
        const run = vi.fn().mockResolvedValue('ok');
        const handle = openInMemoryRuntimeSessionKernel({
            projectRoot: '/tmp/xqoder-headless',
            model: 'gpt-4.1',
        });

        try {
            await runChatHeadless('hello', {
                dir: '/tmp/xqoder-headless',
            }, {
                configManager: {
                    load: () => ({
                        llm: normalizeLLMConfig({
                            provider: 'openai',
                            model: 'gpt-4.1',
                            apiKey: 'test-key',
                        }),
                        providers: {
                            openai: {
                                apiKey: 'test-key',
                                defaultModel: 'gpt-4.1',
                            },
                        },
                        defaultAgent: 'general',
                        agents: {},
                        instructions: [],
                        commands: {},
                        permissions: { defaultMode: 'ask', tools: {} },
                        sandbox: {
                            mode: 'project',
                            allowedPaths: [],
                        },
                        vercel: {},
                        mcp: { servers: [] },
                        lsp: { servers: [] },
                        debug: false,
                        recentProjects: [],
                        share: 'manual',
                        autoupdate: true,
                        contextPaths: ['CLAUDE.md'],
                        theme: 'xqoder',
                        tui: { mouseMode: 'terminal', scrollStep: 3 },
                    }),
                },
                sessionKernelHandle: handle,
                agentFactory: () => ({
                    run,
                }),
            });
        } finally {
            handle.close();
        }

        const callbacks = run.mock.calls[0]?.[1] as {
            onToolApproval?: (request: {
                toolCallId: string;
                toolName: string;
                summary: string;
                reason?: string;
                preview?: string;
                risk?: 'low' | 'medium' | 'high';
            }) => Promise<boolean> | boolean;
        };
        expect(typeof callbacks.onToolApproval).toBe('function');
        const decision = await callbacks.onToolApproval?.({
            toolCallId: 'tool_1',
            toolName: 'write_file',
            summary: 'write file',
        });
        expect(decision).toBe(false);
    });

    it('preserves attachment kind through the headless runtime pipeline', async () => {
        const seenAttachments: unknown[] = [];
        const handle = openInMemoryRuntimeSessionKernel({
            projectRoot: '/tmp/xqoder-headless',
            model: 'gpt-4.1',
        });

        try {
            await runChatHeadless('describe attachment', {
                dir: '/tmp/xqoder-headless',
                attachments: [{
                    kind: 'image',
                    type: 'image',
                    mimeType: 'image/png',
                    data: 'Zm9v',
                    fileName: 'diagram.png',
                    filePath: '/tmp/diagram.png',
                }],
            }, {
                configManager: {
                    load: () => ({
                        llm: normalizeLLMConfig({
                            provider: 'openai',
                            model: 'gpt-4.1',
                            apiKey: 'test-key',
                        }),
                        providers: {
                            openai: {
                                apiKey: 'test-key',
                                defaultModel: 'gpt-4.1',
                            },
                        },
                        defaultAgent: 'general',
                        agents: {},
                        instructions: [],
                        commands: {},
                        permissions: { defaultMode: 'ask', tools: {} },
                        sandbox: {
                            mode: 'project',
                            allowedPaths: [],
                        },
                        vercel: {},
                        mcp: { servers: [] },
                        lsp: { servers: [] },
                        debug: false,
                        recentProjects: [],
                        share: 'manual',
                        autoupdate: true,
                        contextPaths: ['CLAUDE.md'],
                        theme: 'xqoder',
                        tui: { mouseMode: 'terminal', scrollStep: 3 },
                    }),
                },
                sessionKernelHandle: handle,
                agentFactory: (_config) => ({
                    run: async (_prompt, _callbacks, attachments) => {
                        seenAttachments.push(...(attachments ?? []));
                        return 'ok';
                    },
                }),
            });
        } finally {
            handle.close();
        }

        expect(seenAttachments).toEqual([{
            kind: 'image',
            type: 'image',
            mimeType: 'image/png',
            data: 'Zm9v',
            fileName: 'diagram.png',
            filePath: '/tmp/diagram.png',
        }]);
    });

    it('prefers kernel-oriented session append APIs over deprecated saveSession during runtime chat', async () => {
        const saveSession = vi.fn();
        const appendSessionMessage = vi.fn().mockImplementation((input: {
            sessionId: string;
            projectRoot: string;
            cwd: string;
            model: string;
            title?: string;
            message: {
                role: 'system' | 'user' | 'assistant' | 'tool';
                content: string;
            };
        }) => ({
            id: input.sessionId,
            projectRoot: input.projectRoot,
            cwd: input.cwd,
            model: input.model,
            title: input.title ?? 'Session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            updatedAt: new Date('2026-03-20T00:00:00.000Z'),
            maxMessages: 100,
            messageCount: appendSessionMessage.mock.calls.length,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            compactionCount: 0,
            commandCount: 0,
            fileChangeCount: 0,
        }));
        const store = {
            getSessionSnapshot: vi.fn().mockReturnValue(null),
            getSessionSummary: vi.fn().mockReturnValue(null),
            listSessions: vi.fn().mockReturnValue([]),
            saveSessionSnapshot: vi.fn(),
            appendSessionMessage,
            saveSession,
        };
        const handle = createRuntimeSessionKernelHandle(store, {
            projectRoot: '/tmp/xqoder-headless-kernel',
            model: 'gpt-4.1',
        });

        try {
            const result = await runChatHeadless('hello kernel session', {
                dir: '/tmp/xqoder-headless-kernel',
            }, {
                configManager: {
                    load: () => ({
                        llm: normalizeLLMConfig({
                            provider: 'openai',
                            model: 'gpt-4.1',
                            apiKey: 'test-key',
                        }),
                        providers: {
                            openai: {
                                apiKey: 'test-key',
                                defaultModel: 'gpt-4.1',
                            },
                        },
                        defaultAgent: 'general',
                        agents: {},
                        instructions: [],
                        commands: {},
                        permissions: { defaultMode: 'ask', tools: {} },
                        sandbox: {
                            mode: 'project',
                            allowedPaths: [],
                        },
                        vercel: {},
                        mcp: { servers: [] },
                        lsp: { servers: [] },
                        debug: false,
                        recentProjects: [],
                        share: 'manual',
                        autoupdate: true,
                        contextPaths: ['CLAUDE.md'],
                        theme: 'xqoder',
                        tui: { mouseMode: 'terminal', scrollStep: 3 },
                    }),
                },
                sessionKernelHandle: handle,
                agentFactory: (_config) => ({
                    run: async () => 'kernel path ok',
                }),
            });

            expect(result.response).toBe('kernel path ok');
            expect(appendSessionMessage).toHaveBeenCalledTimes(2);
            expect(result.sessionId).toBe(appendSessionMessage.mock.calls[0]?.[0].sessionId);
            expect(appendSessionMessage.mock.calls[0]?.[0].message).toMatchObject({
                role: 'user',
                content: 'hello kernel session',
            });
            expect(appendSessionMessage.mock.calls[1]?.[0].message).toMatchObject({
                role: 'assistant',
                content: 'kernel path ok',
            });
            expect(saveSession).not.toHaveBeenCalled();
        } finally {
            handle.close();
        }
    });
});
