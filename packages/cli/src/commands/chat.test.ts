import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { createChatCommand, runChatCommand } from './chat.js';

describe('chat command', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    afterEach(() => {
        stdoutWrite.mockClear();
    });

    afterAll(() => {
        stdoutWrite.mockRestore();
    });

    it('sends the user message to the agent with the resolved model and directory', async () => {
        const run = vi.fn().mockResolvedValue('你好');
        const session = new AgentSession('system prompt');

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
            sessionStore: {
                findLatestSession: vi.fn().mockReturnValue(null),
                getSession: vi.fn().mockReturnValue(null),
                saveSession: vi.fn(),
            },
            agentFactory: (config) => {
                expect(config.cwd).toBe('/workspace/demo');
                expect(config.projectRoot).toBe('/workspace/demo');
                expect(config.llmConfig.model).toBe('qwen-plus');
                expect(config.session).toBeUndefined();
                return { run, getSession: () => session };
            },
        });

        expect(run).toHaveBeenCalledWith('你好', expect.any(Object), expect.any(Array));
    });

    it('resumes the latest persisted session for the current project by default', async () => {
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
        const saveSession = vi.fn();
        const findLatestSession = vi.fn().mockReturnValue(persistedSession);

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
            sessionStore: {
                findLatestSession,
                getSession: vi.fn(),
                saveSession,
            },
            agentFactory: (config) => {
                expect(config.session?.id).toBe('session_saved');
                return { run, getSession: () => persistedSession };
            },
        });

        expect(findLatestSession).toHaveBeenCalledWith('/workspace/demo');
        expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({
            session: persistedSession,
            projectRoot: '/workspace/demo',
            cwd: '/workspace/demo',
            model: 'gpt-4o',
        }));
    });

    it('skips session resume when the caller explicitly requests a new session', async () => {
        const run = vi.fn().mockResolvedValue('新的会话');
        const saveSession = vi.fn();
        const findLatestSession = vi.fn();
        const session = new AgentSession('system prompt');

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
            sessionStore: {
                findLatestSession,
                getSession: vi.fn(),
                saveSession,
            },
            agentFactory: (config) => {
                expect(config.session).toBeUndefined();
                return { run, getSession: () => session };
            },
        });

        expect(findLatestSession).not.toHaveBeenCalled();
        expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({
            session,
            projectRoot: '/workspace/demo',
        }));
    });

    it('parses --dir and --new-session before the chat message', async () => {
        const run = vi.fn().mockResolvedValue('ok');
        const session = new AgentSession('system prompt');
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
            sessionStore: {
                findLatestSession: vi.fn(),
                getSession: vi.fn(),
                saveSession: vi.fn(),
            },
            agentFactory: (config) => {
                expect(config.cwd).toBe('/tmp/xqoder-tui-smoke');
                expect(config.projectRoot).toBe('/tmp/xqoder-tui-smoke');
                expect(config.session).toBeUndefined();
                return { run, getSession: () => session };
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
            sessionStore: {
                findLatestSession: vi.fn(),
                getSession: vi.fn((sessionId: string) => (
                    sessionId === 'session_A123' ? resumedSession : null
                )),
                saveSession: vi.fn(),
            },
            agentFactory: (config) => {
                expect(config.cwd).toBe('/tmp/xqoder-tui-smoke');
                expect(config.projectRoot).toBe('/tmp/xqoder-tui-smoke');
                expect(config.session?.id).toBe('session_A123');
                return { run, getSession: () => resumedSession };
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
});
