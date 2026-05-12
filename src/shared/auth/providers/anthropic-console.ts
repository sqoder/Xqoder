// P21b — Anthropic Console OAuth (PKCE + localhost loopback callback).
//
// Client ID + endpoints are configurable via XQODER_ANTHROPIC_OAUTH_CLIENT_ID
// and XQODER_ANTHROPIC_OAUTH_BASE. Anthropic has not published a stable CLI
// client ID, so end-users / distributors set these at runtime. The module
// wires the flow — URL assembly, PKCE, callback server, token exchange —
// without baking in an id we cannot legally ship.

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

export interface AnthropicConsoleOAuthConfig {
    /** OAuth client id (must be provided via env or explicit option). */
    readonly clientId: string;
    /** Authorization endpoint. Defaults to the documented Console path. */
    readonly authorizationEndpoint?: string;
    /** Token endpoint. */
    readonly tokenEndpoint?: string;
    /** Space-separated scopes. */
    readonly scope?: string;
    /** Preferred loopback port (0 = ephemeral). */
    readonly port?: number;
    /** Test seams. */
    readonly fetch?: typeof globalThis.fetch;
    readonly openBrowserImpl?: (url: string) => boolean;
    readonly signal?: AbortSignal;
}

export interface AnthropicConsoleOAuthDeps {
    readonly startCallbackServerImpl?: typeof startCallbackServer;
}

const DEFAULT_AUTHORIZATION_ENDPOINT = 'https://console.anthropic.com/oauth/authorize';
const DEFAULT_TOKEN_ENDPOINT = 'https://console.anthropic.com/oauth/token';
const DEFAULT_SCOPE = 'api.chat api.refresh';

export function resolveAnthropicOAuthConfig(
    overrides: Partial<AnthropicConsoleOAuthConfig> = {},
    env: NodeJS.ProcessEnv = process.env,
): AnthropicConsoleOAuthConfig {
    const clientId = overrides.clientId ?? env['XQODER_ANTHROPIC_OAUTH_CLIENT_ID'];
    if (!clientId) {
        throw new Error(
            'Anthropic OAuth client id not set. Provide XQODER_ANTHROPIC_OAUTH_CLIENT_ID or pass clientId.',
        );
    }
    const base = env['XQODER_ANTHROPIC_OAUTH_BASE'];
    return {
        clientId,
        authorizationEndpoint: overrides.authorizationEndpoint
            ?? (base ? `${base.replace(/\/$/, '')}/oauth/authorize` : DEFAULT_AUTHORIZATION_ENDPOINT),
        tokenEndpoint: overrides.tokenEndpoint
            ?? (base ? `${base.replace(/\/$/, '')}/oauth/token` : DEFAULT_TOKEN_ENDPOINT),
        scope: overrides.scope ?? DEFAULT_SCOPE,
        ...(overrides.port !== undefined ? { port: overrides.port } : {}),
        ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
        ...(overrides.openBrowserImpl ? { openBrowserImpl: overrides.openBrowserImpl } : {}),
        ...(overrides.signal ? { signal: overrides.signal } : {}),
    };
}

export async function loginAnthropicConsole(
    config: AnthropicConsoleOAuthConfig,
    deps: AnthropicConsoleOAuthDeps = {},
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

export async function refreshAnthropicConsole(
    tokens: OAuthTokens,
    overrides: Partial<AnthropicConsoleOAuthConfig> = {},
    env: NodeJS.ProcessEnv = process.env,
): Promise<OAuthTokens> {
    if (!tokens.refreshToken) {
        throw new Error('Anthropic Console tokens missing refresh_token');
    }
    const config = resolveAnthropicOAuthConfig(overrides, env);
    return refreshAccessToken({
        tokenEndpoint: config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
        clientId: config.clientId,
        refreshToken: tokens.refreshToken,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
}
