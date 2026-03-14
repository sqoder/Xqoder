import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { RemoteTuiAgentService, type TuiAgentSettings } from './agent-service.js';

async function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

async function listen(server: http.Server): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Unexpected server address');
    }
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
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
    const cleanup: Array<() => Promise<void>> = [];

    afterEach(async () => {
        while (cleanup.length > 0) {
            const fn = cleanup.pop();
            if (fn) await fn();
        }
    });

    it('reconnects with streamId/cursor after network drop', async () => {
        const requestBodies: Array<Record<string, unknown>> = [];
        let callCount = 0;

        const server = http.createServer(async (req, res) => {
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

        const { baseUrl, close } = await listen(server);
        cleanup.push(close);

        const service = new RemoteTuiAgentService(baseUrl);
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

        const server = http.createServer(async (req, res) => {
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

        const { baseUrl, close } = await listen(server);
        cleanup.push(close);

        const service = new RemoteTuiAgentService(baseUrl);
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
});
