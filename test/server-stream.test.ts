import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'bun:test';
import type { AppEvent } from '@xqoder/protocol';
import type { QuestionPrompt } from '@xqoder/plugin-sdk';
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

function createStatusChangedEvent(sessionId: string, status: 'thinking' | 'done'): AppEvent {
    return {
        type: 'status.changed',
        sessionId,
        timestamp: Date.now(),
        source: 'runtime',
        status,
    } as AppEvent;
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
