import { describe, expect, it } from 'bun:test';
import { streamProviderEvents } from '../../../src/infra/llm/provider-event-adapter.js';
import type { ConversationProviderEvent } from '../../../src/infra/llm/provider-events.js';

interface FakeProviderResponse {
    message: {
        role: 'assistant';
        content: string;
        toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    };
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
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
    const { streamImpl, completeImpl } = options;

    return {
        name: 'fake-provider',
        model: 'fake-model',
        async complete() {
            if (!completeImpl) {
                throw new Error('complete() should not be used');
            }
            return completeImpl();
        },
        ...(streamImpl
            ? {
                async stream(_request: unknown, callbacks: {
                    onToken?: (token: string) => void;
                    onThinkingToken?: (token: string) => void;
                    onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void;
                    onError?: (error: Error) => void;
                }) {
                    return streamImpl(callbacks);
                },
            }
            : {}),
    } as {
        name: string;
        model: string;
        complete: () => Promise<FakeProviderResponse>;
        stream?: (_request: unknown, callbacks: {
            onToken?: (token: string) => void;
            onThinkingToken?: (token: string) => void;
            onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void;
            onError?: (error: Error) => void;
        }) => Promise<FakeProviderResponse>;
    };
}

function createStreamingProvider(streamImpl: (callbacks: {
    onToken?: (token: string) => void;
    onThinkingToken?: (token: string) => void;
    onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void;
    onError?: (error: Error) => void;
}) => Promise<FakeProviderResponse>) {
    return createFakeProvider({ streamImpl });
}

async function collectNormalizedEvents(events: AsyncIterable<ConversationProviderEvent>) {
    const collected: Array<Record<string, unknown>> = [];
    for await (const event of events) {
        switch (event.type) {
            case 'message':
            case 'reasoning':
                collected.push({ type: event.type, text: event.text });
                break;
            case 'tool':
                collected.push({ type: event.type, toolCall: event.toolCall });
                break;
            case 'usage':
                collected.push({ type: event.type, usage: event.usage });
                break;
            case 'stop':
                collected.push({
                    type: event.type,
                    finishReason: event.finishReason,
                    message: {
                        role: event.message.role,
                        content: event.message.content,
                        toolCalls: event.message.toolCalls,
                    },
                });
                break;
            case 'error':
                collected.push({ type: event.type, message: event.error.message });
                break;
        }
    }
    return collected;
}

describe('provider event adapter', () => {
    it('adapts text and thinking callbacks into a unified provider event stream', async () => {
        const stream = streamProviderEvents({
            provider: createStreamingProvider(async (callbacks) => {
                callbacks.onThinkingToken?.('plan');
                callbacks.onToken?.('Hel');
                callbacks.onToken?.('lo');
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
            }),
            request: {
                messages: [{ role: 'user', content: 'Say hello' }],
                tools: [],
            },
        });

        const eventsPromise = collectNormalizedEvents(stream.events);
        await stream.completed;

        expect(await eventsPromise).toEqual([
            { type: 'reasoning', text: 'plan' },
            { type: 'message', text: 'Hel' },
            { type: 'message', text: 'lo' },
            {
                type: 'usage',
                usage: {
                    promptTokens: 11,
                    completionTokens: 5,
                    totalTokens: 16,
                },
            },
            {
                type: 'stop',
                finishReason: 'stop',
                message: {
                    role: 'assistant',
                    content: 'Hello',
                    toolCalls: undefined,
                },
            },
        ]);
    });

    it('deduplicates tool_call events when the provider emits both callback and final response toolCalls', async () => {
        const toolCall = {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{"path":"src/index.ts"}',
        };
        const stream = streamProviderEvents({
            provider: createStreamingProvider(async (callbacks) => {
                callbacks.onToolCall?.(toolCall);
                return {
                    message: {
                        role: 'assistant',
                        content: '',
                        toolCalls: [toolCall],
                    },
                    usage: {
                        promptTokens: 20,
                        completionTokens: 4,
                        totalTokens: 24,
                    },
                    finishReason: 'tool_calls',
                };
            }),
            request: {
                messages: [{ role: 'user', content: 'Read the file' }],
                tools: [],
            },
        });

        const eventsPromise = collectNormalizedEvents(stream.events);
        await stream.completed;
        const events = await eventsPromise;

        expect(events.filter((event) => event.type === 'tool')).toEqual([
            { type: 'tool', toolCall },
        ]);
        expect(events.at(-1)).toEqual({
            type: 'stop',
            finishReason: 'tool_calls',
            message: {
                role: 'assistant',
                content: '',
                toolCalls: [toolCall],
            },
        });
    });

    it('falls back to final response toolCalls when the provider never emits onToolCall', async () => {
        const toolCall = {
            id: 'tool-2',
            name: 'search_code',
            arguments: '{"query":"runConversationEngine"}',
        };
        const stream = streamProviderEvents({
            provider: createStreamingProvider(async () => ({
                message: {
                    role: 'assistant',
                    content: '',
                    toolCalls: [toolCall],
                },
                usage: {
                    promptTokens: 18,
                    completionTokens: 6,
                    totalTokens: 24,
                },
                finishReason: 'tool_calls',
            })),
            request: {
                messages: [{ role: 'user', content: 'Search the codebase' }],
                tools: [],
            },
        });

        const eventsPromise = collectNormalizedEvents(stream.events);
        await stream.completed;

        expect(await eventsPromise).toEqual([
            { type: 'tool', toolCall },
            {
                type: 'usage',
                usage: {
                    promptTokens: 18,
                    completionTokens: 6,
                    totalTokens: 24,
                },
            },
            {
                type: 'stop',
                finishReason: 'tool_calls',
                message: {
                    role: 'assistant',
                    content: '',
                    toolCalls: [toolCall],
                },
            },
        ]);
    });

    it('falls back to complete() when stream() is unavailable', async () => {
        const stream = streamProviderEvents({
            provider: createFakeProvider({
                completeImpl: async () => ({
                    message: {
                        role: 'assistant',
                        content: 'complete fallback',
                    },
                    usage: {
                        promptTokens: 7,
                        completionTokens: 2,
                        totalTokens: 9,
                    },
                    finishReason: 'stop',
                }),
            }) as any,
            request: {
                messages: [{ role: 'user', content: 'Fallback please' }],
                tools: [],
            },
        });

        const eventsPromise = collectNormalizedEvents(stream.events);
        await stream.completed;

        expect(await eventsPromise).toEqual([
            {
                type: 'usage',
                usage: {
                    promptTokens: 7,
                    completionTokens: 2,
                    totalTokens: 9,
                },
            },
            {
                type: 'stop',
                finishReason: 'stop',
                message: {
                    role: 'assistant',
                    content: 'complete fallback',
                    toolCalls: undefined,
                },
            },
        ]);
    });

    it('falls back to complete() when stream() fails before emitting any events', async () => {
        const stream = streamProviderEvents({
            provider: createFakeProvider({
                streamImpl: async () => {
                    throw new Error('stream unsupported');
                },
                completeImpl: async () => ({
                    message: {
                        role: 'assistant',
                        content: 'complete after stream failure',
                    },
                    usage: {
                        promptTokens: 9,
                        completionTokens: 3,
                        totalTokens: 12,
                    },
                    finishReason: 'stop',
                }),
            }),
            request: {
                messages: [{ role: 'user', content: 'Fallback after error' }],
                tools: [],
            },
        });

        const eventsPromise = collectNormalizedEvents(stream.events);
        await stream.completed;

        expect(await eventsPromise).toEqual([
            {
                type: 'usage',
                usage: {
                    promptTokens: 9,
                    completionTokens: 3,
                    totalTokens: 12,
                },
            },
            {
                type: 'stop',
                finishReason: 'stop',
                message: {
                    role: 'assistant',
                    content: 'complete after stream failure',
                    toolCalls: undefined,
                },
            },
        ]);
    });

    it('emits an error event when provider streaming fails', async () => {
        const stream = streamProviderEvents({
            provider: createStreamingProvider(async (callbacks) => {
                callbacks.onError?.(new Error('boom'));
                throw new Error('boom');
            }),
            request: {
                messages: [{ role: 'user', content: 'Fail please' }],
                tools: [],
            },
        });

        const eventsPromise = collectNormalizedEvents(stream.events);
        await expect(stream.completed).rejects.toThrow('boom');
        expect(await eventsPromise).toEqual([
            { type: 'error', message: 'boom' },
        ]);
    });
});
