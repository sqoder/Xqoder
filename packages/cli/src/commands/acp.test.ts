import { describe, expect, it, vi } from 'vitest';
import { AgentSession, type AgentSessionSnapshot, type AgentSessionStore } from '@xqoder/agent';
import { runAcpChat, runAcpSessionList, runAcpSessionNew, runAcpSessionPrompt } from './acp.js';

function createKernelCompatibleSessionStoreMock(options: { snapshotOnly?: boolean } = {}) {
    const sessions = new Map<string, {
        summary: {
            id: string;
            projectRoot: string;
            cwd: string;
            model: string;
            title: string;
            createdAt: Date;
            updatedAt: Date;
            maxMessages: number;
            messageCount: number;
            usage: { promptTokens: number; completionTokens: number; totalTokens: number };
            compactionCount: number;
            commandCount: number;
            fileChangeCount: number;
            lastUserMessage?: string;
        };
        snapshot: AgentSessionSnapshot;
    }>();

    const close = vi.fn();
    const appendSessionMessage = vi.fn((input: {
        sessionId: string;
        message: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string };
        projectRoot: string;
        cwd: string;
        model: string;
        title?: string;
    }) => {
        const existing = sessions.get(input.sessionId)?.snapshot ?? {
            id: input.sessionId,
            title: input.title ?? 'New Session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            maxMessages: 100,
            messages: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            metadata: {
                compactions: [],
                commandHistory: [],
                fileChanges: [],
                toolHistory: [],
            },
        } satisfies AgentSessionSnapshot;

        const snapshot: AgentSessionSnapshot = {
            ...existing,
            ...(input.title ? { title: input.title } : {}),
            messages: [
                ...existing.messages,
                {
                    role: input.message.role,
                    content: input.message.content,
                    ...(input.message.toolCallId ? { toolCallId: input.message.toolCallId } : {}),
                },
            ],
        };

        const summary = {
            id: snapshot.id,
            projectRoot: input.projectRoot,
            cwd: input.cwd,
            model: input.model,
            title: snapshot.title ?? 'New Session',
            createdAt: snapshot.createdAt,
            updatedAt: new Date(),
            maxMessages: snapshot.maxMessages,
            messageCount: snapshot.messages.length,
            usage: snapshot.usage,
            compactionCount: snapshot.metadata.compactions.length,
            commandCount: snapshot.metadata.commandHistory.length,
            fileChangeCount: snapshot.metadata.fileChanges.length,
            lastUserMessage: snapshot.messages.filter((message) => message.role === 'user').at(-1)?.content,
        };

        sessions.set(summary.id, { summary, snapshot });
        return summary;
    });

    const store: Pick<
        AgentSessionStore,
        'getSessionSummary' | 'getSessionSnapshot' | 'listSessions' | 'saveSessionSnapshot' | 'appendSessionMessage' | 'close'
    > & {
        getSession?: (sessionId: string) => AgentSession | null;
    } = {
        getSessionSummary(sessionId) {
            return sessions.get(sessionId)?.summary ?? null;
        },
        getSessionSnapshot(sessionId) {
            return sessions.get(sessionId)?.snapshot ?? null;
        },
        listSessions(projectRoot, limit = 20) {
            return [...sessions.values()]
                .map((entry) => entry.summary)
                .filter((summary) => (!projectRoot || summary.projectRoot === projectRoot))
                .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
                .slice(0, Math.max(1, limit));
        },
        saveSessionSnapshot(input) {
            const snapshot = input.session.toSnapshot();
            const summary = {
                id: snapshot.id,
                projectRoot: input.projectRoot,
                cwd: input.cwd,
                model: input.model,
                title: input.title ?? snapshot.title ?? 'New Session',
                createdAt: snapshot.createdAt,
                updatedAt: new Date(),
                maxMessages: snapshot.maxMessages,
                messageCount: snapshot.messages.length,
                usage: snapshot.usage,
                compactionCount: snapshot.metadata.compactions.length,
                commandCount: snapshot.metadata.commandHistory.length,
                fileChangeCount: snapshot.metadata.fileChanges.length,
                lastUserMessage: undefined,
            };
            sessions.set(summary.id, { summary, snapshot });
            return summary;
        },
        appendSessionMessage,
        close,
    };

    if (!options.snapshotOnly) {
        store.getSession = (sessionId) => {
            const snapshot = sessions.get(sessionId)?.snapshot;
            return snapshot ? AgentSession.fromSnapshot(snapshot) : null;
        };
    }

    return { store, close, appendSessionMessage };
}

describe('acp session helpers', () => {
    it('creates a session through runtime kernel without requiring createEmptySession', async () => {
        const { store, close } = createKernelCompatibleSessionStoreMock();

        const result = await runAcpSessionNew({
            cwd: '/workspace/demo',
            title: 'ACP Session',
        }, '/workspace/base', {
            loadConfig: () => ({
                llm: {
                    provider: 'openai',
                    model: 'gpt-4.1',
                    apiKey: 'test-key',
                },
                vercel: {},
                debug: false,
                recentProjects: [],
            }),
            createSessionStore: () => store as AgentSessionStore,
        });

        expect(result.sessionId).toMatch(/^session_/);
        expect(close).toHaveBeenCalledTimes(1);
        expect(store.listSessions('/workspace/demo', 10)).toEqual([
            expect.objectContaining({
                id: result.sessionId,
                title: 'ACP Session',
                model: 'gpt-4.1',
            }),
        ]);
    });

    it('lists sessions through runtime kernel snapshot-backed records', async () => {
        const { store, close } = createKernelCompatibleSessionStoreMock();
        const seeded = new AgentSession({
            id: 'session_seeded',
            title: 'Seeded Session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            messages: [{ role: 'user', content: 'hello' }],
        });
        store.saveSessionSnapshot({
            session: seeded,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Seeded Session',
        });

        const result = await runAcpSessionList({
            cwd: '/workspace/demo',
            limit: 5,
        }, '/workspace/base', {
            createSessionStore: () => store as AgentSessionStore,
        });

        expect(result).toEqual({
            sessions: [
                expect.objectContaining({
                    sessionId: 'session_seeded',
                    cwd: '/workspace/demo',
                    title: 'Seeded Session',
                }),
            ],
            nextCursor: undefined,
        });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('runs session prompts through runtime kernel and persists appended messages', async () => {
        const { store, close, appendSessionMessage } = createKernelCompatibleSessionStoreMock();
        const seeded = new AgentSession({
            id: 'session_prompt_seeded',
            title: 'Prompt Session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            messages: [{ role: 'user', content: 'existing context' }],
        });
        store.saveSessionSnapshot({
            session: seeded,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Prompt Session',
        });

        const updates: string[] = [];
        const result = await runAcpSessionPrompt({
            sessionId: 'session_prompt_seeded',
            cwd: '/workspace/demo',
            content: [{ type: 'text', text: 'continue please' }],
        }, '/workspace/base', {
            loadConfig: () => ({
                llm: {
                    provider: 'openai',
                    model: 'gpt-4.1',
                    apiKey: 'test-key',
                },
                vercel: {},
                debug: false,
                recentProjects: [],
            }),
            createSessionStore: () => store as AgentSessionStore,
            emitUpdate: (notification) => {
                updates.push(notification.params.update.content.text);
            },
            createAgent: (config) => ({
                run: async (_prompt, callbacks) => {
                    callbacks?.onToken?.('Hello from kernel');
                    return 'Hello from kernel';
                },
                dispose: async () => {
                    void config;
                },
            }),
        });

        expect(result).toEqual({ stopReason: 'complete' });
        expect(updates).toEqual(['Hello from kernel']);
        expect(appendSessionMessage).toHaveBeenCalled();
        expect(store.getSessionSnapshot('session_prompt_seeded')?.messages.map((message) => message.role)).toEqual([
            'user',
            'user',
            'assistant',
        ]);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('runs session prompts with snapshot-only store (no getSession fallback)', async () => {
        const { store, close, appendSessionMessage } = createKernelCompatibleSessionStoreMock({ snapshotOnly: true });
        const seeded = new AgentSession({
            id: 'session_prompt_snapshot_only',
            title: 'Prompt Session',
            createdAt: new Date('2026-03-20T00:00:00.000Z'),
            messages: [{ role: 'user', content: 'existing context' }],
        });
        store.saveSessionSnapshot({
            session: seeded,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4.1',
            title: 'Prompt Session',
        });

        const result = await runAcpSessionPrompt({
            sessionId: 'session_prompt_snapshot_only',
            cwd: '/workspace/demo',
            content: [{ type: 'text', text: 'continue please' }],
        }, '/workspace/base', {
            loadConfig: () => ({
                llm: {
                    provider: 'openai',
                    model: 'gpt-4.1',
                    apiKey: 'test-key',
                },
                vercel: {},
                debug: false,
                recentProjects: [],
            }),
            createSessionStore: () => store as AgentSessionStore,
            createAgent: () => ({
                run: async (_prompt, callbacks) => {
                    callbacks?.onToken?.('Hello from kernel');
                    return 'Hello from kernel';
                },
                dispose: async () => {},
            }),
        });

        expect(result).toEqual({ stopReason: 'complete' });
        expect(appendSessionMessage).toHaveBeenCalled();
        expect(store.getSessionSnapshot('session_prompt_snapshot_only')?.messages.map((message) => message.role)).toEqual([
            'user',
            'user',
            'assistant',
        ]);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('runs stateless chat through runtime kernel and streams assistant tokens', async () => {
        const tokens: string[] = [];

        const result = await runAcpChat({
            message: 'say hello',
        }, '/workspace/demo', {
            loadConfig: () => ({
                llm: {
                    provider: 'openai',
                    model: 'gpt-4.1',
                    apiKey: 'test-key',
                },
                vercel: {},
                debug: false,
                recentProjects: [],
            }),
            emitToken: (token) => {
                tokens.push(token);
            },
            createAgent: () => ({
                run: async (_prompt, callbacks) => {
                    callbacks?.onToken?.('Hello ');
                    callbacks?.onToken?.('world');
                    return 'Hello world';
                },
                dispose: async () => {},
            }),
        });

        expect(tokens).toEqual(['Hello ', 'world']);
        expect(result).toEqual({
            type: 'complete',
            content: 'Hello world',
        });
    });
});
