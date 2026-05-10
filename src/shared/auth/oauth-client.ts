// P21a — PKCE OAuth 2.0 helpers (provider-agnostic).
//
// Pure functions that assemble authorize URLs, generate PKCE challenges,
// and exchange codes for tokens. All network I/O is injected via the
// `fetch` dependency so tests can drive it with a mock.

import * as crypto from 'node:crypto';
import type { OAuthTokens } from './types.js';

export interface PkceChallenge {
    readonly verifier: string;
    readonly challenge: string;
    readonly method: 'S256';
}

export function generatePkceChallenge(verifier: string = randomVerifier()): PkceChallenge {
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge, method: 'S256' };
}

export function randomVerifier(): string {
    // 32 random bytes → base64url (43 chars), meets RFC 7636 43–128 length.
    return crypto.randomBytes(32).toString('base64url');
}

export interface AuthorizeUrlParams {
    readonly authorizationEndpoint: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly scope: string;
    readonly state: string;
    readonly codeChallenge: string;
    readonly extraParams?: Record<string, string>;
}

export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
    const url = new URL(params.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', params.scope);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (params.extraParams) {
        for (const [key, value] of Object.entries(params.extraParams)) {
            url.searchParams.set(key, value);
        }
    }
    return url.toString();
}

export interface ExchangeCodeParams {
    readonly tokenEndpoint: string;
    readonly clientId: string;
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly extraBody?: Record<string, string>;
}

export async function exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: params.clientId,
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
        ...(params.extraBody ?? {}),
    });
    return postTokenRequest(params.tokenEndpoint, body, params.fetch);
}

export interface RefreshTokenParams {
    readonly tokenEndpoint: string;
    readonly clientId: string;
    readonly refreshToken: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly extraBody?: Record<string, string>;
}

export async function refreshAccessToken(params: RefreshTokenParams): Promise<OAuthTokens> {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: params.clientId,
        refresh_token: params.refreshToken,
        ...(params.extraBody ?? {}),
    });
    return postTokenRequest(params.tokenEndpoint, body, params.fetch);
}

async function postTokenRequest(
    endpoint: string,
    body: URLSearchParams,
    fetchImpl?: typeof globalThis.fetch,
): Promise<OAuthTokens> {
    const doFetch = fetchImpl ?? globalThis.fetch;
    const response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'accept': 'application/json',
        },
        body: body.toString(),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`token endpoint ${response.status}: ${text || response.statusText}`);
    }
    const payload = safeParseJson(text);
    return parseTokenResponse(payload, Date.now());
}

export function parseTokenResponse(
    payload: unknown,
    now: number,
    previousRefreshToken?: string,
): OAuthTokens {
    if (!payload || typeof payload !== 'object') {
        throw new Error('token response is not a JSON object');
    }
    const record = payload as Record<string, unknown>;
    const accessToken = typeof record['access_token'] === 'string' ? record['access_token'] : undefined;
    if (!accessToken) {
        throw new Error('token response missing access_token');
    }
    const refreshFromResponse = typeof record['refresh_token'] === 'string' ? record['refresh_token'] : undefined;
    // OAuth servers often omit refresh_token on refresh; preserve the previous one.
    const refreshToken = refreshFromResponse ?? previousRefreshToken;
    const expiresIn = typeof record['expires_in'] === 'number' ? record['expires_in'] : undefined;
    const tokenType = typeof record['token_type'] === 'string' ? record['token_type'] : undefined;
    const scope = typeof record['scope'] === 'string' ? record['scope'] : undefined;

    return {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        ...(expiresIn !== undefined ? { expiresAt: now + expiresIn * 1000 } : {}),
        ...(tokenType ? { tokenType } : {}),
        ...(scope ? { scope } : {}),
    };
}

function safeParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`token response is not valid JSON: ${raw.slice(0, 200)}`);
    }
}
