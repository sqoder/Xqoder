// P21b — Google Gemini OAuth (PKCE + loopback + access_type=offline).
//
// Gemini's OAuth is Google's standard flow, needing access_type=offline +
// prompt=consent to get a refresh_token on first login. `approval_prompt`
// is deprecated; prompt=consent is the replacement.

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

export interface GeminiOAuthConfig {
    readonly clientId: string;
    readonly authorizationEndpoint?: string;
    readonly tokenEndpoint?: string;
    readonly scope?: string;
    readonly port?: number;
    readonly fetch?: typeof globalThis.fetch;
    readonly openBrowserImpl?: (url: string) => boolean;
    readonly signal?: AbortSignal;
}

export interface GeminiOAuthDeps {
    readonly startCallbackServerImpl?: typeof startCallbackServer;
}

const DEFAULT_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/generative-language.retriever';

export function resolveGeminiOAuthConfig(
    overrides: Partial<GeminiOAuthConfig> = {},
    env: NodeJS.ProcessEnv = process.env,
): GeminiOAuthConfig {
    const clientId = overrides.clientId ?? env['XQODER_GEMINI_OAUTH_CLIENT_ID'];
    if (!clientId) {
        throw new Error('Gemini OAuth client id not set. Provide XQODER_GEMINI_OAUTH_CLIENT_ID.');
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

export async function loginGemini(
    config: GeminiOAuthConfig,
    deps: GeminiOAuthDeps = {},
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
            extraParams: {
                access_type: 'offline',
                prompt: 'consent',
            },
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

export async function refreshGemini(
    tokens: OAuthTokens,
    overrides: Partial<GeminiOAuthConfig> = {},
    env: NodeJS.ProcessEnv = process.env,
): Promise<OAuthTokens> {
    if (!tokens.refreshToken) {
        throw new Error('Gemini tokens missing refresh_token — re-login with prompt=consent required');
    }
    const config = resolveGeminiOAuthConfig(overrides, env);
    return refreshAccessToken({
        tokenEndpoint: config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
        clientId: config.clientId,
        refreshToken: tokens.refreshToken,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
}
