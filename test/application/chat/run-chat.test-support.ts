import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'bun:test';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type { AgentCallbacks } from '../../../src/core/agent/agent.js';
import { XQoderAgent } from '../../../src/core/agent/agent.js';

const tempDirs: string[] = [];
const descriptorRestorers: Array<() => void> = [];

export function cleanupRunChatTestState(): void {
    while (descriptorRestorers.length > 0) {
        descriptorRestorers.pop()?.();
    }

    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
}

export function createLoadedConfig(
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

export function createFakeAgent(options: {
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

export function createAgentWithStreamingUsage(config: Record<string, unknown>): XQoderAgent {
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

export function createProjectDir(): string {
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

export function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-run-chat-'));
    tempDirs.push(dir);
    return dir;
}

export function captureStream<
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

export function expectStandardEnvelopeShape(
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
