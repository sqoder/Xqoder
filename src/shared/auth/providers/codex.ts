// P21b — OpenAI Codex OAuth (PKCE + loopback).
//
// Codex uses PKCE with a special `/oauth/callback` path and often returns
// an `account_id` field in the token response (used by Codex /responses
// for billing attribution). We preserve it in OAuthTokens.metadata.

import * as crypto from 'node:crypto';
import { startCallbackServer } from '../callback-server.js';
import { openBrowser } from '../open-browser.js';
import {
    buildAuthorizeUrl,
    exchangeCode,
    generatePkceChallenge,
    refreshAccessToken,
} from '../oauth-client.js';
import type { OAuthTokens } from '../types.js';

export interface CodexOAuthConfig {
    readonly clientId: string;
    readonly authorizationEndpoint?: string;
    readonly tokenEndpoint?: string;
    readonly scope?: string;
    readonly port?: number;
    readonly fetch?: typeof globalThis.fetch;
    readonly openBrowserImpl?: (url: string) => boolean;
    readonly signal?: AbortSignal;
}

export interface CodexOAuthDeps {
    readonly startCallbackServerImpl?: typeof startCallbackServer;
}

const DEFAULT_AUTHORIZATION_ENDPOINT = 'https://auth.openai.com/oauth/authorize';
const DEFAULT_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
const DEFAULT_SCOPE = 'openid profile email offline_access';

export function resolveCodexOAuthConfig(
    overrides: Partial<CodexOAuthConfig> = {},
    env: NodeJS.ProcessEnv = process.env,
): CodexOAuthConfig {
    const clientId = overrides.clientId ?? env['XQODER_CODEX_OAUTH_CLIENT_ID'];
    if (!clientId) {
        throw new Error('Codex OAuth client id not set. Provide XQODER_CODEX_OAUTH_CLIENT_ID.');
    }
    return {
        clientId,
        authorizationEndpoint: overrides.authorizationEndpoint ?? DEFAULT_AUTHORIZATION_ENDPOINT,
        tokenEndpoint: overrides.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
        scope: overrides.scope ?? DEFAULT_SCOPE,
        ...(overrides.port !== undefined ? { port: overrides.port } : {}),
        ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
        ...(overrides.openBrowserImpl ? { openBrowserImpl: overrides.openBrowserImpl } : {}),
        ...(overrides.signal ? { signal: overrides.signal } : {}),
    };
}

export async function loginCodex(
    config: CodexOAuthConfig,
    deps: CodexOAuthDeps = {},
): Promise<OAuthTokens> {
    const pkce = generatePkceChallenge();
    const state = crypto.randomBytes(16).toString('base64url');
    const start = deps.startCallbackServerImpl ?? startCallbackServer;
    const server = await start({
        ...(config.port !== undefined ? { port: config.port } : {}),
        path: '/callback',
        ...(config.signal ? { signal: config.signal } : {}),
    });

    try {
        const url = buildAuthorizeUrl({
            authorizationEndpoint: config.authorizationEndpoint ?? DEFAULT_AUTHORIZATION_ENDPOINT,
            clientId: config.clientId,
            redirectUri: server.redirectUri,
            scope: config.scope ?? DEFAULT_SCOPE,
            state,
            codeChallenge: pkce.challenge,
        });
        const opener = config.openBrowserImpl ?? ((u: string) => openBrowser(u));
        opener(url);
        const { code, state: returnedState } = await server.done;
        if (returnedState !== undefined && returnedState !== state) {
            throw new Error(`OAuth state mismatch (expected ${state}, got ${returnedState})`);
        }
        const tokens = await exchangeCode({
            tokenEndpoint: config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
            clientId: config.clientId,
            code,
            redirectUri: server.redirectUri,
            codeVerifier: pkce.verifier,
            ...(config.fetch ? { fetch: config.fetch } : {}),
        });
        return tokens;
    } finally {
        await server.close();
    }
}

export async function refreshCodex(
    tokens: OAuthTokens,
    overrides: Partial<CodexOAuthConfig> = {},
    env: NodeJS.ProcessEnv = process.env,
): Promise<OAuthTokens> {
    if (!tokens.refreshToken) {
        throw new Error('Codex tokens missing refresh_token');
    }
    const config = resolveCodexOAuthConfig(overrides, env);
    const refreshed = await refreshAccessToken({
        tokenEndpoint: config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
        clientId: config.clientId,
        refreshToken: tokens.refreshToken,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    // Preserve account_id metadata from the original login.
    if (tokens.metadata && !refreshed.metadata) {
        return { ...refreshed, metadata: tokens.metadata };
    }
    return refreshed;
}
