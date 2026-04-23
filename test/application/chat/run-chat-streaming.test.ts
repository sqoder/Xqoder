import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import {
    runChat,
    runChatHeadless,
    runChatMessageStream,
    runNonInteractivePrompt,
} from '../../../src/application/chat/run-chat.js';
import type { AgentCallbacks } from '../../../src/core/agent/agent.js';
import { XQoderAgent } from '../../../src/core/agent/agent.js';
import { AgentSession } from '../../../src/core/agent/session/session.js';
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

describe('chat runtime stream and routing helpers', () => {
    it('emits terminal stopReason metadata when the stream ends with a permission failure', async () => {
        const cwd = createTempDir();
        const events: ConversationEventEnvelope[] = [];

        await expect(runChatMessageStream({
            prompt: 'write outside the workspace',
            cwd,
            startNewSession: true,
            onEvent: (event) => {
                events.push(event);
            },
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'permission-denied-summary' }),
            },
            agentFactory: () => createFakeAgent({
                onRun: (_prompt, callbacks) => {
                    callbacks?.onStop?.('permission_denied');
                    throw new Error('Tool "write_file" was denied by permission settings (permission: deny)');
                },
            }),
        })).rejects.toThrow('Tool "write_file" was denied by permission settings');

        expect(events.find((event) => event.type === 'error')).toMatchObject({
            type: 'error',
            payload: {
                stopReason: 'permission_denied',
            },
        });
        expect(events.at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'error',
                stopReason: 'permission_denied',
            },
        });
    });

    it('emits usage app events through the real provider -> engine -> stream chain', async () => {
        const cwd = createTempDir();
        const events: ConversationEventEnvelope[] = [];

        const result = await runChatMessageStream({
            prompt: 'hello usage stream',
            cwd,
            startNewSession: true,
            onEvent: (event) => {
                events.push(event);
            },
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'usage-stream-summary' }),
            },
            agentFactory: (config) => createAgentWithStreamingUsage(config),
        });

        expect(result).toEqual({
            response: 'USAGE_CHAIN',
            sessionId: 'usage-stream-summary',
        });
        expect(events.find((event) => event.type === 'usage')).toMatchObject({
            type: 'usage',
            payload: {
                model: 'gpt-4.1',
                promptTokens: 17,
                completionTokens: 4,
                totalTokens: 21,
            },
        });
    });

    it('maps verification runtime events into verification.completed app events', async () => {
        const cwd = createTempDir();
        const events: ConversationEventEnvelope[] = [];

        const result = await runChatMessageStream({
            prompt: 'verify the write',
            cwd,
            startNewSession: true,
            onEvent: (event) => {
                events.push(event);
            },
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'verification-stream-summary' }),
            },
            agentFactory: () => createFakeAgent({
                onRun: (_prompt, callbacks) => {
                    callbacks?.onEvent?.({
                        id: 'verification-event-1',
                        streamId: 'stream-verification',
                        timestamp: new Date(0).toISOString(),
                        type: 'verification',
                        ok: false,
                        blocked: true,
                        summary: 'Verification failed',
                    } as any);
                    callbacks?.onToken?.('VERIFY');
                },
                response: 'VERIFY',
            }),
        });

        expect(result).toEqual({
            response: 'VERIFY',
            sessionId: 'verification-stream-summary',
        });
        expect(events.find((event) => event.type === 'verification.completed')).toMatchObject({
            type: 'verification.completed',
            payload: {
                ok: false,
                blocked: true,
                summary: 'Verification failed',
            },
        });
    });

    it('streams standard event envelopes for non-interactive stream-json output', async () => {
        const cwd = createTempDir();
        const stdout = captureStream(process.stdout, 'write');

        await runNonInteractivePrompt({
            prompt: 'stream this',
            cwd,
            outputFormat: 'stream-json',
            quiet: true,
        }, {
            configManager: { load: () => createLoadedConfig('test-key') },
            sessionStore: {
                findLatestSession: () => null,
                getSession: () => null,
                saveSession: () => ({ id: 'stream-json-summary' }),
            },
            agentFactory: () => createFakeAgent({
                onRun: (_prompt, callbacks) => {
                    callbacks?.onToken?.('STREAM_JSON');
                },
                response: 'STREAM_JSON',
            }),
        });

        const records = stdout.value
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as Record<string, unknown>);

        expect(records[0]).toMatchObject({
            type: 'event',
            event: {
                type: 'session.started',
            },
        });
        expect(records.some((record) => {
            const event = record.event as Record<string, unknown> | undefined;
            const payload = event?.['payload'] as Record<string, unknown> | undefined;
            return record.type === 'event' && event?.type === 'message.delta' && payload?.text === 'STREAM_JSON';
        })).toBe(true);
        expect(records.at(-1)).toEqual({
            type: 'done',
            response: 'STREAM_JSON',
            sessionId: 'stream-json-summary',
        });
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

    it('freezes the main chat routing baseline for casual, project explanation, and engineering prompts', async () => {
        const cwd = createProjectDir();
        const stdout = captureStream(process.stdout, 'write');
        const observed = new Map<string, {
            prompt?: string;
            systemPrompt?: string;
            runtimeProfile?: string;
        }>();
        const prompts = [
            '你好 你是谁',
            '请解释这个项目',
            '修复 src/utils.ts 的 TypeError',
        ] as const;

        for (const prompt of prompts) {
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
                    saveSession: () => ({ id: `baseline-${prompt}` }),
                },
                agentFactory: (config) => {
                    observed.set(prompt, {
                        ...observed.get(prompt),
                        systemPrompt: String((config as Record<string, unknown>).systemPrompt ?? ''),
                        runtimeProfile: (config as Record<string, unknown>).runtimeProfile as string | undefined,
                    });
                    return createFakeAgent({
                        onRun: (receivedPrompt) => {
                            observed.set(prompt, {
                                ...observed.get(prompt),
                                prompt: receivedPrompt,
                            });
                        },
                        response: `ACK:${prompt}`,
                    });
                },
            });
        }

        expect(observed.get('你好 你是谁')).toMatchObject({
            prompt: '你好 你是谁',
            runtimeProfile: 'mvp',
        });
        expect(observed.get('你好 你是谁')?.systemPrompt).toContain('answer directly');
        expect(observed.get('你好 你是谁')?.systemPrompt).not.toContain('USER_PROMPT');

        expect(observed.get('请解释这个项目')?.prompt).toContain('[AutoProjectContext]');
        expect(observed.get('请解释这个项目')?.prompt).toContain('demo-project');
        expect(observed.get('请解释这个项目')?.runtimeProfile).toBe('mvp');

        expect(observed.get('修复 src/utils.ts 的 TypeError')).toMatchObject({
            prompt: '修复 src/utils.ts 的 TypeError',
            runtimeProfile: 'hybrid',
        });
        expect(observed.get('修复 src/utils.ts 的 TypeError')?.systemPrompt).toContain('USER_PROMPT');
        expect(stdout.value).toContain('ACK:你好 你是谁');
        expect(stdout.value).toContain('ACK:请解释这个项目');
        expect(stdout.value).toContain('ACK:修复 src/utils.ts 的 TypeError');
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
        permissions?: {
            defaultMode?: 'allow' | 'ask' | 'deny';
            tools?: Record<string, 'allow' | 'ask' | 'deny'>;
            approvalPolicy?: 'strict' | 'balanced' | 'workspace_auto';
            allowedTools?: string[];
            disallowedTools?: string[];
        };
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
        ...(options.permissions
            ? {
                permissions: options.permissions,
            }
            : {}),
    };
}

function createFakeAgent(options: {
    response?: string;
    session?: Record<string, unknown>;
    onRun?: (
        prompt: string,
        callbacks?: AgentCallbacks,
        attachments?: Array<Record<string, unknown>>,
    ) => void | Promise<void>;
}) {
    return {
        async run(
            prompt: string,
            callbacks?: AgentCallbacks,
            attachments?: Array<Record<string, unknown>>,
        ) {
            if (options.onRun) {
                await options.onRun(prompt, callbacks, attachments);
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

function createAgentWithStreamingUsage(config: Record<string, unknown>): XQoderAgent {
    return new XQoderAgent({
        ...(config as any),
        providerFactory: async () => ({
            name: 'fake-provider',
            model: 'fake-model',
            async complete() {
                throw new Error('complete() should not be used');
            },
            async stream(_request: unknown, callbacks?: AgentCallbacks) {
                callbacks?.onToken?.('USAGE_');
                callbacks?.onToken?.('CHAIN');
                return {
                    finishReason: 'stop',
                    message: {
                        role: 'assistant',
                        content: 'USAGE_CHAIN',
                    },
                    usage: {
                        promptTokens: 17,
                        completionTokens: 4,
                        totalTokens: 21,
                    },
                };
            },
        }),
    });
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

function expectStandardEnvelopeShape(
    event: ConversationEventEnvelope | undefined,
    type: ConversationEventEnvelope['type'],
): void {
    expect(event).toMatchObject({
        schemaVersion: 1,
        type,
        eventId: expect.any(String),
        sessionId: expect.any(String),
        turnId: expect.any(String),
        timestamp: expect.any(String),
        payload: expect.any(Object),
    });
}
