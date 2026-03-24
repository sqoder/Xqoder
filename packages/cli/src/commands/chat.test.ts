import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { openInMemoryRuntimeSessionKernel } from '../services/runtime-session-kernel.js';
import { createChatCommand, runChatCommand } from './chat.js';

describe('chat command', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const handles: Array<{ close(): void }> = [];

    function openSessionKernel(projectRoot: string, model: string) {
        const handle = openInMemoryRuntimeSessionKernel({ projectRoot, model });
        handles.push(handle);
        return handle;
    }

    afterEach(() => {
        stdoutWrite.mockClear();
        while (handles.length > 0) {
            handles.pop()?.close();
        }
    });

    afterAll(() => {
        stdoutWrite.mockRestore();
    });

    it('sends the user message to the agent with the resolved model and directory', async () => {
        const run = vi.fn().mockResolvedValue('你好');
        const handle = openSessionKernel('/workspace/demo', 'qwen-plus');

        await runChatCommand('你好', {
            dir: '/workspace/demo',
            model: 'qwen-plus',
        }, {
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'dashscope',
                        model: 'qwen-plus',
                        apiKey: 'test-key',
                        baseUrl: 'https://example.com',
                        temperature: 0,
                        maxTokens: 4096,
                    },
                    vercel: {},
                    debug: false,
                    recentProjects: [],
                }),
            },
            sessionKernelHandle: handle,
            agentFactory: (config) => {
                expect(config.cwd).toBe('/workspace/demo');
                expect(config.projectRoot).toBe('/workspace/demo');
                expect(config.llmConfig.model).toBe('qwen-plus');
                expect(config.session).toBeDefined();
                return { run };
            },
        });

        expect(run).toHaveBeenCalledWith('你好', expect.any(Object), expect.any(Array));
    });

    it('prefers latest session snapshots when resuming the current project by default', async () => {
        const run = vi.fn().mockResolvedValue('继续');
        const persistedSession = new AgentSession({
            id: 'session_saved',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '上一轮问题' },
                { role: 'assistant', content: '上一轮回答' },
            ],
        });
        const handle = openSessionKernel('/workspace/demo', 'gpt-4o');
        handle.store.saveSessionSnapshot({
            session: persistedSession,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
            title: 'Session',
        });
        const listSessions = vi.spyOn(handle.kernel, 'listSessions');
        const getSessionSnapshot = vi.spyOn(handle.kernel, 'loadSessionSnapshot');
        const appendSessionMessage = vi.spyOn(handle.store, 'appendSessionMessage');

        await runChatCommand('继续', {
            dir: '/workspace/demo',
            model: 'gpt-4o',
        }, {
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'openai',
                        model: 'gpt-4o',
                        apiKey: 'test-key',
                        maxTokens: 4096,
                        temperature: 0.1,
                    },
                    vercel: {},
                    sandbox: {
                        mode: 'project',
                        allowedPaths: [],
                    },
                    debug: false,
                    recentProjects: [],
                }),
            },
            sessionKernelHandle: handle,
            agentFactory: (config) => {
                expect(config.session?.id).toBe('session_saved');
                return { run };
            },
        });

        expect(listSessions).toHaveBeenCalledWith({
            projectRoot: '/workspace/demo',
            limit: 1,
        });
        expect(getSessionSnapshot).toHaveBeenCalledWith('session_saved');
        expect(appendSessionMessage).toHaveBeenCalledTimes(2);
        expect(appendSessionMessage.mock.calls[0]?.[0].message).toMatchObject({
            role: 'user',
            content: '继续',
        });
        expect(appendSessionMessage.mock.calls[1]?.[0].message).toMatchObject({
            role: 'assistant',
            content: '继续',
        });
    });

    it('skips session resume when the caller explicitly requests a new session', async () => {
        const run = vi.fn().mockResolvedValue('新的会话');
        const handle = openSessionKernel('/workspace/demo', 'gpt-4o');
        const appendSessionMessage = vi.spyOn(handle.store, 'appendSessionMessage');

        await runChatCommand('新的会话', {
            dir: '/workspace/demo',
            model: 'gpt-4o',
            newSession: true,
        }, {
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'openai',
                        model: 'gpt-4o',
                        apiKey: 'test-key',
                        maxTokens: 4096,
                        temperature: 0.1,
                    },
                    vercel: {},
                    sandbox: {
                        mode: 'project',
                        allowedPaths: [],
                    },
                    debug: false,
                    recentProjects: [],
                }),
            },
            sessionKernelHandle: handle,
            agentFactory: (config) => {
                expect(config.session).toBeDefined();
                return { run };
            },
        });

        expect(appendSessionMessage).toHaveBeenCalledTimes(2);
        expect(appendSessionMessage.mock.calls[0]?.[0].message).toMatchObject({
            role: 'user',
            content: '新的会话',
        });
        expect(appendSessionMessage.mock.calls[1]?.[0].message).toMatchObject({
            role: 'assistant',
            content: '新的会话',
        });
    });

    it('parses --dir and --new-session before the chat message', async () => {
        const run = vi.fn().mockResolvedValue('ok');
        const handle = openSessionKernel('/tmp/xqoder-tui-smoke', 'qwen-plus');
        const command = createChatCommand({
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'dashscope',
                        model: 'qwen-plus',
                        apiKey: 'test-key',
                        temperature: 0,
                        maxTokens: 4096,
                    },
                    vercel: {},
                    sandbox: {
                        mode: 'project',
                        allowedPaths: [],
                    },
                    debug: false,
                    recentProjects: [],
                }),
            },
            sessionKernelHandle: handle,
            agentFactory: (config) => {
                expect(config.cwd).toBe('/tmp/xqoder-tui-smoke');
                expect(config.projectRoot).toBe('/tmp/xqoder-tui-smoke');
                expect(config.session).toBeDefined();
                return { run };
            },
        });

        await command.parseAsync([
            '--dir',
            '/tmp/xqoder-tui-smoke',
            '--new-session',
            '记住标记 A-123',
        ], { from: 'user' });

        expect(run).toHaveBeenCalledWith('记住标记 A-123', expect.any(Object), expect.any(Array));
    });

    it('parses --dir and --session when the chat message appears before options', async () => {
        const run = vi.fn().mockResolvedValue('ok');
        const resumedSession = new AgentSession({
            id: 'session_A123',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: '记住标记 A-123' },
                { role: 'assistant', content: '已记住标记 A-123。' },
            ],
        });
        const handle = openSessionKernel('/tmp/xqoder-tui-smoke', 'qwen-plus');
        handle.store.saveSessionSnapshot({
            session: resumedSession,
            projectRoot: '/tmp/xqoder-tui-smoke',
            cwd: '/tmp/xqoder-tui-smoke',
            model: 'qwen-plus',
            title: resumedSession.getTitle(),
        });
        const command = createChatCommand({
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'dashscope',
                        model: 'qwen-plus',
                        apiKey: 'test-key',
                        temperature: 0,
                        maxTokens: 4096,
                    },
                    vercel: {},
                    sandbox: {
                        mode: 'project',
                        allowedPaths: [],
                    },
                    debug: false,
                    recentProjects: [],
                }),
            },
            sessionKernelHandle: handle,
            agentFactory: (config) => {
                expect(config.cwd).toBe('/tmp/xqoder-tui-smoke');
                expect(config.projectRoot).toBe('/tmp/xqoder-tui-smoke');
                expect(config.session?.id).toBe('session_A123');
                return { run };
            },
        });

        await command.parseAsync([
            '继续，重复当前会话里的标记。',
            '--dir',
            '/tmp/xqoder-tui-smoke',
            '--session',
            'session_A123',
        ], { from: 'user' });

        expect(run).toHaveBeenCalledWith('继续，重复当前会话里的标记。', expect.any(Object), expect.any(Array));
    });

    it('prefers session snapshots when resolving an explicit session id', async () => {
        const run = vi.fn().mockResolvedValue('ok');
        const resumedSession = new AgentSession({
            id: 'snapshot_session',
            createdAt: new Date('2026-03-08T00:00:00.000Z'),
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'snapshot question' },
                { role: 'assistant', content: 'snapshot answer' },
            ],
        });
        const handle = openSessionKernel('/workspace/demo', 'qwen-plus');
        handle.store.saveSessionSnapshot({
            session: resumedSession,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'qwen-plus',
            title: resumedSession.getTitle(),
        });
        const getSessionSnapshot = vi.spyOn(handle.kernel, 'loadSessionSnapshot');

        await runChatCommand('continue from snapshot', {
            dir: '/workspace/demo',
            model: 'qwen-plus',
            session: 'snapshot_session',
        }, {
            configManager: {
                load: () => ({
                    llm: {
                        provider: 'dashscope',
                        model: 'qwen-plus',
                        apiKey: 'test-key',
                        temperature: 0,
                        maxTokens: 4096,
                    },
                    vercel: {},
                    sandbox: {
                        mode: 'project',
                        allowedPaths: [],
                    },
                    debug: false,
                    recentProjects: [],
                }),
            },
            sessionKernelHandle: handle,
            agentFactory: (config) => {
                expect(config.session?.id).toBe('snapshot_session');
                expect(config.session?.getMessages()).toEqual(resumedSession.getMessages());
                return { run };
            },
        });

        expect(getSessionSnapshot).toHaveBeenCalledWith('snapshot_session');
        expect(run).toHaveBeenCalledWith('continue from snapshot', expect.any(Object), expect.any(Array));
    });
});
