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
    it('allows slower OpenAI-compatible providers enough time to stream', async () => {
        let createOptions: Record<string, unknown> | undefined;
        const provider = new OpenAIProvider(createConfig(), {
            client: {
                chat: {
                    completions: {
                        create: async (_params: Record<string, unknown>, options?: Record<string, unknown>) => {
                            createOptions = options;
                            return createAsyncIterable([
                                {
                                    choices: [
                                        {
                                            index: 0,
                                            delta: { content: 'ok' },
                                            finish_reason: 'stop',
                                        },
                                    ],
                                    usage: {
                                        prompt_tokens: 1,
                                        completion_tokens: 1,
                                        total_tokens: 2,
                                    },
                                },
                            ]) as any;
                        },
                    },
                },
            } as any,
        });

        await provider.stream({
            messages: [{ role: 'user', content: 'Say ok' }],
            tools: [],
        }, {});

        expect(createOptions).toEqual({ timeout: 120_000 });
    });

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

    it('bridges tool result attachments into OpenAI content parts after consecutive tool results', async () => {
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
                    role: 'assistant',
                    content: '',
                    toolCalls: [
                        { id: 'tool-1', name: 'read_any_file', arguments: '{}' },
                        { id: 'tool-2', name: 'read_file', arguments: '{}' },
                    ],
                },
                {
                    role: 'tool',
                    toolCallId: 'tool-1',
                    content: 'PDF pages rendered',
                    attachments: [
                        { type: 'image', mimeType: 'image/jpeg', data: 'cGFnZQ==', fileName: 'page-1.jpg' },
                        { type: 'file', mimeType: 'application/pdf', data: 'JVBERi0=', fileName: 'report.pdf' },
                    ],
                },
                {
                    role: 'tool',
                    toolCallId: 'tool-2',
                    content: 'plain text result',
                },
            ],
            tools: [],
        });

        const messages = createCalls[0]?.messages as Array<Record<string, unknown>>;
        expect(messages.map((message) => message.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
        expect(messages[3]?.content).toEqual([
            {
                type: 'text',
                text: expect.stringContaining('tool_call_id=tool-1'),
            },
            {
                type: 'image_url',
                image_url: {
                    url: 'data:image/jpeg;base64,cGFnZQ==',
                },
            },
            {
                type: 'file',
                file: {
                    file_data: 'JVBERi0=',
                    filename: 'report.pdf',
                },
            },
        ]);
    });

    it('warns when a provider/model cannot receive native PDF file parts', async () => {
        const createCalls: Array<Record<string, unknown>> = [];
        class DashScopeCompatibleProvider extends OpenAIProvider {
            readonly name = 'dashscope' as const;
        }
        const provider = new DashScopeCompatibleProvider({
            ...createConfig(),
            provider: 'dashscope',
            model: 'qwen-plus',
        }, {
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
                    role: 'assistant',
                    content: '',
                    toolCalls: [
                        { id: 'tool-1', name: 'read_any_file', arguments: '{}' },
                    ],
                },
                {
                    role: 'tool',
                    toolCallId: 'tool-1',
                    content: 'PDF text content was not extracted.',
                    attachments: [
                        { type: 'file', mimeType: 'application/pdf', data: 'JVBERi0=', fileName: 'report.pdf' },
                    ],
                },
            ],
            tools: [],
        });

        const messages = createCalls[0]?.messages as Array<Record<string, unknown>>;
        const syntheticUser = messages[2] as Record<string, unknown>;
        expect(syntheticUser.role).toBe('user');
        expect(syntheticUser.content).toEqual([
            {
                type: 'text',
                text: expect.stringContaining('Provider dashscope/qwen-plus cannot receive'),
            },
        ]);
        expect(JSON.stringify(syntheticUser.content)).not.toContain('"type":"file"');
    });

    it('allows DashScope PDF file parts when the configured model explicitly enables PDF modality', async () => {
        const createCalls: Array<Record<string, unknown>> = [];
        class DashScopeCompatibleProvider extends OpenAIProvider {
            readonly name = 'dashscope' as const;
        }
        const provider = new DashScopeCompatibleProvider({
            ...createConfig(),
            provider: 'dashscope',
            model: 'custom-qwen-pdf',
            modalities: { pdf: true },
        }, {
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
                    content: 'Read the PDF',
                    attachments: [
                        { type: 'file', mimeType: 'application/pdf', data: 'JVBERi0=', fileName: 'report.pdf' },
                    ],
                },
            ],
            tools: [],
        });

        const messages = createCalls[0]?.messages as Array<Record<string, unknown>>;
        const userMessage = messages[0] as Record<string, unknown>;
        expect(userMessage.content).toEqual([
            {
                type: 'text',
                text: expect.stringContaining('Read the PDF'),
            },
            {
                type: 'file',
                file: {
                    file_data: 'data:application/pdf;base64,JVBERi0=',
                    filename: 'report.pdf',
                },
            },
        ]);
    });
});
