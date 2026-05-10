import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { MCPServerConfig } from '@xqoder/shared';
import type { McpAuthProvider } from '../../src/core/agent/mcp-oauth.js';
import { McpHttpClient } from '../../src/core/agent/mcp-http-client.js';
import type { McpManagerOptions } from '../../src/core/agent/mcp-types.js';

type Handler = (body: Record<string, unknown>, headers: Headers) => Response;

function startServer(handler: Handler): ReturnType<typeof Bun.serve> {
    return Bun.serve({
        port: 0,
        async fetch(req) {
            let body: Record<string, unknown> = {};
            try { body = await req.json() as Record<string, unknown>; } catch { /* ignore */ }
            return handler(body, req.headers);
        },
    });
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

describe('McpHttpClient with McpAuthProvider', () => {
    it('attaches Authorization header and does not call refresh when request succeeds', async () => {
        const authHeaders: (string | null)[] = [];
        const server = startServer((body, headers) => {
            authHeaders.push(headers.get('authorization'));
            if (body.method === 'initialize') {
                return Response.json({
                    jsonrpc: '2.0', id: body.id as number,
                    result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'x', version: '1' } },
                });
            }
            if (body.method === 'tools/list') {
                return Response.json({ jsonrpc: '2.0', id: body.id as number, result: { tools: [] } });
            }
            return new Response('', { status: 204 });
        });
        try {
            let refreshCount = 0;
            const provider: McpAuthProvider = {
                async getAuthHeader() { return 'Bearer ACCESS1'; },
                async refresh() { refreshCount += 1; return 'Bearer FRESH'; },
            };
            const config: MCPServerConfig = {
                name: 'auth-http', transport: 'http',
                url: `http://127.0.0.1:${server.port}`, timeoutMs: 2000,
            } as MCPServerConfig;
            const client = new McpHttpClient(config, {
                cwd: '/w', projectRoot: '/w',
                logger: createSilentLogger(), authProvider: provider,
            });
            await client.listTools();
            expect(refreshCount).toBe(0);
            expect(authHeaders.every((h) => h === 'Bearer ACCESS1')).toBe(true);
        } finally {
            server.stop(true);
        }
    });

    it('refreshes once on 401 and retries the same request', async () => {
        const seenAuth: string[] = [];
        const server = startServer((body, headers) => {
            const auth = headers.get('authorization') ?? '';
            seenAuth.push(auth);
            if (auth !== 'Bearer FRESH') {
                return new Response('', { status: 401 });
            }
            if (body.method === 'initialize') {
                return Response.json({
                    jsonrpc: '2.0', id: body.id as number,
                    result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'x', version: '1' } },
                });
            }
            if (body.method === 'tools/list') {
                return Response.json({ jsonrpc: '2.0', id: body.id as number, result: { tools: [{ name: 'echo' }] } });
            }
            return new Response('', { status: 204 });
        });
        try {
            let refreshCalls = 0;
            const provider: McpAuthProvider = {
                async getAuthHeader() { return 'Bearer STALE'; },
                async refresh() { refreshCalls += 1; return 'Bearer FRESH'; },
            };
            const config: MCPServerConfig = {
                name: 'auth-http', transport: 'http',
                url: `http://127.0.0.1:${server.port}`, timeoutMs: 2000,
            } as MCPServerConfig;
            const client = new McpHttpClient(config, {
                cwd: '/w', projectRoot: '/w',
                logger: createSilentLogger(), authProvider: provider,
            });
            const tools = await client.listTools();
            expect(tools.map((t) => t.name)).toEqual(['echo']);
            expect(refreshCalls).toBeGreaterThanOrEqual(1);
            expect(seenAuth[0]).toBe('Bearer STALE');
            expect(seenAuth.some((h) => h === 'Bearer FRESH')).toBe(true);
        } finally {
            server.stop(true);
        }
    });

    it('surfaces a non-401 HTTP error without triggering refresh', async () => {
        let refreshCalls = 0;
        const server = startServer(() => new Response('nope', { status: 503 }));
        try {
            const provider: McpAuthProvider = {
                async getAuthHeader() { return 'Bearer X'; },
                async refresh() { refreshCalls += 1; return undefined; },
            };
            const config: MCPServerConfig = {
                name: 'auth-http', transport: 'http',
                url: `http://127.0.0.1:${server.port}`, timeoutMs: 2000,
            } as MCPServerConfig;
            const client = new McpHttpClient(config, {
                cwd: '/w', projectRoot: '/w',
                logger: createSilentLogger(), authProvider: provider,
            });
            await expect(client.listTools()).rejects.toThrow(/HTTP 503/);
            expect(refreshCalls).toBe(0);
        } finally {
            server.stop(true);
        }
    });

    it('works without authProvider (regression: no header injected)', async () => {
        const observed: (string | null)[] = [];
        const server = startServer((body, headers) => {
            observed.push(headers.get('authorization'));
            if (body.method === 'initialize') {
                return Response.json({
                    jsonrpc: '2.0', id: body.id as number,
                    result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'x', version: '1' } },
                });
            }
            if (body.method === 'tools/list') {
                return Response.json({ jsonrpc: '2.0', id: body.id as number, result: { tools: [] } });
            }
            return new Response('', { status: 204 });
        });
        try {
            const config: MCPServerConfig = {
                name: 'noauth', transport: 'http',
                url: `http://127.0.0.1:${server.port}`, timeoutMs: 2000,
            } as MCPServerConfig;
            const client = new McpHttpClient(config, {
                cwd: '/w', projectRoot: '/w', logger: createSilentLogger(),
            });
            await client.listTools();
            expect(observed.every((h) => h === null)).toBe(true);
        } finally {
            server.stop(true);
        }
    });
});
