import { afterEach, describe, expect, it } from 'bun:test';
import type { AgentRuntimeEvent, TuiAgentSettings } from '../../../src/application/agent/index.js';
import { RemoteTuiAgentService } from '../../../src/infrastructure/agent/remote-tui-agent-service.js';

const settings: TuiAgentSettings = {
    dir: '/workspace/demo',
    model: 'gpt-4.1',
    agent: 'general',
    sandboxMode: 'project',
};

const descriptorRestorers: Array<() => void> = [];

afterEach(() => {
    while (descriptorRestorers.length > 0) {
        descriptorRestorers.pop()?.();
    }
});

describe('RemoteTuiAgentService', () => {
    it('emits synthetic user events before forwarding remote stream events', async () => {
        const calls: FetchCall[] = [];
        setGlobalFetch(async (input, init) => {
            calls.push(toFetchCall(input, init));
            return createNdjsonResponse([
                {
                    type: 'event',
                    streamId: 'stream-1',
                    seq: 1,
                    cursor: 1,
                    event: createStatusChangedEvent('session-1', 'thinking'),
                },
                {
                    type: 'done',
                    streamId: 'stream-1',
                    seq: 2,
                    cursor: 2,
                    sessionId: 'session-1',
                    response: 'done',
                },
            ]);
        });

        const service = new RemoteTuiAgentService('http://example.test');
        const events: AgentRuntimeEvent[] = [];
        const result = await service.sendMessage('hello', 'session-1', settings, [], {
            onEvent: (event) => {
                events.push(event);
            },
        });

        expect(result).toEqual({ sessionId: 'session-1' });
        expect(events.map((event) => event.type)).toEqual([
            'message.started',
            'message.completed',
            'status.changed',
        ]);

        const streamCall = calls[0];
        expect(streamCall?.url).toBe('http://example.test/session/session-1/message/stream');
        expect(streamCall?.init?.method).toBe('POST');
        expect(JSON.parse(String(streamCall?.init?.body))).toEqual({
            message: 'hello',
            attachments: undefined,
            timeoutMs: 45000,
        });
    });

    it('resolves remote questions with the active stream id', async () => {
        const calls: FetchCall[] = [];
        setGlobalFetch(async (input, init) => {
            const call = toFetchCall(input, init);
            calls.push(call);

            if (call.url.endsWith('/resolve')) {
                return createJsonResponse({ ok: true });
            }

            return createNdjsonResponse([
                {
                    type: 'event',
                    streamId: 'stream-9',
                    seq: 1,
                    cursor: 1,
                    event: {
                        type: 'question.requested',
                        sessionId: 'session-1',
                        timestamp: 1,
                        source: 'agent',
                        requestId: 'question-1',
                        question: 'Continue?',
                        options: [{ label: 'Allow' }, { label: 'Deny' }],
                    },
                },
                {
                    type: 'done',
                    streamId: 'stream-9',
                    seq: 2,
                    cursor: 2,
                    sessionId: 'session-1',
                    response: 'done',
                },
            ]);
        });

        const service = new RemoteTuiAgentService('http://example.test');
        await service.sendMessage('hello', 'session-1', settings, [], {
            onEvent() {},
            onQuestion: async (request) => ({
                requestId: request.requestId,
                selected: ['Allow'],
            }),
        });

        const resolveCall = calls.find((call) => call.url.endsWith('/question/question-1/resolve'));
        expect(resolveCall?.url).toBe('http://example.test/session/session-1/question/question-1/resolve');
        expect(resolveCall?.init?.method).toBe('POST');
        expect(JSON.parse(String(resolveCall?.init?.body))).toEqual({
            selected: ['Allow'],
            customText: undefined,
            streamId: 'stream-9',
        });
    });

    it('propagates cancel requests to the remote stream endpoint once a stream id is known', async () => {
        const calls: FetchCall[] = [];
        let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
        let resolveRemoteEvent: (() => void) | null = null;
        const remoteEventSeen = new Promise<void>((resolve) => {
            resolveRemoteEvent = resolve;
        });

        setGlobalFetch(async (input, init) => {
            const call = toFetchCall(input, init);
            calls.push(call);

            if (call.url.endsWith('/cancel')) {
                return createJsonResponse({ ok: true });
            }

            return new Response(new ReadableStream({
                start(controller) {
                    streamController = controller;
                    controller.enqueue(encodeNdjson({
                        type: 'event',
                        streamId: 'stream-3',
                        seq: 1,
                        cursor: 1,
                        event: createStatusChangedEvent('session-1', 'thinking'),
                    }));
                },
            }), {
                headers: {
                    'Content-Type': 'application/x-ndjson',
                },
            });
        });

        const service = new RemoteTuiAgentService('http://example.test');
        const sendPromise = service.sendMessage('hello', 'session-1', settings, [], {
            onEvent: (event) => {
                if (event.type === 'status.changed') {
                    resolveRemoteEvent?.();
                }
            },
        });

        await remoteEventSeen;
        service.cancel();
        await tick();

        try {
            streamController?.enqueue(encodeNdjson({
                type: 'cancelled',
                streamId: 'stream-3',
                seq: 2,
                cursor: 2,
                reason: 'Cancelled by client',
            }));
            streamController?.close();
        } catch {
            // ignore stream shutdown races triggered by AbortController
        }

        await sendPromise.catch(() => undefined);

        const cancelCall = calls.find((call) => call.url.endsWith('/stream/stream-3/cancel'));
        expect(cancelCall?.url).toBe('http://example.test/session/session-1/stream/stream-3/cancel');
        expect(cancelCall?.init?.method).toBe('POST');
        expect(JSON.parse(String(cancelCall?.init?.body))).toEqual({});
    });
});

type FetchCall = {
    url: string;
    init?: RequestInit;
};

function setGlobalFetch(fetchImpl: typeof fetch): void {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: fetchImpl,
    });
    descriptorRestorers.push(() => {
        if (previous) {
            Object.defineProperty(globalThis, 'fetch', previous);
            return;
        }
        delete (globalThis as Record<string, unknown>).fetch;
    });
}

function toFetchCall(input: RequestInfo | URL, init?: RequestInit): FetchCall {
    return {
        url: typeof input === 'string' ? input : input.toString(),
        init,
    };
}

function createStatusChangedEvent(sessionId: string, status: 'thinking' | 'done'): AgentRuntimeEvent {
    return {
        type: 'status.changed',
        sessionId,
        timestamp: Date.now(),
        source: 'agent',
        status,
    };
}

function createJsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

function createNdjsonResponse(records: unknown[]): Response {
    return new Response(new ReadableStream({
        start(controller) {
            records.forEach((record) => {
                controller.enqueue(encodeNdjson(record));
            });
            controller.close();
        },
    }), {
        headers: {
            'Content-Type': 'application/x-ndjson',
        },
    });
}

function encodeNdjson(record: unknown): Uint8Array {
    return new TextEncoder().encode(`${JSON.stringify(record)}\n`);
}

async function tick(): Promise<void> {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}
