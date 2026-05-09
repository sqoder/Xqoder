import { describe, expect, it } from 'bun:test';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import {
    runProviderTurn,
    type ProviderTurnResult,
} from '../../../src/application/chat/provider-turn.js';

interface FakeProviderResponse {
    message: ProviderTurnResult['message'];
    usage: ProviderTurnResult['usage'];
    finishReason: ProviderTurnResult['finishReason'];
}

function createFakeProvider(options: {
    streamImpl?: (callbacks: {
        onToken?: (token: string) => void;
        onThinkingToken?: (token: string) => void;
        onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void;
        onError?: (error: Error) => void;
    }) => Promise<FakeProviderResponse>;
    completeImpl?: () => Promise<FakeProviderResponse>;
}) {
    return {
        name: 'fake-provider',
        model: 'fake-model',
        async complete() {
            if (!options.completeImpl) {
                throw new Error('complete() should not be used');
            }
            return await options.completeImpl();
        },
        ...(options.streamImpl
            ? {
                async stream(_request: unknown, callbacks: {
                    onToken?: (token: string) => void;
                    onThinkingToken?: (token: string) => void;
                    onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void;
                    onError?: (error: Error) => void;
                }) {
                    return await options.streamImpl!(callbacks);
                },
            }
            : {}),
    } as any;
}

describe('provider turn bridge', () => {
    it('collects a normalized provider turn while emitting usage and callback side effects', async () => {
        const session = new AgentSession({ id: 'provider-turn-1', systemPrompt: 'system' });
        const emitted: string[] = [];
        const tokens: string[] = [];
        const thoughts: string[] = [];
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        let completedMessage = '';

        const result = await runProviderTurn({
            provider: createFakeProvider({
                streamImpl: async (callbacks) => {
                    callbacks.onThinkingToken?.('plan');
                    callbacks.onToken?.('Hel');
                    callbacks.onToken?.('lo');
                    callbacks.onToolCall?.({
                        id: 'tool-1',
                        name: 'search_code',
                        arguments: '{"query":"hello"}',
                    });
                    return {
                        message: {
                            role: 'assistant',
                            content: 'Hello',
                        },
                        usage: {
                            promptTokens: 11,
                            completionTokens: 5,
                            totalTokens: 16,
                        },
                        finishReason: 'stop',
                    };
                },
            }),
            request: {
                messages: [{ role: 'user', content: 'Say hello' }],
                tools: [],
            },
            session,
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            streamId: 'stream-provider-turn',
            callbacks: {
                onToken(token) {
                    tokens.push(token);
                },
                onThinkingToken(token) {
                    thoughts.push(token);
                },
                onToolCall(toolCall) {
                    toolCalls.push(toolCall as any);
                },
                onComplete(message) {
                    completedMessage = String(message.content ?? '');
                },
            },
            emit(type) {
                emitted.push(type);
            },
        });

        expect(result).toMatchObject({
            finishReason: 'stop',
            message: {
                role: 'assistant',
                content: 'Hello',
            },
            usage: {
                promptTokens: 11,
                completionTokens: 5,
                totalTokens: 16,
            },
        });
        expect(tokens).toEqual(['Hel', 'lo']);
        expect(thoughts).toEqual(['plan']);
        expect(toolCalls).toEqual([{
            id: 'tool-1',
            name: 'search_code',
            arguments: '{"query":"hello"}',
        }]);
        expect(completedMessage).toBe('Hello');
        expect(emitted).toEqual(['thought', 'message', 'message', 'usage']);
        expect(session.getUsage()).toMatchObject({
            promptTokens: 11,
            completionTokens: 5,
            totalTokens: 16,
        });
    });

    it('can suppress assistant message side effects while still collecting the provider result', async () => {
        const session = new AgentSession({ id: 'provider-turn-suppressed', systemPrompt: 'system' });
        const emitted: string[] = [];
        const tokens: string[] = [];
        let completedMessage = '';

        const result = await runProviderTurn({
            provider: createFakeProvider({
                streamImpl: async (callbacks) => {
                    callbacks.onToken?.('fake read_file claim');
                    return {
                        message: {
                            role: 'assistant',
                            content: 'fake read_file claim',
                        },
                        usage: {
                            promptTokens: 12,
                            completionTokens: 4,
                            totalTokens: 16,
                        },
                        finishReason: 'stop',
                    };
                },
            }),
            request: {
                messages: [{ role: 'user', content: '/tmp/code.html 帮我分析' }],
                tools: [],
            },
            session,
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            streamId: 'stream-provider-turn-suppressed',
            suppressAssistantMessages: true,
            callbacks: {
                onToken(token) {
                    tokens.push(token);
                },
                onComplete(message) {
                    completedMessage = String(message.content ?? '');
                },
            },
            emit(type) {
                emitted.push(type);
            },
        });

        expect(result).toMatchObject({
            finishReason: 'stop',
            message: {
                role: 'assistant',
                content: 'fake read_file claim',
            },
        });
        expect(tokens).toEqual([]);
        expect(completedMessage).toBe('');
        expect(emitted).toEqual(['usage']);
        expect(session.getUsage()).toMatchObject({
            promptTokens: 12,
            completionTokens: 4,
            totalTokens: 16,
        });
    });

    it('raises a structured provider_error when the provider stream fails', async () => {
        const session = new AgentSession({ id: 'provider-turn-error', systemPrompt: 'system' });
        const emitted: Array<{ type: string; message?: string }> = [];

        await expect(runProviderTurn({
            provider: createFakeProvider({
                streamImpl: async (callbacks) => {
                    callbacks.onError?.(new Error('boom'));
                    throw new Error('boom');
                },
            }),
            request: {
                messages: [{ role: 'user', content: 'Fail please' }],
                tools: [],
            },
            session,
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4.1',
                apiKey: 'test-key',
            },
            agentName: 'coder',
            streamId: 'stream-provider-turn-error',
            callbacks: {
                onError(error) {
                    emitted.push({ type: 'callback.error', message: error.message });
                },
            },
            emit(type, data) {
                emitted.push({
                    type,
                    message: typeof (data as { message?: unknown }).message === 'string'
                        ? (data as { message: string }).message
                        : undefined,
                });
            },
        })).rejects.toMatchObject({
            name: 'ConversationEngineStopError',
            stopReason: 'provider_error',
            agentEndReason: 'error',
            message: expect.stringContaining('LLM call failed: boom'),
        });

        expect(emitted).toEqual([
            { type: 'callback.error', message: 'boom' },
            { type: 'error', message: expect.stringContaining('LLM call failed: boom') as unknown as string },
        ]);
    });
});
