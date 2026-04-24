import { afterEach, describe, expect, it } from 'bun:test';
import {
    createConversationEventEnvelopeEmitter,
} from '@xqoder/protocol';
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
    it('returns remote session messages together with conversation signals for inspect flows', async () => {
        setGlobalFetch(async () => createJsonResponse({
            messages: [
                { role: 'user', content: 'inspect remotely' },
                { role: 'assistant', content: 'remote transcript ready' },
            ],
            conversationSignals: [
                { type: 'user', content: 'inspect remotely' },
                { type: 'assistant', content: 'remote transcript ready' },
            ],
        }));

        const service = new RemoteTuiAgentService('http://example.test');
        const result = await service.getSessionMessages('session-1');

        expect(result).toEqual({
            messages: [
                { role: 'user', content: 'inspect remotely' },
                { role: 'assistant', content: 'remote transcript ready' },
            ],
            conversationSignals: [
                { type: 'user', content: 'inspect remotely' },
                { type: 'assistant', content: 'remote transcript ready' },
            ],
        });
    });

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
            const eventEmitter = createConversationEventEnvelopeEmitter('session-1', 'session-1:turn:remote-question');

            if (call.url.endsWith('/resolve')) {
                return createJsonResponse({ ok: true });
            }

            return createNdjsonResponse([
                {
                    type: 'event',
                    streamId: 'stream-9',
                    seq: 1,
                    cursor: 1,
                    event: eventEmitter.emitRecord('question.requested', {
                        source: 'agent',
                        requestId: 'question-1',
                        question: 'Continue?',
                        options: [{ label: 'Allow' }, { label: 'Deny' }],
                    }),
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

    it('resolves remote approval requests with the active stream id', async () => {
        const calls: FetchCall[] = [];
        setGlobalFetch(async (input, init) => {
            const call = toFetchCall(input, init);
            calls.push(call);
            const eventEmitter = createConversationEventEnvelopeEmitter('session-1', 'session-1:turn:remote-approval');

            if (call.url.endsWith('/resolve')) {
                return createJsonResponse({ ok: true });
            }

            return createNdjsonResponse([
                {
                    type: 'event',
                    streamId: 'stream-approval',
                    seq: 1,
                    cursor: 1,
                    event: eventEmitter.emitRecord('approval.requested', {
                        source: 'agent',
                        requestId: 'tool-call-1',
                        kind: 'tool',
                        summary: 'Write src/example.ts',
                        payload: {
                            toolCallId: 'tool-call-1',
                            toolName: 'write_file',
                            summary: 'Write src/example.ts',
                            preview: 'src/example.ts',
                            risk: 'high',
                        },
                    }),
                },
                {
                    type: 'done',
                    streamId: 'stream-approval',
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
            onToolApproval: async (request) => {
                expect(request).toMatchObject({
                    toolCallId: 'tool-call-1',
                    toolName: 'write_file',
                    summary: 'Write src/example.ts',
                    preview: 'src/example.ts',
                    risk: 'high',
                });
                return true;
            },
        });

        const resolveCall = calls.find((call) => call.url.endsWith('/approval/tool-call-1/resolve'));
        expect(resolveCall?.url).toBe('http://example.test/session/session-1/approval/tool-call-1/resolve');
        expect(resolveCall?.init?.method).toBe('POST');
        expect(JSON.parse(String(resolveCall?.init?.body))).toEqual({
            decision: 'allow',
            streamId: 'stream-approval',
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

    it('forwards remote usage events without dropping token statistics', async () => {
        const eventEmitter = createConversationEventEnvelopeEmitter('session-1', 'session-1:turn:remote-usage');
        setGlobalFetch(async () => createNdjsonResponse([
            {
                type: 'event',
                streamId: 'stream-usage',
                seq: 1,
                cursor: 1,
                event: eventEmitter.emitRecord('usage', {
                    source: 'agent',
                    model: 'gpt-4.1',
                    promptTokens: 21,
                    completionTokens: 4,
                    totalTokens: 25,
                    cost: 0.45,
                }),
            },
            {
                type: 'done',
                streamId: 'stream-usage',
                seq: 2,
                cursor: 2,
                sessionId: 'session-1',
                response: 'done',
            },
        ]));

        const service = new RemoteTuiAgentService('http://example.test');
        const events: AgentRuntimeEvent[] = [];

        const result = await service.sendMessage('hello', 'session-1', settings, [], {
            onEvent: (event) => {
                events.push(event);
            },
        });

        expect(result).toEqual({ sessionId: 'session-1' });
        expect(events.find((event) => event.type === 'usage')).toMatchObject({
            type: 'usage',
            payload: {
                model: 'gpt-4.1',
                promptTokens: 21,
                completionTokens: 4,
                totalTokens: 25,
                cost: 0.45,
            },
        });
    });

    it('forwards remote verification envelopes without relying on extra conversation-event metadata', async () => {
        const eventEmitter = createConversationEventEnvelopeEmitter('session-1', 'session-1:turn:remote-verification');
        setGlobalFetch(async () => createNdjsonResponse([
            {
                type: 'event',
                streamId: 'stream-conversation-event',
                seq: 1,
                cursor: 1,
                event: eventEmitter.emitRecord('verification.completed', {
                    source: 'agent',
                    ok: true,
                    blocked: false,
                    summary: 'Verification passed remotely',
                }),
            },
            {
                type: 'done',
                streamId: 'stream-conversation-event',
                seq: 2,
                cursor: 2,
                sessionId: 'session-1',
                response: 'done',
            },
        ]));

        const service = new RemoteTuiAgentService('http://example.test');
        const events: AgentRuntimeEvent[] = [];

        const result = await service.sendMessage('hello', 'session-1', settings, [], {
            onEvent: (event) => {
                events.push(event);
            },
        });

        expect(result).toEqual({ sessionId: 'session-1' });
        expect(events.find((event) => event.type === 'verification.completed')).toMatchObject({
            type: 'verification.completed',
            payload: {
                ok: true,
                blocked: false,
                summary: 'Verification passed remotely',
            },
        });
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
    return createConversationEventEnvelopeEmitter(sessionId, `${sessionId}:turn:test`).emitRecord('status.changed', {
        source: 'agent',
        status,
    });
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
