import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'bun:test';
import {
    createConversationEventEnvelopeEmitter,
} from '@xqoder/protocol';
import type { AppEvent, ConversationEventEnvelope } from '@xqoder/protocol';
import type { QuestionPrompt } from '@xqoder/plugin-sdk';
import { runChatMessageStream } from '../src/application/chat/run-chat.js';
import { XQoderAgent, type AgentCallbacks } from '../src/core/agent/agent.js';
import { createStreamController } from '../src/interfaces/http/server-stream.js';

describe('HTTP stream controller', () => {
    afterEach(() => {
        restorePatchedTime();
    });

    it('deduplicates repeated status events and closes NDJSON subscribers on completion', async () => {
        patchGlobalTime(500);

        const controller = createStreamController({
            randomId: createDeterministicIdFactory(),
            streamGcTtlMs: 25,
        });
        const eventStream = new MockServerResponse();
        const ndjsonStream = new MockServerResponse();
        const statusEvent = createStatusChangedEvent('session-1', 'thinking');

        controller.addEventSubscriber(eventStream.asResponse(), {
            'Access-Control-Allow-Origin': '*',
        });

        const operation = controller.beginStreamOperation({
            sessionId: 'session-1',
            projectRoot: '/project',
            message: 'hello',
            timeoutMs: 1000,
            runMessageStream: async ({ onEvent }) => {
                onEvent(statusEvent);
                onEvent(statusEvent);
                return {
                    response: 'done',
                    sessionId: 'session-1',
                };
            },
        });

        controller.attachStreamSubscriber(
            operation,
            ndjsonStream.asResponse(),
            { 'Access-Control-Allow-Origin': '*' },
            0,
        );

        await flushAsyncWork();

        expect(parseNdjsonWrites(ndjsonStream)).toEqual([
            {
                type: 'event',
                streamId: 'stream_1',
                seq: 1,
                cursor: 1,
                event: statusEvent,
            },
            {
                type: 'done',
                streamId: 'stream_1',
                seq: 2,
                cursor: 2,
                response: 'done',
                sessionId: 'session-1',
            },
        ]);
        expect(ndjsonStream.writableEnded).toBe(true);
        expect(eventStream.body).toContain('"type":"status.changed"');
    });

    it('emits terminal error records for failed stream operations', async () => {
        patchGlobalTime(750);

        const controller = createStreamController({
            randomId: createDeterministicIdFactory(),
            streamGcTtlMs: 25,
        });
        const ndjsonStream = new MockServerResponse();
        const statusEvent = createStatusChangedEvent('session-1', 'thinking');

        const operation = controller.beginStreamOperation({
            sessionId: 'session-1',
            projectRoot: '/project',
            message: 'boom',
            timeoutMs: 1_000,
            runMessageStream: async ({ onEvent }) => {
                onEvent(statusEvent);
                throw new Error('stream failed');
            },
        });

        controller.attachStreamSubscriber(
            operation,
            ndjsonStream.asResponse(),
            { 'Access-Control-Allow-Origin': '*' },
            0,
        );

        await flushAsyncWork();

        expect(parseNdjsonWrites(ndjsonStream)).toEqual([
            {
                type: 'event',
                streamId: 'stream_1',
                seq: 1,
                cursor: 1,
                event: statusEvent,
            },
            {
                type: 'error',
                streamId: 'stream_1',
                seq: 2,
                cursor: 2,
                message: 'stream failed',
            },
        ]);
        expect(ndjsonStream.writableEnded).toBe(true);
    });

    it('requires streamId when multiple pending question requests share the same session/request pair', async () => {
        patchGlobalTime(1_000);

        const controller = createStreamController({
            randomId: createDeterministicIdFactory(),
            questionTimeoutMs: 1_000,
            streamGcTtlMs: 25,
        });
        const prompt = createQuestionPrompt();

        const operationA = controller.beginStreamOperation({
            sessionId: 'session-1',
            projectRoot: '/project',
            message: 'a',
            timeoutMs: 1_000,
            runMessageStream: async ({ requestQuestion }) => {
                await requestQuestion(prompt);
                return { response: 'A', sessionId: 'session-1' };
            },
        });
        const operationB = controller.beginStreamOperation({
            sessionId: 'session-1',
            projectRoot: '/project',
            message: 'b',
            timeoutMs: 1_000,
            runMessageStream: async ({ requestQuestion }) => {
                await requestQuestion(prompt);
                return { response: 'B', sessionId: 'session-1' };
            },
        });

        await flushAsyncWork();

        const ambiguous = controller.resolveQuestionRequest({
            sessionId: 'session-1',
            requestId: prompt.requestId,
            selected: ['Allow'],
        });
        expect(ambiguous).toEqual({
            ok: false,
            status: 409,
            body: {
                error: 'Multiple pending question requests; specify streamId',
                sessionId: 'session-1',
                requestId: prompt.requestId,
            },
        });

        const resolved = controller.resolveQuestionRequest({
            sessionId: 'session-1',
            streamId: operationA.id,
            requestId: prompt.requestId,
            selected: ['Allow'],
        });
        expect(resolved).toEqual({ ok: true });

        const cancelled = controller.cancelStreamOperation('session-1', operationB.id);
        expect(cancelled).toEqual({ ok: true, streamId: operationB.id });

        await flushAsyncWork();
    });

    it('aborts active streams and resolves pending questions with fallback selections', async () => {
        patchGlobalTime(2_000);

        const controller = createStreamController({
            randomId: createDeterministicIdFactory(),
            questionTimeoutMs: 1_000,
            streamGcTtlMs: 25,
        });
        const ndjsonStream = new MockServerResponse();
        const answers: Array<{ label: string; selected: string[] }> = [];

        const operation = controller.beginStreamOperation({
            sessionId: 'session-1',
            projectRoot: '/project',
            message: 'needs approval',
            timeoutMs: 1_000,
            runMessageStream: async ({ requestQuestion, signal }) => {
                const answer = await requestQuestion({
                    requestId: 'question-1',
                    question: 'Continue?',
                    options: [{ label: 'Default' }, { label: 'Other' }],
                });
                answers.push({ label: 'resolved', selected: answer.selected });
                if (signal.aborted) {
                    throw signal.reason;
                }
                await new Promise<void>((_, reject) => {
                    signal.addEventListener('abort', () => {
                        reject(signal.reason);
                    }, { once: true });
                });
                return { response: 'never', sessionId: 'session-1' };
            },
        });

        controller.attachStreamSubscriber(
            operation,
            ndjsonStream.asResponse(),
            { 'Access-Control-Allow-Origin': '*' },
            0,
        );

        await flushAsyncWork();

        const cancelled = controller.cancelStreamOperation('session-1', operation.id);
        expect(cancelled).toEqual({ ok: true, streamId: operation.id });

        await flushAsyncWork();

        expect(answers).toEqual([{ label: 'resolved', selected: ['Default'] }]);
        const records = parseNdjsonWrites(ndjsonStream);
        expect(records.at(-1)).toEqual({
            type: 'cancelled',
            streamId: operation.id,
            seq: 1,
            cursor: 1,
            reason: 'Cancelled by client',
        });
    });

    it('can stream aligned application chat events through the HTTP NDJSON transport', async () => {
        patchGlobalTime(3_000);

        const controller = createStreamController({
            randomId: createDeterministicIdFactory(),
            streamGcTtlMs: 25,
        });
        const ndjsonStream = new MockServerResponse();

        const operation = controller.beginStreamOperation({
            sessionId: 'session-1',
            projectRoot: '/project',
            message: 'hello over http',
            timeoutMs: 1_000,
            runMessageStream: async ({ projectRoot, sessionId, message, onEvent, requestQuestion, signal }) => {
                return await runChatMessageStream({
                    prompt: message,
                    cwd: projectRoot,
                    entrypoint: 'http',
                    sessionId,
                    onEvent,
                    requestQuestion,
                    signal,
                }, {
                    configManager: {
                        load: () => ({
                            llm: {
                                provider: 'openai',
                                model: 'gpt-4.1',
                                apiKey: 'test-key',
                            },
                            providers: {
                                openai: {
                                    apiKey: 'test-key',
                                    defaultModel: 'gpt-4.1',
                                },
                            },
                            defaultAgent: 'general',
                            agents: {
                                general: {
                                    mode: 'primary',
                                    provider: 'openai',
                                    model: 'gpt-4.1',
                                },
                            },
                            sandbox: {
                                mode: 'project',
                                allowedPaths: [],
                            },
                        }),
                    },
                    sessionStore: {
                        findLatestSession: () => null,
                        getSession: () => ({
                            id: 'session-1',
                            getMessages: () => [],
                        }),
                        saveSession: () => ({ id: 'session-1' }),
                    } as any,
                    agentFactory: () => ({
                        async run(_prompt, callbacks) {
                            callbacks?.onToken?.('HTTP_STREAM');
                            return 'HTTP_STREAM';
                        },
                        getSession() {
                            return { id: 'session-1' } as any;
                        },
                        async dispose() {},
                    }),
                });
            },
        });

        controller.attachStreamSubscriber(
            operation,
            ndjsonStream.asResponse(),
            { 'Access-Control-Allow-Origin': '*' },
            0,
        );

        await flushAsyncWork();

        const records = parseNdjsonWrites(ndjsonStream);
        expect(records[0]).toMatchObject({
            type: 'event',
            event: {
                type: 'session.resumed',
                sessionId: 'session-1',
            },
        });
        expect(records.some((record) => {
            const event = (record as { event?: ConversationEventEnvelope }).event;
            return event?.type === 'message.delta' && event.payload.text === 'HTTP_STREAM';
        })).toBe(true);
        expect(records.at(-1)).toEqual({
            type: 'done',
            streamId: 'stream_1',
            seq: expect.any(Number),
            cursor: expect.any(Number),
            response: 'HTTP_STREAM',
            sessionId: 'session-1',
        });
    });

    it('streams usage evidence through the HTTP NDJSON transport', async () => {
        patchGlobalTime(3_500);

        const controller = createStreamController({
            randomId: createDeterministicIdFactory(),
            streamGcTtlMs: 25,
        });
        const ndjsonStream = new MockServerResponse();

        const operation = controller.beginStreamOperation({
            sessionId: 'session-usage',
            projectRoot: '/project',
            message: 'hello usage over http',
            timeoutMs: 1_000,
            runMessageStream: async ({ projectRoot, sessionId, message, onEvent, requestQuestion, signal }) => {
                return await runChatMessageStream({
                    prompt: message,
                    cwd: projectRoot,
                    entrypoint: 'http',
                    sessionId,
                    startNewSession: true,
                    onEvent,
                    requestQuestion,
                    signal,
                }, {
                    configManager: {
                        load: () => createLoadedConfig('test-key'),
                    },
                    sessionStore: {
                        findLatestSession: () => null,
                        getSession: () => null,
                        saveSession: () => ({ id: 'session-usage' }),
                    } as any,
                    agentFactory: (config) => createAgentWithStreamingUsage(config as Record<string, unknown>),
                });
            },
        });

        controller.attachStreamSubscriber(
            operation,
            ndjsonStream.asResponse(),
            { 'Access-Control-Allow-Origin': '*' },
            0,
        );

        await flushAsyncWork();

        const records = parseNdjsonWrites(ndjsonStream);
        expect(records.some((record) => {
            const event = (record as { event?: ConversationEventEnvelope }).event;
            return event?.type === 'usage'
                && event.payload.model === 'gpt-4.1'
                && event.payload.totalTokens === 34;
        })).toBe(true);
        expect(records.at(-1)).toEqual({
            type: 'done',
            streamId: 'stream_1',
            seq: expect.any(Number),
            cursor: expect.any(Number),
            response: 'HTTP_USAGE',
            sessionId: 'session-usage',
        });
    });

    it('keeps NDJSON event records envelope-only while preserving terminal payload semantics', async () => {
        patchGlobalTime(3_750);

        const controller = createStreamController({
            randomId: createDeterministicIdFactory(),
            streamGcTtlMs: 25,
        });
        const ndjsonStream = new MockServerResponse();

        const operation = controller.beginStreamOperation({
            sessionId: 'session-conversation',
            projectRoot: '/project',
            message: 'verify me',
            timeoutMs: 1_000,
            runMessageStream: async ({ onEvent }) => {
                const eventEmitter = createConversationEventEnvelopeEmitter('session-conversation', 'session-conversation:turn:test');
                onEvent(eventEmitter.emit({
                    type: 'verification.completed',
                    sessionId: 'session-conversation',
                    timestamp: Date.now(),
                    source: 'agent',
                    ok: false,
                    blocked: true,
                    summary: 'Verification failed',
                } as AppEvent));
                onEvent(eventEmitter.emit({
                    type: 'status.changed',
                    sessionId: 'session-conversation',
                    timestamp: Date.now(),
                    source: 'agent',
                    status: 'done',
                    stopReason: 'completed',
                } as AppEvent));

                return {
                    response: 'done',
                    sessionId: 'session-conversation',
                };
            },
        });

        controller.attachStreamSubscriber(
            operation,
            ndjsonStream.asResponse(),
            { 'Access-Control-Allow-Origin': '*' },
            0,
        );

        await flushAsyncWork();

        const records = parseNdjsonWrites(ndjsonStream);
        expect(records.find((record) => {
            const eventRecord = record as {
                type: string;
                event?: {
                    type?: string;
                    payload?: { summary?: string; ok?: boolean; blocked?: boolean };
                };
            };
            return eventRecord.type === 'event'
                && eventRecord.event?.type === 'verification.completed'
                && eventRecord.event.payload?.summary === 'Verification failed'
                && eventRecord.event.payload?.ok === false
                && eventRecord.event.payload?.blocked === true;
        })).toBeDefined();
        expect(records.find((record) => {
            const eventRecord = record as {
                type: string;
                event?: {
                    type?: string;
                    payload?: { status?: string; stopReason?: string };
                };
            };
            return eventRecord.type === 'event'
                && eventRecord.event?.type === 'status.changed';
        })).toMatchObject({
            event: {
                type: 'status.changed',
                payload: {
                    status: 'done',
                    stopReason: 'completed',
                },
            },
        });
    });
});

class MockServerResponse extends EventEmitter {
    public headers: Record<string, string> = {};
    public statusCode = 200;
    public writableEnded = false;
    private readonly chunks: string[] = [];

    get body(): string {
        return this.chunks.join('');
    }

    asResponse(): http.ServerResponse {
        return this as unknown as http.ServerResponse;
    }

    writeHead(statusCode: number, headers: Record<string, string>): this {
        this.statusCode = statusCode;
        this.headers = headers;
        return this;
    }

    write(chunk: string): boolean {
        this.chunks.push(chunk);
        return true;
    }

    end(chunk?: string): this {
        if (typeof chunk === 'string') {
            this.chunks.push(chunk);
        }
        this.writableEnded = true;
        this.emit('close');
        return this;
    }
}

function parseNdjsonWrites(res: MockServerResponse): unknown[] {
    return res.body
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function createStatusChangedEvent(sessionId: string, status: 'thinking' | 'done'): ConversationEventEnvelope<'status.changed'> {
    return createConversationEventEnvelopeEmitter(sessionId, `${sessionId}:turn:test`).emit({
        type: 'status.changed',
        sessionId,
        timestamp: Date.now(),
        source: 'runtime',
        status,
    } as AppEvent) as ConversationEventEnvelope<'status.changed'>;
}

function createQuestionPrompt(): QuestionPrompt {
    return {
        requestId: 'question-1',
        question: 'Continue?',
        options: [{ label: 'Allow' }, { label: 'Deny' }],
    };
}

function createDeterministicIdFactory(): (prefix: string) => string {
    let counter = 0;
    return (prefix: string) => {
        counter += 1;
        return `${prefix}_${counter}`;
    };
}

function createLoadedConfig(apiKey: string) {
    return {
        llm: {
            provider: 'openai',
            model: 'gpt-4.1',
            apiKey,
        },
        providers: {
            openai: {
                apiKey,
                defaultModel: 'gpt-4.1',
            },
        },
        defaultAgent: 'general',
        agents: {
            general: {
                mode: 'primary',
                provider: 'openai',
                model: 'gpt-4.1',
            },
        },
        sandbox: {
            mode: 'project',
            allowedPaths: [],
        },
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
                callbacks?.onToken?.('HTTP_');
                callbacks?.onToken?.('USAGE');
                return {
                    finishReason: 'stop',
                    message: {
                        role: 'assistant',
                        content: 'HTTP_USAGE',
                    },
                    usage: {
                        promptTokens: 30,
                        completionTokens: 4,
                        totalTokens: 34,
                    },
                };
            },
        }),
    });
}

let originalDateNow: (() => number) | null = null;

function patchGlobalTime(now: number): void {
    restorePatchedTime();
    originalDateNow = Date.now;
    Date.now = () => now;
}

function restorePatchedTime(): void {
    if (originalDateNow) {
        Date.now = originalDateNow;
        originalDateNow = null;
    }
}

async function flushAsyncWork(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}
