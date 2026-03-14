import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { normalizeLLMConfig } from '@xqoder/shared';
import { runChatHeadless, runNonInteractivePrompt } from './chat-service.js';

describe('runNonInteractivePrompt', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    afterEach(() => {
        stdoutWrite.mockClear();
    });

    it('builds a non-interactive agent config with session title, shell, and auto approval', async () => {
        const run = vi.fn().mockResolvedValue('done');
        const saveSession = vi.fn();

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
            sessionStore: {
                findLatestSession: vi.fn(),
                getSession: vi.fn(),
                saveSession,
            },
            agentFactory: (config) => {
                expect(config.sessionTitle).toBe('Non-interactive: Explain the use of context in Go');
                expect(config.autoApproveTools).toBe(true);
                expect(config.shell).toEqual({
                    path: '/bin/zsh',
                    args: ['-l'],
                });

                return {
                    run,
                    getSession: () => new AgentSession({
                        title: config.sessionTitle,
                        systemPrompt: config.systemPrompt,
                    }),
                };
            },
        });

        expect(run).toHaveBeenCalledWith('Explain the use of context in Go', expect.any(Object));
        expect(saveSession).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-4.1',
            projectRoot: '/tmp/xqoder-non-interactive',
            cwd: '/tmp/xqoder-non-interactive',
        }));
    });
});

describe('runChatHeadless', () => {
    it('does not force-enable tool approval callback in headless mode', async () => {
        const run = vi.fn().mockResolvedValue('ok');
        const session = new AgentSession('system prompt');

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
            sessionStore: {
                findLatestSession: vi.fn().mockReturnValue(null),
                getSession: vi.fn().mockReturnValue(null),
                saveSession: vi.fn().mockReturnValue({
                    id: 'session_headless',
                }),
            },
            agentFactory: () => ({
                run,
                getSession: () => session,
            }),
        });

        const callbacks = run.mock.calls[0]?.[1] as { onToolApproval?: unknown };
        expect(callbacks.onToolApproval).toBeUndefined();
    });
});
