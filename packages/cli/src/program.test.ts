import { afterAll, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import { createChatCommand } from './commands/chat.js';
import { createTuiCommand } from './commands/tui.js';
import { createProgram, runProgram } from './program.js';

describe('program command parsing', () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    afterAll(() => {
        stdoutWrite.mockRestore();
    });

    it('routes chat options before the message to the chat command', async () => {
        const run = vi.fn().mockResolvedValue('ok');
        const session = new AgentSession('system prompt');
        const chat = createChatCommand({
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
        const program = createProgram([
            'chat',
            '--dir',
            '/tmp/xqoder-tui-smoke',
            '--new-session',
            '记住标记 A-123',
        ], {
            chatCommand: chat,
        });

        await program.parseAsync([
            'node',
            'xqoder',
            'chat',
            '--dir',
            '/tmp/xqoder-tui-smoke',
            '--new-session',
            '记住标记 A-123',
        ]);

        expect(run).toHaveBeenCalledWith('记住标记 A-123', expect.any(Object), expect.any(Array));
    });

    it('accepts a leading -- separator before the top-level command', async () => {
        const run = vi.fn().mockResolvedValue('ok');
        const session = new AgentSession('system prompt');
        const chat = createChatCommand({
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
                return { run, getSession: () => session };
            },
        });
        await runProgram([
            'node',
            'xqoder',
            '--',
            'chat',
            '--dir',
            '/tmp/xqoder-tui-smoke',
            '--new-session',
            '记住标记 A-123',
        ], {
            chatCommand: chat,
        });

        expect(run).toHaveBeenCalledWith('记住标记 A-123', expect.any(Object), expect.any(Array));
    });

    it('routes tui --dir to the tui command', async () => {
        const runTui = vi.fn().mockResolvedValue(undefined);
        const tui = createTuiCommand({
            runTuiCommand: runTui,
        });
        const program = createProgram([
            'tui',
            '--dir',
            '/tmp/xqoder-tui-smoke',
            '--agent',
            'general',
        ], {
            tuiCommand: tui,
        });

        await program.parseAsync([
            'node',
            'xqoder',
            'tui',
            '--dir',
            '/tmp/xqoder-tui-smoke',
            '--agent',
            'general',
        ]);

        expect(runTui).toHaveBeenCalledWith(expect.objectContaining({
            dir: '/tmp/xqoder-tui-smoke',
            agent: 'general',
        }));
    });

    it('routes --prompt through the non-interactive runner', async () => {
        const promptRunner = vi.fn().mockResolvedValue(undefined);

        const program = createProgram([
            '--prompt',
            'Explain the use of context in Go',
            '--cwd',
            '/tmp/xqoder-main-path',
            '--output-format',
            'json',
            '--quiet',
            '--agent',
            'coder',
        ], {
            promptRunner,
        });

        await program.parseAsync([
            'node',
            'xqoder',
            '--prompt',
            'Explain the use of context in Go',
            '--cwd',
            '/tmp/xqoder-main-path',
            '--output-format',
            'json',
            '--quiet',
            '--agent',
            'coder',
        ]);

        expect(promptRunner).toHaveBeenCalledWith({
            prompt: 'Explain the use of context in Go',
            cwd: '/tmp/xqoder-main-path',
            outputFormat: 'json',
            quiet: true,
            model: undefined,
            agent: 'coder',
        });
    });

    it('rejects invalid output formats before running the prompt', async () => {
        const promptRunner = vi.fn().mockResolvedValue(undefined);
        const program = createProgram([
            '--prompt',
            'hello',
            '--output-format',
            'yaml',
        ], {
            promptRunner,
        });

        await expect(program.parseAsync([
            'node',
            'xqoder',
            '--prompt',
            'hello',
            '--output-format',
            'yaml',
        ])).rejects.toThrow(/invalid format option: yaml/);
        expect(promptRunner).not.toHaveBeenCalled();
    });

    it('keeps legacy subcommands callable but hides them from root help', () => {
        const program = createProgram([]);
        const help = program.helpInformation();

        expect(help).toMatch(/--prompt/);
        expect(help).not.toMatch(/\bfix\b/);
        expect(help).not.toMatch(/\bdeploy\b/);
        expect(help).not.toMatch(/\bchat\b/);
    });
});
