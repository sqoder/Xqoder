import { afterEach, describe, expect, it } from 'vitest';
import { RemoteTuiAgentService, type TuiAgentSettings } from './agent-service.js';
import { createInMemoryFetch } from '../server/in-memory-client.js';

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

function defaultSettings(): TuiAgentSettings {
    return {
        dir: '/tmp/project',
        model: 'openai/gpt-4o',
        agent: 'general',
        sandboxMode: 'project',
    };
}

describe('RemoteTuiAgentService reliability', () => {
    afterEach(async () => {});

    it('reconnects with streamId/cursor after network drop', async () => {
        const requestBodies: Array<Record<string, unknown>> = [];
        let callCount = 0;

        const fetchImpl = createInMemoryFetch(async (req, res) => {
            const url = req.url ?? '/';
            if (req.method === 'POST' && url === '/session/s1/message/stream') {
                const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
                requestBodies.push(body);
                callCount += 1;

                res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
                if (callCount === 1) {
                    res.write(`${JSON.stringify({
                        type: 'event',
                        streamId: 'stream-reconnect',
                        seq: 1,
                        cursor: 1,
                        event: {
                            type: 'status.changed',
                            sessionId: 's1',
                            timestamp: Date.now(),
                            source: 'agent',
                            status: 'thinking',
                        },
                    })}\n`);
                    res.end();
                    return;
                }

                res.write(`${JSON.stringify({
                    type: 'event',
                    streamId: 'stream-reconnect',
                    seq: 2,
                    cursor: 2,
                    event: {
                        type: 'status.changed',
                        sessionId: 's1',
                        timestamp: Date.now(),
                        source: 'agent',
                        status: 'running-tool',
                    },
                })}\n`);
                res.write(`${JSON.stringify({
                    type: 'done',
                    streamId: 'stream-reconnect',
                    seq: 3,
                    cursor: 3,
                    sessionId: 's1',
                    response: 'done',
                })}\n`);
                res.end();
                return;
            }

            res.statusCode = 404;
            res.end('not found');
        });
        const service = new RemoteTuiAgentService('http://in-memory.test', undefined, { fetchImpl });
        await service.sendMessage('hello', 's1', defaultSettings(), [], {
            onEvent: () => {},
        });

        expect(callCount).toBeGreaterThanOrEqual(2);
        expect(requestBodies[0]?.['message']).toBe('hello');
        expect(requestBodies[1]?.['streamId']).toBe('stream-reconnect');
        expect(requestBodies[1]?.['cursor']).toBe(1);
    });

    it('keeps request pending until question is answered', async () => {
        let resolved = false;
        let resolveCalled = false;

        const fetchImpl = createInMemoryFetch(async (req, res) => {
            const url = req.url ?? '/';
            if (req.method === 'POST' && url === '/session/s1/message/stream') {
                const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
                const resumed = typeof body['streamId'] === 'string';

                res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
                if (!resumed) {
                    res.write(`${JSON.stringify({
                        type: 'event',
                        streamId: 'stream-question',
                        seq: 1,
                        cursor: 1,
                        event: {
                            type: 'question.requested',
                            sessionId: 's1',
                            timestamp: Date.now(),
                            source: 'agent',
                            requestId: 'q1',
                            question: 'Pick one',
                            options: [{ label: 'A' }, { label: 'B' }],
                        },
                    })}\n`);
                    res.end();
                    return;
                }

                if (resolveCalled) {
                    res.write(`${JSON.stringify({
                        type: 'event',
                        streamId: 'stream-question',
                        seq: 2,
                        cursor: 2,
                        event: {
                            type: 'question.resolved',
                            sessionId: 's1',
                            timestamp: Date.now(),
                            source: 'agent',
                            requestId: 'q1',
                            selected: ['B'],
                            answerSource: 'ui',
                        },
                    })}\n`);
                    res.write(`${JSON.stringify({
                        type: 'done',
                        streamId: 'stream-question',
                        seq: 3,
                        cursor: 3,
                        sessionId: 's1',
                        response: 'ok',
                    })}\n`);
                    res.end();
                    return;
                }

                res.end();
                return;
            }

            if (req.method === 'POST' && url === '/session/s1/question/q1/resolve') {
                resolveCalled = true;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
                return;
            }

            res.statusCode = 404;
            res.end('not found');
        });
        const service = new RemoteTuiAgentService('http://in-memory.test', undefined, { fetchImpl });
        let releaseAnswer: ((value: { requestId: string; selected: string[] }) => void) | null = null;

        const sendPromise = service.sendMessage('hello', 's1', defaultSettings(), [], {
            onEvent: () => {},
            onQuestion: async (question) => new Promise<{ requestId: string; selected: string[] }>((resolve) => {
                releaseAnswer = (value) => resolve(value);
                expect(question.requestId).toBe('q1');
            }),
        }).then(() => {
            resolved = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(resolved).toBe(false);
        expect(releaseAnswer).toBeTruthy();

        if (!releaseAnswer) {
            throw new Error('expected question resolver');
        }
        const answerResolver: (value: { requestId: string; selected: string[] }) => void = releaseAnswer;
        answerResolver({ requestId: 'q1', selected: ['B'] });
        await sendPromise;
        expect(resolved).toBe(true);
    });

    it('fails gracefully after three reconnect attempts', async () => {
        const requestBodies: Array<Record<string, unknown>> = [];
        let callCount = 0;

        const fetchImpl: typeof fetch = async (_input, init) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            requestBodies.push(body);
            callCount += 1;

            if (callCount === 1) {
                return new Response(`${JSON.stringify({
                    type: 'event',
                    streamId: 'stream-fail',
                    seq: 1,
                    cursor: 1,
                    event: {
                        type: 'status.changed',
                        sessionId: 's1',
                        timestamp: Date.now(),
                        source: 'agent',
                        status: 'thinking',
                    },
                })}\n`, {
                    status: 200,
                    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
                });
            }

            throw new Error(`simulated reconnect drop #${callCount - 1}`);
        };

        const service = new RemoteTuiAgentService('http://in-memory.test', undefined, { fetchImpl });

        await expect(service.sendMessage('hello', 's1', defaultSettings(), [], {
            onEvent: () => {},
        })).rejects.toThrow('Remote stream reconnection failed after 3 attempts');

        expect(callCount).toBe(4);
        expect(requestBodies[0]?.['message']).toBe('hello');
        expect(requestBodies[1]).toMatchObject({ streamId: 'stream-fail', cursor: 1 });
        expect(requestBodies[2]).toMatchObject({ streamId: 'stream-fail', cursor: 1 });
        expect(requestBodies[3]).toMatchObject({ streamId: 'stream-fail', cursor: 1 });
    });
});
