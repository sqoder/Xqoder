import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { URL } from 'node:url';
import type { MCPServerConfig } from '@xqoder/shared';
import { McpAuthTool } from '../../../src/core/agent/tools/mcp-auth-tool.js';
import { FileMcpTokenStore } from '../../../src/core/agent/mcp-oauth.js';

function startTokenServer(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            let buf = '';
            req.on('data', (chunk) => { buf += chunk.toString('utf-8'); });
            req.on('end', () => {
                const params = new URLSearchParams(buf);
                if (params.get('grant_type') === 'authorization_code') {
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', token_type: 'Bearer', expires_in: 3600 }));
                    return;
                }
                res.statusCode = 400;
                res.end('{}');
            });
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') {
                resolve({ server, port: addr.port });
            } else {
                reject(new Error('no address'));
            }
        });
    });
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

async function makeTempStorePath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xqoder-mcpauthtool-'));
    return path.join(dir, 'mcp-tokens.json');
}

describe('McpAuthTool', () => {
    let tokenServer: Server;
    let port: number;
    let filePath: string;

    beforeEach(async () => {
        filePath = await makeTempStorePath();
        ({ server: tokenServer, port } = await startTokenServer());
    });

    afterEach(async () => {
        await closeServer(tokenServer);
        await fs.rm(path.dirname(filePath), { recursive: true, force: true });
    });

    const makeServer = (): MCPServerConfig => ({
        name: 'alpha',
        transport: 'http',
        url: 'http://example.test',
        oauth: {
            authorizationUrl: `http://127.0.0.1:${port}/authorize`,
            tokenUrl: `http://127.0.0.1:${port}/token`,
            clientId: 'cli',
        },
    } as MCPServerConfig);

    it('fails when server is unknown', async () => {
        const tool = new McpAuthTool({ servers: [] });
        const result = await tool.execute({ server: 'ghost' }, { cwd: '/w', projectRoot: '/w' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unknown MCP server/);
    });

    it('fails when server has no oauth config', async () => {
        const tool = new McpAuthTool({
            servers: [{ name: 'bare', transport: 'http', url: 'http://x' } as MCPServerConfig],
        });
        const result = await tool.execute({ server: 'bare' }, { cwd: '/w', projectRoot: '/w' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/no oauth configuration/);
    });

    it('returns disabled error when XQODER_MCP_DISABLE_OAUTH=1', async () => {
        const tool = new McpAuthTool({
            servers: [makeServer()],
            env: { XQODER_MCP_DISABLE_OAUTH: '1' } as NodeJS.ProcessEnv,
        });
        const result = await tool.execute({ server: 'alpha' }, { cwd: '/w', projectRoot: '/w' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/disabled/);
    });

    it('short-circuits when an existing token is valid and force is not set', async () => {
        const store = new FileMcpTokenStore(filePath);
        await store.save('alpha', {
            accessToken: 'CACHED', refreshToken: 'RT', tokenType: 'Bearer',
            expiresAt: Date.now() + 60 * 60 * 1000, obtainedAt: Date.now(),
        });
        const tool = new McpAuthTool({
            servers: [makeServer()],
            store,
            openBrowser: () => { throw new Error('should not be invoked'); },
            callbackPorts: [0],
        });
        const result = await tool.execute({ server: 'alpha' }, { cwd: '/w', projectRoot: '/w' });
        expect(result.success).toBe(true);
        expect(result.metadata?.refreshed).toBe(false);
    });

    it('runs the full OAuth flow when no token is cached', async () => {
        const store = new FileMcpTokenStore(filePath);
        const tool = new McpAuthTool({
            servers: [makeServer()],
            store,
            callbackPorts: [0],
            openBrowser: async (authUrl) => {
                const url = new URL(authUrl);
                const redirect = url.searchParams.get('redirect_uri')!;
                const state = url.searchParams.get('state')!;
                const cb = new URL(redirect);
                cb.searchParams.set('code', 'CODE');
                cb.searchParams.set('state', state);
                await fetch(cb.toString());
            },
            now: () => 1_000_000,
        });
        const result = await tool.execute({ server: 'alpha' }, { cwd: '/w', projectRoot: '/w' });
        expect(result.success).toBe(true);
        expect(result.metadata?.refreshed).toBe(true);
        expect(result.metadata?.hasRefreshToken).toBe(true);
        const loaded = await store.load('alpha');
        expect(loaded?.accessToken).toBe('AT');
    });
});
