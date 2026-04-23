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

describe('conversation engine', () => {
    it('exposes the documented public runTurn protocol shape', () => {
        const engine = {
            runTurn(_input: ConversationTurnInput): AsyncIterable<ConversationEventEnvelope> {
                return (async function* () {})();
            },
        } satisfies ConversationEngine;

        expect(typeof engine.runTurn).toBe('function');
    });

    it('treats the streaming entrypoint as the canonical envelope source and keeps the drain helper compatible', async () => {
        const session = new AgentSession({ id: 'conversation-engine-stream-source', systemPrompt: 'system' });
        const streamedEvents = [];

        for await (const event of streamConversationTurn({
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
                            content: 'stream canonical',
                        },
                        usage: {
                            promptTokens: 9,
                            completionTokens: 3,
                            totalTokens: 12,
                        },
                    };
                },
            },
            session,
            userMessage: 'stream this turn',
            attachments: [],
            streamId: 'stream-canonical',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            emit: (() => undefined) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => [],
        })) {
            streamedEvents.push(event);
        }

        expect(streamedEvents.at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'done',
                stopReason: 'completed',
            },
        });
        expect(streamedEvents.find((event) => event.type === 'message.completed' && event.payload.message.role === 'assistant')).toMatchObject({
            payload: {
                message: {
                    content: 'stream canonical',
                },
            },
        });

        const drainedSession = new AgentSession({ id: 'conversation-engine-stream-drain', systemPrompt: 'system' });
        const drainedResult = await runConversationTurn({
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
                            content: 'drained helper',
                        },
                        usage: {
                            promptTokens: 8,
                            completionTokens: 2,
                            totalTokens: 10,
                        },
                    };
                },
            },
            session: drainedSession,
            userMessage: 'drain this turn',
            attachments: [],
            streamId: 'stream-drained',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'full',
            emit: (() => undefined) as any,
            getToolDefinitions: () => [],
            executeToolCalls: async () => [],
        });

        expect(drainedResult).toMatchObject({
            response: 'drained helper',
            stopReason: 'completed',
        });
        expect(drainedSession.getConversationEventEnvelopes().at(-1)).toMatchObject({
            type: 'status.changed',
            payload: {
                status: 'done',
                stopReason: 'completed',
            },
        });
    });

    it('continues the loop across tool calls until a final assistant response is returned', async () => {
        const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
        const toolExecutions: string[] = [];
        const events: string[] = [];
        const session = new AgentSession({ id: 'conversation-engine-tool-loop', systemPrompt: 'system' });

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push({
                        messages: request.messages.map((message) => ({
                            role: message.role,
                            content: String(message.content ?? ''),
                        })),
                    });
                    if (requests.length === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'tool-call-1',
                                    name: 'echo_tool',
                                    arguments: '{"target":"src/utils.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 10,
                                completionTokens: 3,
                                totalTokens: 13,
                            },
                        };
                    }
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'done',
                        },
                        usage: {
                            promptTokens: 15,
                            completionTokens: 4,
                            totalTokens: 19,
                        },
                    };
                },
            },
            session,
            userMessage: 'fix it',
            attachments: [],
            callbacks: {
                onIteration: () => {},
            },
            streamId: 'stream-1',
            abortSignal: new AbortController().signal,
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
            getToolDefinitions: () => [{
                name: 'echo_tool',
                description: 'Echo a path',
                parameters: [],
            }],
            executeToolCalls: async (toolCalls, _callbacks, streamId) => {
                toolExecutions.push(toolCalls[0]!.name);
                session.addToolResult(toolCalls[0]!.id, 'tool-result:src/utils.ts');
                events.push(`tool_response:${streamId}`);
            },
            syncMcpTools: async () => {},
        });

        expect(result).toBe('done');
        expect(toolExecutions).toEqual(['echo_tool']);
        expect(requests).toHaveLength(2);
        expect(requests[1]!.messages.some((message) => message.role === 'tool' && message.content.includes('tool-result:src/utils.ts'))).toBe(true);
        expect(events).toContain('tool_response:stream-1');
        expect(events).toContain('agent_end');
    });

    it('keeps looping when the runtime blocks completion and only finishes after the blocker clears', async () => {
        const session = new AgentSession({ id: 'conversation-engine-blocker', systemPrompt: 'system' });
        let blockerActive = true;
        let providerCalls = 0;

        const result = await runConversationEngine({
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
                            content: providerCalls === 1 ? 'draft' : 'verified',
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
            userMessage: 'answer carefully',
            attachments: [],
            streamId: 'stream-2',
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
                getCompletionBlocker: () => {
                    if (!blockerActive) {
                        return undefined;
                    }
                    blockerActive = false;
                    return 'verification still pending';
                },
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => `FINAL:${content}`,
            }),
        });

        expect(result).toBe('FINAL:verified');
        expect(providerCalls).toBe(2);
        expect(session.getMessages().some((message) => message.role === 'system' && message.content.includes('verification still pending'))).toBe(true);
    });

    it('runs the tool follow-up verification bridge before the next provider turn', async () => {
        const session = new AgentSession({ id: 'conversation-engine-follow-up', systemPrompt: 'system' });
        const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
        let verificationRuns = 0;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push({
                        messages: request.messages.map((message) => ({
                            role: message.role,
                            content: String(message.content ?? ''),
                        })),
                    });
                    if (requests.length === 1) {
                        return {
                            finishReason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                toolCalls: [{
                                    id: 'tool-call-bridge-1',
                                    name: 'write_file',
                                    arguments: '{"path":"src/index.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 10,
                                completionTokens: 2,
                                totalTokens: 12,
                            },
                        };
                    }
                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'verified result',
                        },
                        usage: {
                            promptTokens: 15,
                            completionTokens: 3,
                            totalTokens: 18,
                        },
                    };
                },
            },
            session,
            userMessage: 'fix and verify',
            attachments: [],
            streamId: 'stream-bridge',
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
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/index.ts' },
                    success: true,
                    output: 'updated file',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCalls[0]!.id, 'updated file');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {
                    verificationRuns += 1;
                    session.addMessage({
                        role: 'system',
                        content: 'Verification passed.',
                    });
                },
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('verified result');
        expect(verificationRuns).toBe(1);
        expect(requests[1]!.messages.some((message) => message.role === 'system' && message.content.includes('Verification passed.'))).toBe(true);
    });

    it('emits a verification event when the tool follow-up bridge appends verification signals', async () => {
        const session = new AgentSession({ id: 'conversation-engine-verification-event', systemPrompt: 'system' });
        const verificationEvents: Array<{ ok: boolean; blocked: boolean; summary: string }> = [];
        let providerCalls = 0;

        const result = await runConversationEngine({
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
                                    id: 'tool-call-verification-1',
                                    name: 'write_file',
                                    arguments: '{"path":"src/index.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 11,
                                completionTokens: 2,
                                totalTokens: 13,
                            },
                        };
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'verified',
                        },
                        usage: {
                            promptTokens: 12,
                            completionTokens: 3,
                            totalTokens: 15,
                        },
                    };
                },
            },
            session,
            userMessage: 'verify after write',
            attachments: [],
            streamId: 'stream-verification',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 4,
            emit: ((type, data) => {
                if (type === 'verification') {
                    verificationEvents.push(data as any);
                }
            }) as any,
            getToolDefinitions: () => [{
                name: 'write_file',
                description: 'Write a file',
                parameters: [],
            }],
            executeToolCalls: async (toolCalls) => {
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/index.ts' },
                    success: true,
                    output: 'wrote src/index.ts',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCalls[0]!.id, 'wrote src/index.ts');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {
                    session.addMessage({ role: 'system', content: 'Verification passed.' });
                },
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('verified');
        expect(verificationEvents).toEqual([{
            ok: true,
            blocked: false,
            summary: 'Verification passed.',
        }]);
        expect(session.getVerificationHistory()).toEqual([{
            id: expect.any(String),
            ok: true,
            blocked: false,
            summary: 'Verification passed.',
            messages: ['Verification passed.'],
            createdAt: expect.any(Date),
        }]);
    });

    it('does not run runtime verification after a read-only tool batch in engineering_edit mode', async () => {
        const session = new AgentSession({ id: 'conversation-engine-read-only-batch', systemPrompt: 'system' });
        let providerCalls = 0;
        let verificationRuns = 0;

        const result = await runConversationEngine({
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
                                    id: 'tool-call-read-only-batch',
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
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'read-only follow-up complete',
                        },
                        usage: {
                            promptTokens: 10,
                            completionTokens: 3,
                            totalTokens: 13,
                        },
                    };
                },
            },
            session,
            userMessage: 'inspect before fixing',
            attachments: [],
            streamId: 'stream-read-only-batch',
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
            taskMode: 'engineering_edit',
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/index.ts' },
                    success: true,
                    output: 'const value = 1;',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCalls[0]!.id, 'const value = 1;');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {
                    verificationRuns += 1;
                    session.addMessage({ role: 'system', content: 'Verification should not run here.' });
                },
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('read-only follow-up complete');
        expect(verificationRuns).toBe(0);
        expect(session.getVerificationHistory()).toEqual([]);
    });

    it('forces debug_fix turns to reproduce before the latest successful fix can complete', async () => {
        const session = new AgentSession({ id: 'conversation-engine-debug-fix', systemPrompt: 'system' });
        const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
        let providerCalls = 0;
        let verificationRuns = 0;

        const result = await runConversationEngine({
            provider: {
                name: 'fake-provider',
                model: 'fake-model',
                async complete() {
                    throw new Error('complete() should not be used');
                },
                async stream(request) {
                    requests.push({
                        messages: request.messages.map((message) => ({
                            role: message.role,
                            content: String(message.content ?? ''),
                        })),
                    });
                    providerCalls += 1;

                    switch (providerCalls) {
                        case 1:
                            return {
                                finishReason: 'tool_calls',
                                message: {
                                    role: 'assistant',
                                    content: '',
                                    toolCalls: [{
                                        id: 'debug-fix-write-1',
                                        name: 'write_file',
                                        arguments: '{"path":"src/utils.ts"}',
                                    }],
                                },
                                usage: {
                                    promptTokens: 10,
                                    completionTokens: 2,
                                    totalTokens: 12,
                                },
                            };
                        case 2:
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: '已修复，可以结束了。',
                                },
                                usage: {
                                    promptTokens: 11,
                                    completionTokens: 3,
                                    totalTokens: 14,
                                },
                            };
                        case 3:
                            return {
                                finishReason: 'tool_calls',
                                message: {
                                    role: 'assistant',
                                    content: '',
                                    toolCalls: [{
                                        id: 'debug-fix-repro',
                                        name: 'run_shell',
                                        arguments: '{"command":"bun test src/utils.test.ts"}',
                                    }],
                                },
                                usage: {
                                    promptTokens: 12,
                                    completionTokens: 2,
                                    totalTokens: 14,
                                },
                            };
                        case 4:
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: '现在应该可以结束了。',
                                },
                                usage: {
                                    promptTokens: 12,
                                    completionTokens: 3,
                                    totalTokens: 15,
                                },
                            };
                        case 5:
                            return {
                                finishReason: 'tool_calls',
                                message: {
                                    role: 'assistant',
                                    content: '',
                                    toolCalls: [{
                                        id: 'debug-fix-write-2',
                                        name: 'write_file',
                                        arguments: '{"path":"src/utils.ts"}',
                                    }],
                                },
                                usage: {
                                    promptTokens: 12,
                                    completionTokens: 2,
                                    totalTokens: 14,
                                },
                            };
                        default:
                            return {
                                finishReason: 'stop',
                                message: {
                                    role: 'assistant',
                                    content: 'verified fix',
                                },
                                usage: {
                                    promptTokens: 13,
                                    completionTokens: 3,
                                    totalTokens: 16,
                                },
                            };
                    }
                },
            },
            session,
            userMessage: '修复 TypeError 并验证',
            attachments: [],
            streamId: 'stream-debug-fix',
            abortSignal: new AbortController().signal,
            logger: defaultLogger.child('conversation-engine-test'),
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            runtimeProfile: 'hybrid',
            maxIterations: 8,
            emit: (() => {}) as any,
            taskMode: 'debug_fix',
            getToolDefinitions: () => [],
            executeToolCalls: async (toolCalls) => {
                const toolCall = toolCalls[0]!;
                if (toolCall.name === 'write_file') {
                    session.recordToolExecution({
                        id: toolCall.id,
                        name: toolCall.name,
                        args: { path: 'src/utils.ts' },
                        success: true,
                        output: `patched via ${toolCall.id}`,
                        startedAt: new Date(),
                        completedAt: new Date(),
                    });
                    session.addToolResult(toolCall.id, `patched via ${toolCall.id}`);
                    return;
                }

                session.recordToolExecution({
                    id: toolCall.id,
                    name: toolCall.name,
                    args: { command: 'bun test src/utils.test.ts' },
                    success: false,
                    output: 'TypeError: Cannot read properties of undefined',
                    error: 'exit 1',
                    startedAt: new Date(),
                    completedAt: new Date(),
                });
                session.addToolResult(toolCall.id, 'TypeError: Cannot read properties of undefined');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {
                    verificationRuns += 1;
                    session.addMessage({
                        role: 'system',
                        content: 'Runtime verification passed.',
                    });
                },
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('verified fix');
        expect(providerCalls).toBe(6);
        expect(verificationRuns).toBe(2);
        expect(requests[2]!.messages.some((message) => message.content.includes('reproduce -> fix -> verify'))).toBe(true);
        expect(session.getMessages().filter((message) =>
            message.role === 'system' && String(message.content).includes('reproduce -> fix -> verify'),
        )).not.toHaveLength(0);
    });

    it('records tool-result renderer, transcript, and event-store projections into the session main chain', async () => {
        const session = new AgentSession({ id: 'conversation-engine-artifact-sink', systemPrompt: 'system' });
        let providerCalls = 0;

        const result = await runConversationEngine({
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
                                    id: 'tool-call-artifact-1',
                                    name: 'write_file',
                                    arguments: '{"path":"src/artifact.ts"}',
                                }],
                            },
                            usage: {
                                promptTokens: 10,
                                completionTokens: 2,
                                totalTokens: 12,
                            },
                        };
                    }

                    return {
                        finishReason: 'stop',
                        message: {
                            role: 'assistant',
                            content: 'artifact projections captured',
                        },
                        usage: {
                            promptTokens: 11,
                            completionTokens: 3,
                            totalTokens: 14,
                        },
                    };
                },
            },
            session,
            userMessage: 'capture tool projections',
            attachments: [],
            streamId: 'stream-artifact-sink',
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
                session.recordToolExecution({
                    id: toolCalls[0]!.id,
                    name: toolCalls[0]!.name,
                    args: { path: 'src/artifact.ts' },
                    success: true,
                    output: 'artifact write complete',
                    startedAt: new Date('2026-04-22T14:10:00.000Z'),
                    completedAt: new Date('2026-04-22T14:10:01.000Z'),
                    metadata: {
                        path: 'src/artifact.ts',
                        changeType: 'write',
                        bytes: 18,
                        rollbackPointId: 'rollback_artifact',
                        timestamp: '2026-04-22T14:10:01.000Z',
                    },
                });
                session.addToolResult(toolCalls[0]!.id, 'artifact write complete');
            },
            createRuntime: () => ({
                prepareMessages: () => session.getMessages(),
                async runPostToolVerification() {},
                getForcedStopMessage: () => undefined,
                getCompletionBlocker: () => undefined,
                getNoToolCompletionBlocker: () => undefined,
                finalizeAssistantResponse: (content) => content,
            }),
        });

        expect(result).toBe('artifact projections captured');
        expect(session.getToolResultRendererEvents()).toEqual([{
            type: 'tool.output',
            sessionId: 'conversation-engine-artifact-sink',
            toolCallId: 'tool-call-artifact-1',
            toolName: 'write_file',
            output: 'artifact write complete',
            timestamp: new Date('2026-04-22T14:10:01.000Z').getTime(),
        }, {
            type: 'tool.completed',
            sessionId: 'conversation-engine-artifact-sink',
            toolCallId: 'tool-call-artifact-1',
            toolName: 'write_file',
            success: true,
            timestamp: new Date('2026-04-22T14:10:01.000Z').getTime() + 1,
        }]);
        expect(session.getToolResultTranscriptEntries()).toEqual([{
            type: 'tool',
            content: 'artifact write complete',
            toolCallId: 'tool-call-artifact-1',
            toolName: 'write_file',
            success: true,
        }]);
        expect(session.getToolResultEventStoreRecords()).toEqual([{
            type: 'tool_result',
            sessionId: 'conversation-engine-artifact-sink',
            toolCallId: 'tool-call-artifact-1',
            toolName: 'write_file',
            success: true,
            content: 'artifact write complete',
            timestamp: new Date('2026-04-22T14:10:01.000Z').getTime(),
        }]);
    });

});
