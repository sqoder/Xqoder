import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { URL } from 'node:url';
import type { Logger, MCPServerConfig, MCPServerOAuthConfig } from '@xqoder/shared';
import { getXQoderPaths } from '@xqoder/shared';

export interface StoredMcpToken {
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    expiresAt?: number;
    scope?: string;
    obtainedAt: number;
}

export interface McpTokenStore {
    load(serverName: string): Promise<StoredMcpToken | undefined>;
    save(serverName: string, token: StoredMcpToken): Promise<void>;
    remove(serverName: string): Promise<void>;
}

export interface RunMcpOauthOptions {
    openBrowser?: (url: string) => void | Promise<void>;
    callbackPorts?: number[];
    store?: McpTokenStore;
    logger?: Logger;
    now?: () => number;
    waitTimeoutMs?: number;
}

export interface McpAuthProvider {
    getAuthHeader(): Promise<string | undefined>;
    refresh(): Promise<string | undefined>;
}

const DEFAULT_CALLBACK_PORTS = [14500, 14501, 14502];
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

export function generatePkcePair(): { verifier: string; challenge: string } {
    const verifier = base64UrlEncode(randomBytes(48));
    const hash = createHash('sha256').update(verifier).digest();
    const challenge = base64UrlEncode(hash);
    return { verifier, challenge };
}

export function generateState(): string {
    return base64UrlEncode(randomBytes(24));
}

export function buildAuthorizeUrl(
    oauth: MCPServerOAuthConfig,
    params: { redirectUri: string; state: string; codeChallenge: string },
): string {
    const url = new URL(oauth.authorizationUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', oauth.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (oauth.scopes && oauth.scopes.length > 0) {
        url.searchParams.set('scope', oauth.scopes.join(' '));
    }
    if (oauth.audience) {
        url.searchParams.set('audience', oauth.audience);
    }
    return url.toString();
}

export class FileMcpTokenStore implements McpTokenStore {
    private readonly filePath: string;

    constructor(filePath: string = defaultTokenStorePath()) {
        this.filePath = filePath;
    }

    async load(serverName: string): Promise<StoredMcpToken | undefined> {
        const all = await this.readAll();
        return all[serverName];
    }

    async save(serverName: string, token: StoredMcpToken): Promise<void> {
        const all = await this.readAll();
        all[serverName] = token;
        await this.writeAll(all);
    }

    async remove(serverName: string): Promise<void> {
        const all = await this.readAll();
        if (serverName in all) {
            delete all[serverName];
            await this.writeAll(all);
        }
    }

    private async readAll(): Promise<Record<string, StoredMcpToken>> {
        try {
            const raw = await fs.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, StoredMcpToken>;
            }
            return {};
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return {};
            }
            throw error;
        }
    }

    private async writeAll(all: Record<string, StoredMcpToken>): Promise<void> {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp-${process.pid}`;
        await fs.writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
        await fs.chmod(tmp, 0o600).catch((): undefined => undefined);
        await fs.rename(tmp, this.filePath);
        await fs.chmod(this.filePath, 0o600).catch((): undefined => undefined);
    }
}

function defaultTokenStorePath(): string {
    const paths = getXQoderPaths(os.homedir());
    return path.join(paths.dataDir, 'mcp-tokens.json');
}

export function oauthDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.XQODER_MCP_DISABLE_OAUTH === '1';
}

export async function runMcpOauth(
    server: MCPServerConfig,
    options: RunMcpOauthOptions = {},
): Promise<StoredMcpToken> {
    if (oauthDisabled()) {
        throw new Error('MCP OAuth is disabled via XQODER_MCP_DISABLE_OAUTH=1');
    }
    const oauth = requireOauthConfig(server);
    const store = options.store ?? new FileMcpTokenStore();
    const now = options.now ?? Date.now;

    const { verifier, challenge } = generatePkcePair();
    const state = generateState();

    const { port, server: httpServer, codePromise } = await startCallbackListener({
        expectedState: state,
        ports: options.callbackPorts ?? DEFAULT_CALLBACK_PORTS,
        timeoutMs: options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
    });

    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const authorizeUrl = buildAuthorizeUrl(oauth, {
        redirectUri,
        state,
        codeChallenge: challenge,
    });

    try {
        if (options.openBrowser) {
            await options.openBrowser(authorizeUrl);
        }
        const code = await codePromise;
        const token = await exchangeAuthCode({
            oauth,
            code,
            verifier,
            redirectUri,
            now,
        });
        await store.save(server.name, token);
        return token;
    } finally {
        await closeServer(httpServer);
    }
}

function requireOauthConfig(server: MCPServerConfig): MCPServerOAuthConfig {
    if (!server.oauth) {
        throw new Error(`MCP server ${server.name} has no oauth config`);
    }
    return server.oauth;
}

interface StartListenerArgs {
    expectedState: string;
    ports: number[];
    timeoutMs: number;
}

interface StartListenerResult {
    port: number;
    server: Server;
    codePromise: Promise<string>;
}

async function startCallbackListener(args: StartListenerArgs): Promise<StartListenerResult> {
    const { expectedState, ports, timeoutMs } = args;

    let resolveCode!: (value: string) => void;
    let rejectCode!: (error: Error) => void;
    const codePromise = new Promise<string>((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });

    const handler = (req: IncomingMessage, res: ServerResponse): void => {
        if (!req.url) {
            res.statusCode = 400;
            res.end('Bad Request');
            return;
        }
        const parsed = new URL(req.url, 'http://127.0.0.1');
        if (parsed.pathname !== '/callback') {
            res.statusCode = 404;
            res.end('Not Found');
            return;
        }
        const code = parsed.searchParams.get('code');
        const state = parsed.searchParams.get('state');
        const errorParam = parsed.searchParams.get('error');
        if (errorParam) {
            res.statusCode = 400;
            res.end(`Authorization failed: ${errorParam}`);
            rejectCode(new Error(`Authorization failed: ${errorParam}`));
            return;
        }
        if (!code || !state) {
            res.statusCode = 400;
            res.end('Missing code or state');
            rejectCode(new Error('OAuth callback missing code or state'));
            return;
        }
        if (state !== expectedState) {
            res.statusCode = 400;
            res.end('State mismatch');
            rejectCode(new Error('OAuth state mismatch'));
            return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end('<html><body><h1>Authorization complete</h1><p>You can close this window.</p></body></html>');
        resolveCode(code);
    };

    const { server, port } = await listenOnFirstAvailablePort(ports, handler);

    const timer = setTimeout(() => {
        rejectCode(new Error('OAuth callback timeout'));
    }, timeoutMs);
    codePromise.finally(() => clearTimeout(timer)).catch((): undefined => undefined);

    return { port, server, codePromise };
}

async function listenOnFirstAvailablePort(
    ports: number[],
    handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
    const errors: string[] = [];
    for (const port of ports) {
        try {
            const server = await listenOnPort(port, handler);
            const address = server.address();
            const actualPort = address && typeof address === 'object' ? address.port : port;
            return { server, port: actualPort };
        } catch (error) {
            errors.push(`port ${port}: ${(error as Error).message}`);
        }
    }
    throw new Error(`All OAuth callback ports unavailable (${errors.join('; ')})`);
}

function listenOnPort(
    port: number,
    handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = createServer(handler);
        const onError = (error: Error): void => {
            server.removeListener('listening', onListening);
            reject(error);
        };
        const onListening = (): void => {
            server.removeListener('error', onError);
            resolve(server);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
    });
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve) => {
        server.close(() => resolve());
    });
}

interface ExchangeArgs {
    oauth: MCPServerOAuthConfig;
    code: string;
    verifier: string;
    redirectUri: string;
    now: () => number;
}

export async function exchangeAuthCode(args: ExchangeArgs): Promise<StoredMcpToken> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: args.code,
        client_id: args.oauth.clientId,
        code_verifier: args.verifier,
        redirect_uri: args.redirectUri,
    });
    return performTokenRequest(args.oauth, body, args.now());
}

export async function refreshAccessToken(
    oauth: MCPServerOAuthConfig,
    refreshToken: string,
    now: () => number = Date.now,
): Promise<StoredMcpToken> {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: oauth.clientId,
    });
    return performTokenRequest(oauth, body, now());
}

async function performTokenRequest(
    oauth: MCPServerOAuthConfig,
    body: URLSearchParams,
    obtainedAt: number,
): Promise<StoredMcpToken> {
    if (oauth.clientSecret) {
        body.set('client_secret', oauth.clientSecret);
    }
    const response = await fetch(oauth.tokenUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
        },
        body: body.toString(),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Token endpoint HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const raw = (await response.json()) as Record<string, unknown>;
    const accessToken = typeof raw.access_token === 'string' ? raw.access_token : '';
    if (!accessToken) {
        throw new Error('Token response missing access_token');
    }
    const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : undefined;
    return {
        accessToken,
        ...(typeof raw.refresh_token === 'string' ? { refreshToken: raw.refresh_token } : {}),
        ...(typeof raw.token_type === 'string' ? { tokenType: raw.token_type } : {}),
        ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
        ...(expiresIn !== undefined ? { expiresAt: obtainedAt + expiresIn * 1000 } : {}),
        obtainedAt,
    };
}

function base64UrlEncode(buf: Buffer): string {
    return buf
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Build an auth provider for an MCP server. Returns undefined for servers without
 * oauth config or when OAuth is globally disabled.
 */
export function createMcpAuthProvider(
    server: MCPServerConfig,
    options: {
        store?: McpTokenStore;
        now?: () => number;
        clockSkewMs?: number;
        logger?: Logger;
    } = {},
): McpAuthProvider | undefined {
    if (!server.oauth || oauthDisabled()) {
        return undefined;
    }
    const oauth = server.oauth;
    const store = options.store ?? new FileMcpTokenStore();
    const now = options.now ?? Date.now;
    const skewMs = options.clockSkewMs ?? 30_000;

    let cached: StoredMcpToken | undefined;
    let loadedFromStore = false;

    const ensureLoaded = async (): Promise<StoredMcpToken | undefined> => {
        if (!loadedFromStore) {
            loadedFromStore = true;
            cached = await store.load(server.name);
        }
        return cached;
    };

    const persist = async (token: StoredMcpToken): Promise<void> => {
        cached = token;
        await store.save(server.name, token);
    };

    const isExpired = (token: StoredMcpToken): boolean => {
        if (typeof token.expiresAt !== 'number') {
            return false;
        }
        return now() >= token.expiresAt - skewMs;
    };

    const toHeader = (token: StoredMcpToken): string => {
        const type = token.tokenType && token.tokenType.length > 0 ? token.tokenType : 'Bearer';
        const normalized = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
        return `${normalized} ${token.accessToken}`;
    };

    const tryRefresh = async (token: StoredMcpToken | undefined): Promise<StoredMcpToken | undefined> => {
        if (!token?.refreshToken) {
            return undefined;
        }
        try {
            const next = await refreshAccessToken(oauth, token.refreshToken, now);
            const merged: StoredMcpToken = {
                ...next,
                refreshToken: next.refreshToken ?? token.refreshToken,
            };
            await persist(merged);
            return merged;
        } catch (error) {
            options.logger?.warn(`MCP OAuth refresh failed for ${server.name}: ${(error as Error).message}`);
            return undefined;
        }
    };

    return {
        async getAuthHeader(): Promise<string | undefined> {
            let token = await ensureLoaded();
            if (token && isExpired(token)) {
                token = await tryRefresh(token) ?? token;
            }
            return token ? toHeader(token) : undefined;
        },
        async refresh(): Promise<string | undefined> {
            const token = await ensureLoaded();
            const next = await tryRefresh(token);
            return next ? toHeader(next) : undefined;
        },
    };
}
