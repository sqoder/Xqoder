import { describe, expect, it } from 'bun:test';
import type { MCPServerConfig } from '@xqoder/shared';
import type { McpAuthProvider } from '../../src/core/agent/mcp-oauth.js';
import { McpSseClient } from '../../src/core/agent/mcp-sse-client.js';
import type { McpManagerOptions } from '../../src/core/agent/mcp-types.js';

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

describe('McpSseClient with McpAuthProvider', () => {
    it('refreshes on 401 and retries JSON-RPC requests', async () => {
        const encoder = new TextEncoder();
        const seenAuth: string[] = [];
        const server = Bun.serve({
            port: 0,
            async fetch(req) {
                let body: Record<string, unknown> = {};
                try { body = await req.json() as Record<string, unknown>; } catch { /* ignore */ }
                const auth = req.headers.get('authorization') ?? '';
                seenAuth.push(auth);
                if (auth !== 'Bearer FRESH') {
                    return new Response('', { status: 401 });
                }
                if (body.method === 'stream/open') {
                    const stream = new ReadableStream<Uint8Array>({
                        start(controller) {
                            // keep open; close after a short delay
                            setTimeout(() => { try { controller.close(); } catch { /* ignore */ } }, 50);
                        },
                    });
                    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
                }
                if (body.method === 'initialize') {
                    return Response.json({
                        jsonrpc: '2.0', id: body.id as number,
                        result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'sse', version: '1' } },
                    });
                }
                if (body.method === 'tools/list') {
                    return Response.json({ jsonrpc: '2.0', id: body.id as number, result: { tools: [{ name: 'ping' }] } });
                }
                if (typeof body.id === 'undefined') {
                    return new Response('', { status: 204 });
                }
                return Response.json({ jsonrpc: '2.0', id: body.id as number, error: { code: -32601, message: 'no' } });
            },
        });
        try {
            let refreshes = 0;
            const provider: McpAuthProvider = {
                async getAuthHeader() { return 'Bearer STALE'; },
                async refresh() { refreshes += 1; return 'Bearer FRESH'; },
            };
            const config: MCPServerConfig = {
                name: 'sse-auth', transport: 'sse',
                url: `http://127.0.0.1:${server.port}`, timeoutMs: 2000,
            } as MCPServerConfig;
            const client = new McpSseClient(config, {
                cwd: '/w', projectRoot: '/w',
                logger: createSilentLogger(), authProvider: provider,
            });
            const tools = await client.listTools();
            expect(tools.map((t) => t.name)).toEqual(['ping']);
            expect(refreshes).toBeGreaterThanOrEqual(1);
            expect(seenAuth[0]).toBe('Bearer STALE');
            expect(seenAuth.some((h) => h === 'Bearer FRESH')).toBe(true);
            void encoder; // silence unused
            await client.close();
        } finally {
            server.stop(true);
        }
    });
});
