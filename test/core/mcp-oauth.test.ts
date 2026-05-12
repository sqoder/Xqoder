import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { URL } from 'node:url';
import {
    buildAuthorizeUrl,
    createMcpAuthProvider,
    exchangeAuthCode,
    FileMcpTokenStore,
    generatePkcePair,
    generateState,
    oauthDisabled,
    refreshAccessToken,
    runMcpOauth,
    type StoredMcpToken,
} from '../../src/core/agent/mcp-oauth.js';
import type { MCPServerConfig, MCPServerOAuthConfig } from '@xqoder/shared';

type TokenHandler = (body: URLSearchParams) => Record<string, unknown> | { status: number; body?: Record<string, unknown> };

function startTokenServer(handler: TokenHandler): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            let buf = '';
            req.on('data', (chunk) => { buf += chunk.toString('utf-8'); });
            req.on('end', () => {
                const params = new URLSearchParams(buf);
                let result: ReturnType<TokenHandler>;
                try {
                    result = handler(params);
                } catch (error) {
                    res.statusCode = 500;
                    res.end(String(error));
                    return;
                }
                if (result && typeof (result as { status?: number }).status === 'number') {
                    const r = result as { status: number; body?: Record<string, unknown> };
                    res.statusCode = r.status;
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify(r.body ?? {}));
                    return;
                }
                res.statusCode = 200;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(result));
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xqoder-oauth-'));
    return path.join(dir, 'mcp-tokens.json');
}

describe('generatePkcePair / generateState', () => {
    it('produces verifier and challenge with correct lengths and SHA256 relationship', async () => {
        const { verifier, challenge } = generatePkcePair();
        expect(verifier.length).toBeGreaterThanOrEqual(43);
        expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
        const { createHash } = await import('node:crypto');
        const expected = createHash('sha256').update(verifier).digest('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        expect(challenge).toBe(expected);
    });

    it('generateState returns unique random strings', () => {
        const a = generateState();
        const b = generateState();
        expect(a).not.toBe(b);
        expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    });
});

describe('buildAuthorizeUrl', () => {
    it('includes all required OAuth 2.1 PKCE params', () => {
        const oauth: MCPServerOAuthConfig = {
            authorizationUrl: 'https://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            clientId: 'abc',
            scopes: ['read', 'write'],
            audience: 'api://xqoder',
        };
        const url = new URL(buildAuthorizeUrl(oauth, {
            redirectUri: 'http://127.0.0.1:14500/callback',
            state: 'STATE',
            codeChallenge: 'CHALL',
        }));
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('client_id')).toBe('abc');
        expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:14500/callback');
        expect(url.searchParams.get('state')).toBe('STATE');
        expect(url.searchParams.get('code_challenge')).toBe('CHALL');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('scope')).toBe('read write');
        expect(url.searchParams.get('audience')).toBe('api://xqoder');
    });
});

describe('FileMcpTokenStore', () => {
    let filePath: string;

    beforeEach(async () => {
        filePath = await makeTempStorePath();
    });

    afterEach(async () => {
        await fs.rm(path.dirname(filePath), { recursive: true, force: true });
    });

    it('returns undefined when file missing, then persists and reads back with 0600 perms', async () => {
        const store = new FileMcpTokenStore(filePath);
        expect(await store.load('alpha')).toBeUndefined();
        const token: StoredMcpToken = {
            accessToken: 'at', refreshToken: 'rt', tokenType: 'Bearer',
            expiresAt: 1_000_000, obtainedAt: 900_000,
        };
        await store.save('alpha', token);
        const loaded = await store.load('alpha');
        expect(loaded).toEqual(token);
        const stat = await fs.stat(filePath);
        const perm = stat.mode & 0o777;
        expect(perm).toBe(0o600);
    });

    it('remove deletes only the requested entry', async () => {
        const store = new FileMcpTokenStore(filePath);
        await store.save('a', { accessToken: 'A', obtainedAt: 1 });
        await store.save('b', { accessToken: 'B', obtainedAt: 2 });
        await store.remove('a');
        expect(await store.load('a')).toBeUndefined();
        expect((await store.load('b'))?.accessToken).toBe('B');
    });
});

describe('exchangeAuthCode / refreshAccessToken', () => {
    let tokenServer: Server;
    let port: number;
    let received: URLSearchParams | undefined;

    beforeEach(async () => {
        received = undefined;
        ({ server: tokenServer, port } = await startTokenServer((body) => {
            received = body;
            const grant = body.get('grant_type');
            if (grant === 'authorization_code') {
                return {
                    access_token: 'AT1',
                    refresh_token: 'RT1',
                    token_type: 'Bearer',
                    expires_in: 3600,
                    scope: 'read',
                };
            }
            if (grant === 'refresh_token') {
                return { access_token: 'AT2', token_type: 'Bearer', expires_in: 1800 };
            }
            return { status: 400, body: { error: 'unsupported_grant_type' } };
        }));
    });

    afterEach(async () => {
        await closeServer(tokenServer);
    });

    const oauth = (): MCPServerOAuthConfig => ({
        authorizationUrl: `http://127.0.0.1:${port}/authorize`,
        tokenUrl: `http://127.0.0.1:${port}/token`,
        clientId: 'cli',
    });

    it('exchangeAuthCode posts PKCE verifier and parses expiresAt from expires_in', async () => {
        const token = await exchangeAuthCode({
            oauth: oauth(),
            code: 'CODE',
            verifier: 'VERIFIER',
            redirectUri: 'http://127.0.0.1:14500/callback',
            now: () => 1_000_000,
        });
        expect(received?.get('grant_type')).toBe('authorization_code');
        expect(received?.get('code_verifier')).toBe('VERIFIER');
        expect(received?.get('code')).toBe('CODE');
        expect(received?.get('client_id')).toBe('cli');
        expect(token.accessToken).toBe('AT1');
        expect(token.refreshToken).toBe('RT1');
        expect(token.expiresAt).toBe(1_000_000 + 3600 * 1000);
    });

    it('refreshAccessToken posts refresh_token grant', async () => {
        const token = await refreshAccessToken(oauth(), 'RT1', () => 2_000_000);
        expect(received?.get('grant_type')).toBe('refresh_token');
        expect(received?.get('refresh_token')).toBe('RT1');
        expect(token.accessToken).toBe('AT2');
        expect(token.expiresAt).toBe(2_000_000 + 1800 * 1000);
    });

    it('throws when the token endpoint returns a non-2xx', async () => {
        await expect(exchangeAuthCode({
            oauth: { ...oauth(), clientId: 'bad-grant-marker' },
            code: 'x', verifier: 'y', redirectUri: 'z', now: () => 0,
        })).resolves.toBeDefined();

        // Now spin a new server that rejects
        await closeServer(tokenServer);
        ({ server: tokenServer, port } = await startTokenServer(() => ({ status: 401, body: { error: 'invalid_client' } })));
        await expect(exchangeAuthCode({
            oauth: oauth(), code: 'x', verifier: 'y',
            redirectUri: 'z', now: () => 0,
        })).rejects.toThrow(/401/);
    });
});

describe('createMcpAuthProvider', () => {
    let tokenServer: Server;
    let port: number;
    let filePath: string;

    beforeEach(async () => {
        filePath = await makeTempStorePath();
        ({ server: tokenServer, port } = await startTokenServer((body) => {
            if (body.get('grant_type') === 'refresh_token') {
                return { access_token: 'FRESH', token_type: 'Bearer', expires_in: 3600, refresh_token: 'RT2' };
            }
            return { status: 400 };
        }));
    });

    afterEach(async () => {
        await closeServer(tokenServer);
        await fs.rm(path.dirname(filePath), { recursive: true, force: true });
    });

    const server = (): MCPServerConfig => ({
        name: 'alpha',
        transport: 'http',
        url: 'http://example.test',
        oauth: {
            authorizationUrl: `http://127.0.0.1:${port}/authorize`,
            tokenUrl: `http://127.0.0.1:${port}/token`,
            clientId: 'cli',
        },
    } as MCPServerConfig);

    it('returns undefined for servers without oauth config', () => {
        const provider = createMcpAuthProvider({ name: 'noauth', transport: 'http', url: 'x' } as MCPServerConfig);
        expect(provider).toBeUndefined();
    });

    it('returns undefined when XQODER_MCP_DISABLE_OAUTH=1', () => {
        process.env.XQODER_MCP_DISABLE_OAUTH = '1';
        try {
            expect(createMcpAuthProvider(server())).toBeUndefined();
        } finally {
            delete process.env.XQODER_MCP_DISABLE_OAUTH;
        }
    });

    it('returns cached access token as Bearer header, no refresh when fresh', async () => {
        const store = new FileMcpTokenStore(filePath);
        await store.save('alpha', {
            accessToken: 'CACHED', refreshToken: 'RT1',
            tokenType: 'bearer', expiresAt: 10_000_000, obtainedAt: 9_000_000,
        });
        const provider = createMcpAuthProvider(server(), { store, now: () => 9_500_000 });
        expect(await provider?.getAuthHeader()).toBe('Bearer CACHED');
    });

    it('auto-refreshes when token is expired (within clock skew) and persists new refresh_token', async () => {
        const store = new FileMcpTokenStore(filePath);
        await store.save('alpha', {
            accessToken: 'OLD', refreshToken: 'RT1',
            tokenType: 'Bearer', expiresAt: 1_000_000, obtainedAt: 900_000,
        });
        const provider = createMcpAuthProvider(server(), { store, now: () => 1_000_000 });
        expect(await provider?.getAuthHeader()).toBe('Bearer FRESH');
        const reloaded = await store.load('alpha');
        expect(reloaded?.accessToken).toBe('FRESH');
        expect(reloaded?.refreshToken).toBe('RT2');
    });

    it('refresh() forces a refresh and returns the new header', async () => {
        const store = new FileMcpTokenStore(filePath);
        await store.save('alpha', {
            accessToken: 'OLD', refreshToken: 'RT1',
            tokenType: 'Bearer', expiresAt: 99_999_999_999, obtainedAt: 0,
        });
        const provider = createMcpAuthProvider(server(), { store, now: () => 0 });
        const refreshed = await provider?.refresh();
        expect(refreshed).toBe('Bearer FRESH');
    });
});

describe('runMcpOauth full flow', () => {
    let tokenServer: Server;
    let port: number;
    let filePath: string;

    beforeEach(async () => {
        filePath = await makeTempStorePath();
        ({ server: tokenServer, port } = await startTokenServer((body) => {
            if (body.get('grant_type') === 'authorization_code') {
                return { access_token: 'AT', refresh_token: 'RT', token_type: 'Bearer', expires_in: 3600 };
            }
            return { status: 400 };
        }));
    });

    afterEach(async () => {
        await closeServer(tokenServer);
        await fs.rm(path.dirname(filePath), { recursive: true, force: true });
    });

    const server = (): MCPServerConfig => ({
        name: 'alpha',
        transport: 'http',
        url: 'http://example.test',
        oauth: {
            authorizationUrl: `http://127.0.0.1:${port}/authorize`,
            tokenUrl: `http://127.0.0.1:${port}/token`,
            clientId: 'cli',
        },
    } as MCPServerConfig);

    it('completes the flow end-to-end and persists token', async () => {
        const store = new FileMcpTokenStore(filePath);
        const token = await runMcpOauth(server(), {
            store,
            callbackPorts: [0],
            openBrowser: async (authUrl) => {
                const url = new URL(authUrl);
                const redirect = url.searchParams.get('redirect_uri')!;
                const state = url.searchParams.get('state')!;
                const cb = new URL(redirect);
                cb.searchParams.set('code', 'CODE_OK');
                cb.searchParams.set('state', state);
                await fetch(cb.toString());
            },
            now: () => 1_000_000,
        });
        expect(token.accessToken).toBe('AT');
        const loaded = await store.load('alpha');
        expect(loaded?.accessToken).toBe('AT');
    });

    it('rejects callbacks with a mismatched state', async () => {
        const store = new FileMcpTokenStore(filePath);
        await expect(runMcpOauth(server(), {
            store,
            callbackPorts: [0],
            openBrowser: async (authUrl) => {
                const url = new URL(authUrl);
                const redirect = url.searchParams.get('redirect_uri')!;
                const cb = new URL(redirect);
                cb.searchParams.set('code', 'CODE');
                cb.searchParams.set('state', 'WRONG_STATE');
                await fetch(cb.toString());
            },
            now: () => 0,
            waitTimeoutMs: 2000,
        })).rejects.toThrow(/state mismatch/i);
    });

    it('falls back to a second port when the first is busy', async () => {
        const blocker = await new Promise<Server>((resolve) => {
            const s = createServer(() => { /* noop */ });
            s.listen(0, '127.0.0.1', () => resolve(s));
        });
        const busyPort = (blocker.address() as { port: number }).port;
        try {
            const store = new FileMcpTokenStore(filePath);
            const observed: string[] = [];
            await runMcpOauth(server(), {
                store,
                callbackPorts: [busyPort, 0],
                openBrowser: async (authUrl) => {
                    const url = new URL(authUrl);
                    observed.push(url.searchParams.get('redirect_uri')!);
                    const redirect = url.searchParams.get('redirect_uri')!;
                    const state = url.searchParams.get('state')!;
                    const cb = new URL(redirect);
                    cb.searchParams.set('code', 'CODE');
                    cb.searchParams.set('state', state);
                    await fetch(cb.toString());
                },
                now: () => 0,
            });
            expect(observed).toHaveLength(1);
            expect(observed[0]).not.toContain(`:${busyPort}/`);
        } finally {
            await closeServer(blocker);
        }
    });

    it('throws when OAuth disabled via env', async () => {
        process.env.XQODER_MCP_DISABLE_OAUTH = '1';
        try {
            await expect(runMcpOauth(server(), { callbackPorts: [0] })).rejects.toThrow(/disabled/);
        } finally {
            delete process.env.XQODER_MCP_DISABLE_OAUTH;
        }
    });
});

describe('oauthDisabled', () => {
    it('honors XQODER_MCP_DISABLE_OAUTH=1', () => {
        expect(oauthDisabled({ XQODER_MCP_DISABLE_OAUTH: '1' })).toBe(true);
        expect(oauthDisabled({})).toBe(false);
    });
});
