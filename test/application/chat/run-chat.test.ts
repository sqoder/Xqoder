import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
    runChat,
    runChatHeadless,
    runNonInteractivePrompt,
} from '../../../src/application/chat/run-chat.js';
import { XQoderAgent } from '../../../src/core/agent/agent.js';
import {
    createMvpTypeErrorDemoProvider,
    createMvpTypeErrorDemoWorkspace,
    MVP_TYPEERROR_DEMO_PROMPT,
} from '../../../src/core/agent/mvp/demo.js';
import { FileRollbackStore } from '../../../src/core/agent/tools/rollback-store.js';

const tempDirs: string[] = [];
const descriptorRestorers: Array<() => void> = [];

afterEach(() => {
    while (descriptorRestorers.length > 0) {
        descriptorRestorers.pop()?.();
    }

    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('chat runtime helpers', () => {
    it('throws when headless chat cannot resolve a session store', async () => {
        const cwd = createTempDir();

        await expect(runChatHeadless('hello', { dir: cwd })).rejects.toThrow('Session storage unavailable');
    });

    it('reuses an explicit session, augments project prompts, forwards attachments, and saves the response', async () => {
        const cwd = createProjectDir();
        const explicitSession = { id: 'session-explicit' };
        const savedSession = { id: 'session-saved' };
        const savedCalls: Array<Record<string, unknown>> = [];
        const received: {
            config?: Record<string, unknown>;
            prompt?: string;
            attachments?: Array<Record<string, unknown>>;
        } = {};

        const sessionStore = {
            findLatestSession: () => null,
            getSession: (sessionId: string) => (sessionId === explicitSession.id ? explicitSession : null),
            saveSession: (input: Record<string, unknown>) => {
                savedCalls.push(input);
                return { id: 'summary-1' };
            },
        };

        const result = await runChatHeadless('请解释这个项目', {
            dir: cwd,
            session: explicitSession.id,
            attachments: [{ type: 'file', filePath: path.join(cwd, 'README.md') }],
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore,
            agentFactory: (config) => {
                received.config = config as unknown as Record<string, unknown>;
                return createFakeAgent({
                    onRun: (prompt, callbacks, attachments) => {
                        received.prompt = prompt;
                        received.attachments = attachments as Array<Record<string, unknown>>;
                        callbacks?.onToken?.('Demo response');
                    },
                    session: savedSession,
                    response: 'Demo response',
                });
            },
        });

        expect(result).toEqual({ response: 'Demo response', sessionId: 'summary-1' });
        expect(received.config?.session).toBe(explicitSession);
        expect(String(received.prompt)).toContain('[AutoProjectContext]');
        expect(String(received.prompt)).toContain('demo-project');
        expect(received.attachments).toEqual([{ type: 'file', filePath: path.join(cwd, 'README.md') }]);
        expect(savedCalls).toHaveLength(1);
        expect(savedCalls[0]?.projectRoot).toBe(cwd);
        expect(savedCalls[0]?.cwd).toBe(cwd);
        expect(savedCalls[0]?.session).toBe(savedSession);
    });

    it('surfaces the current API key guidance when no key is configured and no injected agent factory is provided', async () => {
        const cwd = createTempDir();

        await expect(runChatHeadless('hello', { dir: cwd }, {
            configManager: { load: () => createLoadedConfig('') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'unused' }),
            },
        })).rejects.toThrow('auth login');
    });

    it('allows local provider headless chat to proceed without an api key', async () => {
        const cwd = createTempDir();

        const result = await runChatHeadless('hello', { dir: cwd }, {
            configManager: { load: () => createLoadedConfig('', { provider: 'local', model: 'qwen3:8b' }) },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'local-summary' }),
            },
            agentFactory: () => createFakeAgent({
                response: 'LOCAL_RESPONSE',
            }),
        });

        expect(result).toEqual({
            response: 'LOCAL_RESPONSE',
            sessionId: 'local-summary',
        });
    });

    it('renders JSON output for interactive chat through the injected runtime and persists the session', async () => {
        const cwd = createTempDir();
        const stdout = captureStream(process.stdout, 'write');
        const stderr = captureStream(process.stderr, 'write');
        const savedCalls: Array<Record<string, unknown>> = [];

        await runChat('hello from interactive', {
            dir: cwd,
            format: 'json',
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: (input: Record<string, unknown>) => {
                    savedCalls.push(input);
                    return { id: 'interactive-summary' };
                },
            },
            agentFactory: () => createFakeAgent({
                onRun: (_prompt, callbacks) => {
                    callbacks?.onToken?.('Hello');
                    callbacks?.onToken?.(' world');
                },
                response: 'unused when callbacks accumulate',
            }),
        }, () => ({
            onToken() {},
        }));

        expect(savedCalls).toHaveLength(1);
        expect(stdout.value).toContain('"response": "Hello world"');
        expect(stdout.value.trim().endsWith('}')).toBe(true);
        expect(stderr.value).toContain('\r');
    });

    it('runs non-interactive prompts with auto-approved tools, a generated session title, and formatted text output', async () => {
        const cwd = createTempDir();
        const stdout = captureStream(process.stdout, 'write');
        const received: {
            config?: Record<string, unknown>;
            prompt?: string;
        } = {};

        await runNonInteractivePrompt({
            prompt: 'Summarize the repo status',
            cwd,
            outputFormat: 'text',
            quiet: true,
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'non-interactive-summary' }),
            },
            agentFactory: (config) => {
                received.config = config as unknown as Record<string, unknown>;
                return createFakeAgent({
                    onRun: (prompt, callbacks) => {
                        received.prompt = prompt;
                        callbacks?.onToken?.('TEXT_RESPONSE');
                    },
                    response: 'TEXT_RESPONSE',
                });
            },
        });

        expect(received.config?.autoApproveTools).toBe(true);
        expect(String(received.config?.sessionTitle)).toContain('Non-interactive: Summarize the repo status');
        expect(received.prompt).toBe('Summarize the repo status');
        expect(stdout.value).toContain('TEXT_RESPONSE');
    });

    it('does not force the engineering report template for plain greetings', async () => {
        const cwd = createTempDir();
        const stdout = captureStream(process.stdout, 'write');
        const received: {
            systemPrompt?: string;
        } = {};

        await runNonInteractivePrompt({
            prompt: '你好 你是谁',
            cwd,
            outputFormat: 'text',
            quiet: true,
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'greeting-summary' }),
            },
            agentFactory: (config) => {
                received.systemPrompt = String((config as Record<string, unknown>).systemPrompt ?? '');
                return createFakeAgent({
                    response: '我是 XQoder，你的终端 AI 编程助手。',
                });
            },
        });

        expect(received.systemPrompt).not.toContain('USER_PROMPT');
        expect(received.systemPrompt).not.toContain('EXECUTION_LOG');
        expect(received.systemPrompt).toContain('answer directly');
        expect(received.systemPrompt).toContain('Do not claim that you read files');
        expect(stdout.value).toContain('我是 XQoder');
    });

    it('injects the active provider and model for model identity questions', async () => {
        const cwd = createTempDir();
        const stdout = captureStream(process.stdout, 'write');
        const received: {
            systemPrompt?: string;
        } = {};

        await runNonInteractivePrompt({
            prompt: '你是什么模型',
            cwd,
            outputFormat: 'text',
            quiet: true,
        }, {
            configManager: { load: () => createLoadedConfig('dashscope-key', { provider: 'dashscope', model: 'qwen-plus' }) },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'model-summary' }),
            },
            agentFactory: (config) => {
                received.systemPrompt = String((config as Record<string, unknown>).systemPrompt ?? '');
                return createFakeAgent({
                    response: '我是 XQoder，当前由 dashscope/qwen-plus 驱动。',
                });
            },
        });

        expect(received.systemPrompt).not.toContain('USER_PROMPT');
        expect(received.systemPrompt).toContain('configured LLM provider/model: dashscope/qwen-plus');
        expect(received.systemPrompt).toContain('do not say you are not a language model');
        expect(stdout.value).toContain('dashscope/qwen-plus');
    });

    it('selects runtime profile by interaction route (casual -> mvp, engineering -> hybrid)', async () => {
        const cwd = createTempDir();
        const observedProfiles = new Map<string, string | undefined>();

        for (const prompt of ['你好', '修复 src/utils.ts 的 TypeError']) {
            await runNonInteractivePrompt({
                prompt,
                cwd,
                outputFormat: 'text',
                quiet: true,
            }, {
                configManager: { load: () => createLoadedConfig('test-key') },
                sessionStore: {
                    findLatestSession: () => null,
                    getSession: () => null,
                    saveSession: () => ({ id: `route-${prompt}` }),
                },
                agentFactory: (config) => {
                    observedProfiles.set(prompt, (config as Record<string, unknown>).runtimeProfile as string | undefined);
                    return createFakeAgent({
                        response: `ACK:${prompt}`,
                    });
                },
            });
        }

        expect(observedProfiles.get('你好')).toBe('mvp');
        expect(observedProfiles.get('修复 src/utils.ts 的 TypeError')).toBe('hybrid');
    });


    it('adds local fallback guidance when a remote provider network call fails', async () => {
        const cwd = createTempDir();

        await expect(runNonInteractivePrompt({
            prompt: 'hello',
            cwd,
            outputFormat: 'text',
            quiet: true,
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'unused' }),
            },
            agentFactory: () => ({
                async run() {
                    throw new Error('dashscope stream connection failed: timed out');
                },
                getSession() {
                    return { id: 'failed-session' };
                },
                async dispose() {},
            }),
            localFallbackAdvisor: async () => 'Suggested fallback: local/qwen3:8b',
        })).rejects.toThrow('Suggested fallback: local/qwen3:8b');
    });

    it('runs the TypeError demo through the non-interactive chat path into the engineering runtime profile', async () => {
        const cwd = createMvpTypeErrorDemoWorkspace();
        tempDirs.push(cwd);
        const stdout = captureStream(process.stdout, 'write');
        const savedCalls: Array<Record<string, unknown>> = [];
        const received: { runtimeProfile?: string } = {};

        await runNonInteractivePrompt({
            prompt: MVP_TYPEERROR_DEMO_PROMPT,
            cwd,
            outputFormat: 'text',
            quiet: true,
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: (input: Record<string, unknown>) => {
                    savedCalls.push(input);
                    return { id: 'demo-chat-summary' };
                },
            },
            agentFactory: (config) => {
                const provider = createMvpTypeErrorDemoProvider();
                received.runtimeProfile = (config as Record<string, unknown>).runtimeProfile as string | undefined;
                return new XQoderAgent({
                    ...(config as unknown as ConstructorParameters<typeof XQoderAgent>[0]),
                    rollbackStore: new FileRollbackStore(path.join(cwd, '.rollbacks')),
                    providerFactory: async () => provider,
                    permissions: {
                        defaultMode: 'allow',
                        tools: {},
                    },
                });
            },
        });

        expect(received.runtimeProfile).toBe('hybrid');
        expect(savedCalls).toHaveLength(1);
        expect(stdout.value).toContain('修复完成：src/utils.ts 已补上 guard clause');
        expect(fs.readFileSync(path.join(cwd, 'src/utils.ts'), 'utf-8')).toContain("return 'UNKNOWN';");
    });
});

function createLoadedConfig(
    apiKey: string,
    options: {
        provider?: 'openai' | 'local' | 'dashscope';
        model?: string;
    } = {},
) {
    const provider = options.provider ?? 'openai';
    const model = options.model ?? 'gpt-4.1';

    return {
        llm: {
            provider,
            model,
            apiKey,
        },
        providers: {
            [provider]: {
                apiKey,
                defaultModel: model,
                ...(provider === 'local'
                    ? { baseUrl: 'http://localhost:11434/v1' }
                    : {}),
            },
        },
        defaultAgent: 'general',
        agents: {
            general: {
                mode: 'primary',
                provider,
                model,
            },
        },
        sandbox: {
            mode: 'project',
            allowedPaths: [],
        },
    };
}

function createFakeAgent(options: {
    response?: string;
    session?: Record<string, unknown>;
    onRun?: (
        prompt: string,
        callbacks?: { onToken?: (token: string) => void },
        attachments?: Array<Record<string, unknown>>,
    ) => void;
}) {
    return {
        async run(
            prompt: string,
            callbacks?: { onToken?: (token: string) => void },
            attachments?: Array<Record<string, unknown>>,
        ) {
            if (options.onRun) {
                options.onRun(prompt, callbacks, attachments);
            } else if (options.response) {
                callbacks?.onToken?.(options.response);
            }

            return options.response ?? '';
        },
        getSession() {
            return options.session ?? { id: 'agent-session' };
        },
        async dispose() {},
    };
}

function createProjectDir(): string {
    const cwd = createTempDir();
    fs.writeFileSync(path.join(cwd, 'README.md'), '# Demo Project\n\nA sample app.\n', 'utf-8');
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
        name: 'demo-project',
        description: 'Sample terminal app',
        scripts: {
            build: 'bun run build',
            test: 'bun test',
        },
    }, null, 2));
    return cwd;
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-run-chat-'));
    tempDirs.push(dir);
    return dir;
}

function captureStream<
    T extends { [K in P]: (...args: any[]) => unknown },
    P extends keyof T,
>(target: T, property: P): { value: string } {
    const previous = Object.getOwnPropertyDescriptor(target, property);
    const captured = { value: '' };

    Object.defineProperty(target, property, {
        configurable: true,
        value: ((chunk: unknown) => {
            captured.value += String(chunk ?? '');
            return true;
        }) as T[P],
    });

    descriptorRestorers.push(() => {
        if (previous) {
            Object.defineProperty(target, property, previous);
            return;
        }
        delete (target as Record<string, unknown>)[property as string];
    });

    return captured;
}
