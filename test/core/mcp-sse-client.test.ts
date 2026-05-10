import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { MCPServerConfig } from '@xqoder/shared';
import { McpSseClient } from '../../src/core/agent/mcp-sse-client.js';
import type { ElicitationAsk, ElicitationRequest } from '../../src/core/agent/mcp-elicitation.js';
import type { McpManagerOptions } from '../../src/core/agent/mcp-types.js';

type StreamHandles = {
    push: (payload: unknown) => void;
    close: () => void;
    controller?: ReadableStreamDefaultController<Uint8Array>;
};

type TestContext = {
    port: number;
    server: ReturnType<typeof Bun.serve>;
    mode: { responseKind: 'json' | 'sse' };
    stream: StreamHandles;
    capturedResponses: Array<Record<string, unknown>>;
    tools: Array<{ name: string; description?: string }>;
};

function startMockServer(): TestContext {
    const encoder = new TextEncoder();
    const stream: StreamHandles = {
        push: () => { /* no-op until stream opens */ },
        close: () => { /* no-op until stream opens */ },
    };
    const mode: TestContext['mode'] = { responseKind: 'json' };
    const capturedResponses: TestContext['capturedResponses'] = [];
    const tools = [{ name: 'echo', description: 'Echo back args' }];

    const respondSseFrame = (payload: Record<string, unknown>): Response => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                controller.close();
            },
        });
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    };

    const respondJson = (payload: Record<string, unknown>): Response =>
        new Response(JSON.stringify(payload), {
            headers: { 'content-type': 'application/json' },
        });

    const respondByMode = (payload: Record<string, unknown>): Response =>
        mode.responseKind === 'sse' ? respondSseFrame(payload) : respondJson(payload);

    const server = Bun.serve({
        port: 0,
        async fetch(req) {
            let body: Record<string, unknown> = {};
            try {
                body = (await req.json()) as Record<string, unknown>;
            } catch {
                return new Response('', { status: 400 });
            }

            if (body.method === 'stream/open') {
                const streamBody = new ReadableStream<Uint8Array>({
                    start(controller) {
                        stream.controller = controller;
                        stream.push = (payload) => {
                            try {
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                            } catch { /* stream closed */ }
                        };
                        stream.close = () => {
                            try { controller.close(); } catch { /* already closed */ }
                        };
                    },
                });
                return new Response(streamBody, { headers: { 'content-type': 'text/event-stream' } });
            }

            if (body.method === 'initialize') {
                return respondByMode({
                    jsonrpc: '2.0',
                    id: body.id as number,
                    result: {
                        protocolVersion: '2025-11-25',
                        capabilities: { tools: {}, prompts: {}, resources: {} },
                        serverInfo: { name: 'mock-sse', version: '0.1.0' },
                    },
                });
            }

            if (body.method === 'tools/list') {
                return respondByMode({
                    jsonrpc: '2.0',
                    id: body.id as number,
                    result: { tools },
                });
            }

            if (body.method === 'tools/call') {
                const params = body.params as { name: string; arguments: Record<string, unknown> };
                return respondByMode({
                    jsonrpc: '2.0',
                    id: body.id as number,
                    result: {
                        content: [{ type: 'text', text: `echo:${JSON.stringify(params.arguments)}` }],
                    },
                });
            }

            if (typeof body.method !== 'string') {
                capturedResponses.push(body);
                return new Response('', { status: 204 });
            }

            // Notifications (no id) or unknown methods: 204.
            if (typeof body.id === 'undefined') {
                return new Response('', { status: 204 });
            }

            return respondByMode({
                jsonrpc: '2.0',
                id: body.id as number,
                error: { code: -32601, message: `method not found: ${String(body.method)}` },
            });
        },
    });

    return {
        port: server.port,
        server,
        mode,
        stream,
        capturedResponses,
        tools,
    };
}

function waitFor<T>(check: () => T | undefined, timeoutMs = 1000): Promise<T> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            const value = check();
            if (value !== undefined && value !== null) {
                resolve(value);
                return;
            }
            if (Date.now() - start > timeoutMs) {
                reject(new Error('waitFor timeout'));
                return;
            }
            setTimeout(tick, 10);
        };
        tick();
    });
}

function makeConfig(port: number): MCPServerConfig {
    return {
        name: 'sse-mock',
        transport: 'sse',
        url: `http://127.0.0.1:${port}`,
        timeoutMs: 2000,
    } as MCPServerConfig;
}

function makeClient(
    port: number,
    opts: { elicit?: ElicitationAsk } = {},
): McpSseClient {
    const options: Omit<McpManagerOptions, 'servers'> = {
        cwd: '/workspace',
        projectRoot: '/workspace',
        logger: createSilentLogger(),
        ...(opts.elicit ? { elicit: opts.elicit } : {}),
    };
    return new McpSseClient(makeConfig(port), options);
}

function createSilentLogger(): NonNullable<McpManagerOptions['logger']> {
    const silent: NonNullable<McpManagerOptions['logger']> = {
        child: () => silent,
        info: () => {},
        warn: () => {},
        debug: () => {},
        error: () => {},
    };
    return silent;
}

describe('McpSseClient', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = startMockServer();
    });

    afterEach(async () => {
        ctx.stream.close();
        ctx.server.stop(true);
    });

    it('completes initialize handshake and reflects server capabilities', async () => {
        const client = makeClient(ctx.port);
        const tools = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(['echo']);
        expect(client.protocolVersion).toBe('2025-11-25');
        expect(client.serverInfo?.name).toBe('mock-sse');
        expect(client.supportsPrompts()).toBe(true);
        expect(client.supportsResources()).toBe(true);
        await client.close();
    });

    it('roundtrips callTool and returns structured content', async () => {
        const client = makeClient(ctx.port);
        const result = await client.callTool('echo', { msg: 'hi' });
        expect(result.content).toEqual([
            { type: 'text', text: 'echo:{"msg":"hi"}' },
        ]);
        await client.close();
    });

    it('handles per-request responses delivered as application/json', async () => {
        ctx.mode.responseKind = 'json';
        const client = makeClient(ctx.port);
        const tools = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(['echo']);
        await client.close();
    });

    it('handles per-request responses delivered as a single event-stream frame', async () => {
        ctx.mode.responseKind = 'sse';
        const client = makeClient(ctx.port);
        const tools = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(['echo']);
        await client.close();
    });

    it('auto-replies to server-initiated ping without crashing', async () => {
        const client = makeClient(ctx.port);
        await client.listTools();
        // Wait for long-lived stream to be open.
        await waitFor(() => ctx.stream.controller ? true : undefined);
        ctx.stream.push({ jsonrpc: '2.0', id: 100, method: 'ping', params: {} });
        const pingResponse = await waitFor(() =>
            ctx.capturedResponses.find((m) => m.id === 100),
        );
        expect(pingResponse).toMatchObject({ jsonrpc: '2.0', id: 100, result: {} });
        // Client is still usable.
        const toolsAgain = await client.listTools(true);
        expect(toolsAgain.map((t) => t.name)).toEqual(['echo']);
        await client.close();
    });

    it('forwards server-initiated elicitation/create to the injected callback', async () => {
        const received: ElicitationRequest[] = [];
        const elicit: ElicitationAsk = async (req) => {
            received.push(req);
            return { action: 'accept', data: { username: 'alice' } };
        };
        const client = makeClient(ctx.port, { elicit });
        await client.listTools();
        await waitFor(() => ctx.stream.controller ? true : undefined);
        const request = {
            jsonrpc: '2.0',
            id: 200,
            method: 'elicitation/create',
            params: {
                title: 'Sign in',
                schema: { fields: [{ key: 'username', type: 'string', required: true }] },
            },
        };
        ctx.stream.push(request);
        const elicitationResponse = await waitFor(() =>
            ctx.capturedResponses.find((m) => m.id === 200),
        );
        expect(received).toHaveLength(1);
        expect(received[0]?.title).toBe('Sign in');
        expect(elicitationResponse).toMatchObject({
            jsonrpc: '2.0',
            id: 200,
            result: { action: 'accept', data: { username: 'alice' } },
        });
        await client.close();
    });

    it('returns elicitation cancel when no elicit callback is configured', async () => {
        const client = makeClient(ctx.port);
        await client.listTools();
        await waitFor(() => ctx.stream.controller ? true : undefined);
        ctx.stream.push({
            jsonrpc: '2.0',
            id: 300,
            method: 'elicitation/create',
            params: { schema: { fields: [] } },
        });
        const resp = await waitFor(() =>
            ctx.capturedResponses.find((m) => m.id === 300),
        );
        expect(resp).toMatchObject({
            jsonrpc: '2.0',
            id: 300,
            result: { action: 'cancel' },
        });
        await client.close();
    });

    it('rejects subsequent requests after close()', async () => {
        const client = makeClient(ctx.port);
        await client.listTools();
        await client.close();
        await expect(client.listTools(true)).rejects.toThrow(/closed/i);
    });
});
