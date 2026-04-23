import { describe, expect, it } from 'bun:test';
import { OpenAIProvider } from '../../src/infra/llm/openai/provider/index.js';

function createConfig() {
    return {
        provider: 'openai' as const,
        model: 'gpt-4.1',
        apiKey: 'test-key',
    };
}

function createAsyncIterable<T>(values: T[]): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator]() {
            let index = 0;
            return {
                async next() {
                    if (index >= values.length) {
                        return { value: undefined, done: true };
                    }
                    const value = values[index];
                    index += 1;
                    return { value, done: false };
                },
            };
        },
    };
}

describe('OpenAIProvider', () => {
    it('requests streaming usage stats and returns the final usage chunk', async () => {
        const createCalls: Array<Record<string, unknown>> = [];
        const provider = new OpenAIProvider(createConfig(), {
            client: {
                chat: {
                    completions: {
                        create: async (params: Record<string, unknown>) => {
                            createCalls.push(params);
                            return createAsyncIterable([
                                {
                                    choices: [
                                        {
                                            index: 0,
                                            delta: { content: 'Hel' },
                                            finish_reason: null,
                                        },
                                    ],
                                    usage: null,
                                },
                                {
                                    choices: [
                                        {
                                            index: 0,
                                            delta: { content: 'lo' },
                                            finish_reason: 'stop',
                                        },
                                    ],
                                    usage: null,
                                },
                                {
                                    choices: [],
                                    usage: {
                                        prompt_tokens: 12,
                                        completion_tokens: 3,
                                        total_tokens: 15,
                                    },
                                },
                            ]) as any;
                        },
                    },
                },
            } as any,
        });

        const tokens: string[] = [];
        const response = await provider.stream({
            messages: [{ role: 'user', content: 'Say hello' }],
            tools: [],
        }, {
            onToken: (token) => {
                tokens.push(token);
            },
        });

        expect(createCalls).toHaveLength(1);
        expect(createCalls[0]?.stream).toBe(true);
        expect(createCalls[0]?.stream_options).toEqual({ include_usage: true });
        expect(tokens).toEqual(['Hel', 'lo']);
        expect(response).toEqual({
            message: {
                role: 'assistant',
                content: 'Hello',
                toolCalls: undefined,
            },
            usage: {
                promptTokens: 12,
                completionTokens: 3,
                totalTokens: 15,
            },
            finishReason: 'stop',
        });
    });

    it('serializes file and image attachments into OpenAI user content parts', async () => {
        const createCalls: Array<Record<string, unknown>> = [];
        const provider = new OpenAIProvider(createConfig(), {
            client: {
                chat: {
                    completions: {
                        create: async (params: Record<string, unknown>) => {
                            createCalls.push(params);
                            return {
                                choices: [
                                    {
                                        finish_reason: 'stop',
                                        message: {
                                            role: 'assistant',
                                            content: 'done',
                                        },
                                    },
                                ],
                                usage: {
                                    prompt_tokens: 9,
                                    completion_tokens: 2,
                                    total_tokens: 11,
                                },
                            };
                        },
                    },
                },
            } as any,
        });

        await provider.complete({
            messages: [
                {
                    role: 'user',
                    content: 'Review these attachments',
                    attachments: [
                        { type: 'file', filePath: '/tmp/report.md' },
                        { type: 'image', mimeType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' },
                    ],
                },
            ],
            tools: [],
        });

        const userMessage = (createCalls[0]?.messages as Array<Record<string, unknown>>)[0];
        expect(userMessage?.role).toBe('user');
        expect(userMessage?.content).toEqual([
            {
                type: 'text',
                text: expect.stringContaining('Review these attachments'),
            },
            {
                type: 'image_url',
                image_url: {
                    url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
                },
            },
        ]);

        const textPart = (userMessage?.content as Array<Record<string, unknown>>)[0];
        expect(String(textPart?.text)).toContain('[AttachedFiles]');
        expect(String(textPart?.text)).toContain('/tmp/report.md');
    });
});
