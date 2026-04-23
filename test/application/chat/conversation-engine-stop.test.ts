import { describe, expect, it } from 'bun:test';
import { logger as defaultLogger } from '@xqoder/shared';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import {
    type ConversationEngine,
    ConversationEngineStopError,
    runConversationEngine,
    runConversationTurn,
    streamConversationTurn,
} from '../../../src/application/chat/conversation-engine.js';
import type { ConversationTurnInput } from '../../../src/application/chat/turn-intake.js';
import type { ConversationEventEnvelope } from '@xqoder/protocol';

describe('conversation engine stop conditions', () => {
    it('returns the cancel marker without calling the provider when the abort signal is already set', async () => {
        const session = new AgentSession({ id: 'conversation-engine-aborted', systemPrompt: 'system' });
        const abortController = new AbortController();
        abortController.abort();
        const events: string[] = [];
        let providerCalled = false;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    providerCalled = true;
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalled = true;
                    throw new Error('stream() should not be called after abort');
                },
            },
            session,
            userMessage: 'stop now',
            attachments: [],
            streamId: 'stream-3',
            abortSignal: abortController.signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            maxIterations: 4,
            emit: ((type) => {
                events.push(type);
            }) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => {},
        });

        expect(result).toBe('[cancelled by user]');
        expect(providerCalled).toBe(false);
        expect(events).toEqual(['agent_end']);
    });

    it('records provider usage into the session and emits a usage event before completion', async () => {
        const session = new AgentSession({ id: 'conversation-engine-usage', systemPrompt: 'system' });
        const emittedUsage: Array<{
            model: string;
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            cost?: number;
        }> = [];

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'usage complete',
                        },
                        usage: {
                            promptTokens: 21,
                            completionTokens: 5,
                            totalTokens: 26,
                        },
                    };
                },
            },
            session,
            userMessage: 'track usage',
            attachments: [],
            streamId: 'stream-usage',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            maxIterations: 2,
            emit: ((type, data) => {
                if (type === 'usage') {
                    emittedUsage.push(data as any);
                }
            }) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => {},
        });

        expect(result).toBe('usage complete');
        expect(session.getUsage()).toMatchObject({
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
        });
        expect(emittedUsage).toHaveLength(1);
        expect(emittedUsage[0]).toMatchObject({
            model: 'gpt-4.1',
            promptTokens: 21,
            completionTokens: 5,
            totalTokens: 26,
        });
    });

    it('returns structured stop metadata for a completed turn', async () => {
        const session = new AgentSession({ id: 'conversation-engine-result', systemPrompt: 'system' });

        const result = await runConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'final answer',
                        },
                        usage: {
                            promptTokens: 7,
                            completionTokens: 2,
                            totalTokens: 9,
                        },
                    };
                },
            },
            session,
            userMessage: 'answer directly',
            attachments: [],
            streamId: 'stream-result',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            maxIterations: 2,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => {},
        });

        expect(result).toEqual({
            response: 'final answer',
            stopReason: 'completed',
            iterations: 1,
            toolCallCount: 0,
        });
    });

    it('throws a structured stop error when maxTurns is exceeded', async () => {
        const session = new AgentSession({ id: 'conversation-engine-max-turns', systemPrompt: 'system' });
        let providerCalls = 0;
        let executeCount = 0;

        await expect(runConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalls += 1;
                    return {
                        finishReason: 'tool_calls',
                        message: {
                            role: 'assistant',
                            content: '',
                            toolCalls: [{
                                id: `tool-call-max-turns-${providerCalls}`,
                                name: 'read_file',
                                arguments: '{"path":"src/index.ts"}',
                            }],
                        },
                        usage: {
                            promptTokens: 8,
                            completionTokens: 2,
                            totalTokens: 10,
                        },
                    };
                },
            },
            session,
            userMessage: 'keep looping',
            attachments: [],
            streamId: 'stream-max-turns',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            maxTurns: 1,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                executeCount += 1;
                session.addToolResult(toolCalls[0]!.id, 'src/index.ts contents');
            },
        })).rejects.toMatchObject({
            name: 'ConversationEngineStopError',
            stopReason: 'max_turns',
            agentEndReason: 'failed',
        } satisfies Partial<ConversationEngineStopError>);

        expect(providerCalls).toBe(1);
        expect(executeCount).toBe(1);
    });

    it('throws a structured stop error when maxToolCalls is exceeded', async () => {
        const session = new AgentSession({ id: 'conversation-engine-max-tool-calls', systemPrompt: 'system' });
        let executeCalled = false;

        await expect(runConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'tool_calls',
                        message: {
                            role: 'assistant',
                            content: '',
                            toolCalls: [{
                                id: 'tool-call-1',
                                name: 'write_file',
                                arguments: '{"path":"src/a.ts"}',
                            }, {
                                id: 'tool-call-2',
                                name: 'write_file',
                                arguments: '{"path":"src/b.ts"}',
                            }],
                        },
                        usage: {
                            promptTokens: 9,
                            completionTokens: 2,
                            totalTokens: 11,
                        },
                    };
                },
            },
            session,
            userMessage: 'fix both files',
            attachments: [],
            streamId: 'stream-max-tool-calls',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            maxIterations: 3,
            maxToolCalls: 1,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => {
                executeCalled = true;
            },
        })).rejects.toMatchObject({
            name: 'ConversationEngineStopError',
            stopReason: 'max_tool_calls',
            agentEndReason: 'failed',
        } satisfies Partial<ConversationEngineStopError>);

        expect(executeCalled).toBe(false);
    });

    it('throws a structured stop error when maxWallTimeMs is exceeded', async () => {
        const session = new AgentSession({ id: 'conversation-engine-max-wall-time', systemPrompt: 'system' });
        const nowValues = [0, 0, 15];
        let nowIndex = 0;

        await expect(runConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'tool_calls',
                        message: {
                            role: 'assistant',
                            content: '',
                            toolCalls: [{
                                id: 'tool-call-wall-time',
                                name: 'echo_tool',
                                arguments: '{"target":"src/utils.ts"}',
                            }],
                        },
                        usage: {
                            promptTokens: 10,
                            completionTokens: 2,
                            totalTokens: 12,
                        },
                    };
                },
            },
            session,
            userMessage: 'keep going',
            attachments: [],
            streamId: 'stream-max-wall-time',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            maxIterations: 3,
            maxWallTimeMs: 10,
            now: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)]!,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                session.addToolResult(toolCalls[0]!.id, 'done');
            },
        })).rejects.toMatchObject({
            name: 'ConversationEngineStopError',
            stopReason: 'max_wall_time',
            agentEndReason: 'failed',
        } satisfies Partial<ConversationEngineStopError>);
    });

    it('throws a structured stop error when the provider repeats the same tool call batch', async () => {
        const session = new AgentSession({ id: 'conversation-engine-duplicate-tool-call', systemPrompt: 'system' });
        let executeCount = 0;
        let providerCalls = 0;

        await expect(runConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalls += 1;
                    return {
                        finishReason: 'tool_calls',
                        message: {
                            role: 'assistant',
                            content: '',
                            toolCalls: [{
                                id: `tool-call-${providerCalls}`,
                                name: 'read_file',
                                arguments: '{"path":"src/index.ts"}',
                            }],
                        },
                        usage: {
                            promptTokens: 9,
                            completionTokens: 2,
                            totalTokens: 11,
                        },
                    };
                },
            },
            session,
            userMessage: 'inspect the same file again',
            attachments: [],
            streamId: 'stream-duplicate-tool-call',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            maxIterations: 4,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                executeCount += 1;
                session.addToolResult(toolCalls[0]!.id, 'src/index.ts contents');
            },
        })).rejects.toMatchObject({
            name: 'ConversationEngineStopError',
            stopReason: 'duplicate_tool_call',
            agentEndReason: 'failed',
        } satisfies Partial<ConversationEngineStopError>);

        expect(executeCount).toBe(1);
    });

    it('throws a structured stop error when the engine keeps hitting the same blocker without progress', async () => {
        const session = new AgentSession({ id: 'conversation-engine-no-progress', systemPrompt: 'system' });
        let providerCalls = 0;

        await expect(runConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalls += 1;
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'still trying',
                        },
                        usage: {
                            promptTokens: 7,
                            completionTokens: 2,
                            totalTokens: 9,
                        },
                    };
                },
            },
            session,
            userMessage: 'wait until verification clears',
            attachments: [],
            streamId: 'stream-no-progress',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 4,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => {},
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {},
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => 'verification still pending',
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        })).rejects.toMatchObject({
            name: 'ConversationEngineStopError',
            stopReason: 'no_progress',
            agentEndReason: 'failed',
        } satisfies Partial<ConversationEngineStopError>);

        expect(providerCalls).toBe(2);
    });

    it('throws permission_denied after the tool follow-up path records a denied tool result', async () => {
        const session = new AgentSession({ id: 'conversation-engine-permission-denied', systemPrompt: 'system' });

        await expect(runConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    return {
                        finishReason: 'tool_calls',
                        message: {
                            role: 'assistant',
                            content: '',
                            toolCalls: [{
                                id: 'tool-call-denied',
                                name: 'write_file',
                                arguments: '{"path":"../secret.txt"}',
                            }],
                        },
                        usage: {
                            promptTokens: 8,
                            completionTokens: 2,
                            totalTokens: 10,
                        },
                    };
                },
            },
            session,
            userMessage: 'write outside the workspace',
            attachments: [],
            streamId: 'stream-permission-denied',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            maxIterations: 2,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                const toolCall = toolCalls[0]!;
                const error = 'Tool "write_file" was denied by permission settings (permission: deny)';
                session.recordToolExecution({
                    id: toolCall.id,
                    name: toolCall.name,
                    args: { path: '../secret.txt' },
                    success: false,
                    output: '',
                    error,
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCall.id, `Error: ${error}`);
                return [{
                    toolCallId: toolCall.id,
                    success: false,
                    output: '',
                    error,
                    metadata: {
                        stopReason: 'permission_denied',
                    },
                }];
            },
        })).rejects.toMatchObject({
            name: 'ConversationEngineStopError',
            stopReason: 'permission_denied',
            agentEndReason: 'failed',
        } satisfies Partial<ConversationEngineStopError>);
    });

    it('throws verification_failed when the model repeats the same blocked completion after a write', async () => {
        const session = new AgentSession({ id: 'conversation-engine-verification-failed', systemPrompt: 'system' });
        let providerCalls = 0;

        await expect(runConversationTurn({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream() {
                    providerCalls += 1;
                    if (providerCalls === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'tool-call-verification-failed',
                                    name: 'write_file',
                                    arguments: '{"path":"src/index.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 8,
                                completionTokens: 2,
                                totalTokens: 10,
                            },
                        };
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '应该可以结束了。',
                        },
                        usage: {
                            promptTokens: 8,
                            completionTokens: 2,
                            totalTokens: 10,
                        },
                    };
                },
            },
            session,
            userMessage: 'patch and verify',
            attachments: [],
            streamId: 'stream-verification-failed',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 4,
            emit: (() => {}) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                const toolCall = toolCalls[0]!;
                session.recordToolExecution({
                    id: toolCall.id,
                    name: toolCall.name,
                    args: { path: 'src/index.ts' },
                    success: true,
                    output: 'patched src/index.ts',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCall.id, 'patched src/index.ts');
                return [{
                    toolCallId: toolCall.id,
                    success: true,
                    output: 'patched src/index.ts',
                }];
            },
        })).rejects.toMatchObject({
            name: 'ConversationEngineStopError',
            stopReason: 'verification_failed',
            agentEndReason: 'failed',
        } satisfies Partial<ConversationEngineStopError>);

        expect(providerCalls).toBe(3);
    });
});
