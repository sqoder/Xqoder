import { describe, expect, it } from 'bun:test';
import { loginAnthropicConsole, resolveAnthropicOAuthConfig, refreshAnthropicConsole } from '../../../src/shared/auth/providers/anthropic-console.js';
import { loginCodex, refreshCodex, resolveCodexOAuthConfig } from '../../../src/shared/auth/providers/codex.js';
import { loginGemini, refreshGemini, resolveGeminiOAuthConfig } from '../../../src/shared/auth/providers/gemini.js';
import { loginGitHubDevice, refreshGitHubDevice, resolveGitHubDeviceFlowConfig } from '../../../src/shared/auth/providers/github-device.js';
import { refreshForProvider } from '../../../src/shared/auth/providers/index.js';

/**
 * Builds a fake callback server that resolves `done` on the next tick,
 * giving the caller time to run openBrowser(url) first so we can extract
 * `state` from the captured URL.
 */
function lazyFakeCallback(urlRef: { value: string }): Parameters<typeof loginAnthropicConsole>[1]['startCallbackServerImpl'] {
    return (async () => {
        return {
            port: 12_345,
            redirectUri: 'http://127.0.0.1:12345/callback',
            done: new Promise<{ code: string; state?: string }>((resolve) => {
                // resolve after the current tick so the caller has populated urlRef
                setImmediate(() => {
                    const state = urlRef.value
                        ? new URL(urlRef.value).searchParams.get('state') ?? undefined
                        : undefined;
                    resolve(state !== undefined ? { code: 'the-code', state } : { code: 'the-code' });
                });
            }),
            close: async () => { /* noop */ },
        };
    }) as Parameters<typeof loginAnthropicConsole>[1]['startCallbackServerImpl'];
}

describe('resolveAnthropicOAuthConfig (P21b)', () => {
    it('reads client id from env', () => {
        const config = resolveAnthropicOAuthConfig({}, { XQODER_ANTHROPIC_OAUTH_CLIENT_ID: 'abc' });
        expect(config.clientId).toBe('abc');
        expect(config.authorizationEndpoint).toContain('anthropic.com');
    });

    it('throws when client id is missing', () => {
        expect(() => resolveAnthropicOAuthConfig({}, {})).toThrow(/client id not set/);
    });

    it('honors XQODER_ANTHROPIC_OAUTH_BASE override', () => {
        const config = resolveAnthropicOAuthConfig({ clientId: 'c' }, { XQODER_ANTHROPIC_OAUTH_BASE: 'https://fake.example/' });
        expect(config.authorizationEndpoint).toBe('https://fake.example/oauth/authorize');
        expect(config.tokenEndpoint).toBe('https://fake.example/oauth/token');
    });
});

describe('loginAnthropicConsole (P21b)', () => {
    it('assembles PKCE URL, waits for callback, and exchanges the code', async () => {
        const urlRef = { value: '' };
        let capturedCodeVerifier: string | undefined;
        let capturedCode: string | undefined;
        const fetchMock = async (url: unknown, init: unknown) => {
            const body = (init as { body: string }).body;
            const parsed = new URLSearchParams(body);
            capturedCodeVerifier = parsed.get('code_verifier') ?? undefined;
            capturedCode = parsed.get('code') ?? undefined;
            expect(url).toBe('https://console.anthropic.com/oauth/token');
            return new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }), { status: 200 });
        };
        const tokens = await loginAnthropicConsole({
            clientId: 'cid',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
            openBrowserImpl: (url) => { urlRef.value = url; return true; },
        }, {
            startCallbackServerImpl: lazyFakeCallback(urlRef),
        });
        expect(tokens.accessToken).toBe('AT');
        expect(tokens.refreshToken).toBe('RT');
        expect(urlRef.value).toContain('code_challenge=');
        expect(urlRef.value).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback');
        expect(capturedCode).toBe('the-code');
        expect(capturedCodeVerifier).toBeDefined();
    });

    it('throws on state mismatch', async () => {
        const fetchMock = async () => new Response(JSON.stringify({ access_token: 'T' }), { status: 200 });
        await expect(loginAnthropicConsole({
            clientId: 'cid',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
            openBrowserImpl: () => true,
        }, {
            startCallbackServerImpl: (async () => ({
                port: 0,
                redirectUri: 'http://127.0.0.1:0/callback',
                done: Promise.resolve({ code: 'x', state: 'wrong-state' }),
                close: async () => { /* noop */ },
            })) as Parameters<typeof loginAnthropicConsole>[1]['startCallbackServerImpl'],
        })).rejects.toThrow(/state mismatch/);
    });
});

describe('refreshAnthropicConsole (P21b)', () => {
    it('calls the token endpoint with refresh_token', async () => {
        const fetchMock = async (_url: unknown, init: unknown) => {
            const body = new URLSearchParams((init as { body: string }).body);
            expect(body.get('grant_type')).toBe('refresh_token');
            expect(body.get('refresh_token')).toBe('OLD');
            return new Response(JSON.stringify({ access_token: 'NEW', expires_in: 60 }), { status: 200 });
        };
        const tokens = await refreshAnthropicConsole(
            { accessToken: 'OLD_AT', refreshToken: 'OLD', expiresAt: 0 },
            { fetch: fetchMock as unknown as typeof globalThis.fetch },
            { XQODER_ANTHROPIC_OAUTH_CLIENT_ID: 'cid' },
        );
        expect(tokens.accessToken).toBe('NEW');
    });

    it('throws when refresh_token missing', async () => {
        await expect(refreshAnthropicConsole(
            { accessToken: 'OLD_AT' },
            {},
            { XQODER_ANTHROPIC_OAUTH_CLIENT_ID: 'cid' },
        )).rejects.toThrow(/missing refresh_token/);
    });
});

describe('Codex OAuth (P21b)', () => {
    it('resolveCodexOAuthConfig requires client id', () => {
        expect(() => resolveCodexOAuthConfig({}, {})).toThrow(/client id not set/);
    });

    it('refreshCodex preserves previous metadata if the response omits it', async () => {
        const fetchMock = async () => new Response(JSON.stringify({ access_token: 'NEW', expires_in: 60 }), { status: 200 });
        const refreshed = await refreshCodex(
            { accessToken: 'OLD', refreshToken: 'R', metadata: { account_id: '42' } },
            { fetch: fetchMock as unknown as typeof globalThis.fetch },
            { XQODER_CODEX_OAUTH_CLIENT_ID: 'cid' },
        );
        expect(refreshed.accessToken).toBe('NEW');
        expect(refreshed.metadata).toEqual({ account_id: '42' });
    });

    it('loginCodex happy path exchanges code for tokens', async () => {
        const urlRef = { value: '' };
        const fetchMock = async () => new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT' }), { status: 200 });
        const tokens = await loginCodex({
            clientId: 'cid',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
            openBrowserImpl: (url) => { urlRef.value = url; return true; },
        }, {
            startCallbackServerImpl: lazyFakeCallback(urlRef),
        });
        expect(tokens.accessToken).toBe('AT');
    });
});

describe('Gemini OAuth (P21b)', () => {
    it('resolveGeminiOAuthConfig requires client id', () => {
        expect(() => resolveGeminiOAuthConfig({}, {})).toThrow(/client id not set/);
    });

    it('loginGemini attaches access_type=offline + prompt=consent', async () => {
        const urlRef = { value: '' };
        const fetchMock = async () => new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT' }), { status: 200 });
        await loginGemini({
            clientId: 'cid',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
            openBrowserImpl: (u) => { urlRef.value = u; return true; },
        }, {
            startCallbackServerImpl: lazyFakeCallback(urlRef),
        });
        expect(urlRef.value).toContain('access_type=offline');
        expect(urlRef.value).toContain('prompt=consent');
    });

    it('refreshGemini demands refresh_token', async () => {
        await expect(refreshGemini(
            { accessToken: 'OLD' },
            {},
            { XQODER_GEMINI_OAUTH_CLIENT_ID: 'cid' },
        )).rejects.toThrow(/refresh_token/);
    });
});

describe('GitHub Device Flow (P21b)', () => {
    it('resolveGitHubDeviceFlowConfig requires client id', () => {
        expect(() => resolveGitHubDeviceFlowConfig({}, {})).toThrow(/client id not set/);
    });

    it('loginGitHubDevice flows device_code + poll', async () => {
        let promptSeen = false;
        const fetchMock = async (url: unknown) => {
            const target = String(url);
            if (target.endsWith('/device/code')) {
                return new Response(JSON.stringify({
                    device_code: 'dev',
                    user_code: 'ABCD',
                    verification_uri: 'https://github.com/login/device',
                    expires_in: 600,
                    interval: 0,
                }), { status: 200 });
            }
            return new Response(JSON.stringify({ access_token: 'GHT', expires_in: 3600 }), { status: 200 });
        };
        const tokens = await loginGitHubDevice({
            clientId: 'gh',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
            onPrompt: () => { promptSeen = true; },
        });
        expect(promptSeen).toBe(true);
        expect(tokens.accessToken).toBe('GHT');
    });

    it('refreshGitHubDevice throws without refresh_token', async () => {
        await expect(refreshGitHubDevice(
            { accessToken: 'OLD' },
            {},
            { XQODER_GITHUB_OAUTH_CLIENT_ID: 'gh' },
        )).rejects.toThrow(/refresh_token/);
    });
});

describe('refreshForProvider (P21b)', () => {
    it('dispatches to the right provider module', async () => {
        const fetchMock = async () => new Response(JSON.stringify({ access_token: 'NEW', expires_in: 60 }), { status: 200 });
        const env = { XQODER_ANTHROPIC_OAUTH_CLIENT_ID: 'cid' };
        const originalFetch = globalThis.fetch;
        (globalThis as { fetch: typeof globalThis.fetch }).fetch = fetchMock as unknown as typeof globalThis.fetch;
        try {
            const tokens = await refreshForProvider('anthropic', { accessToken: 'O', refreshToken: 'R' }, env);
            expect(tokens.accessToken).toBe('NEW');
        } finally {
            (globalThis as { fetch: typeof globalThis.fetch }).fetch = originalFetch;
        }
    });

    it('throws for unknown provider', async () => {
        await expect(refreshForProvider('unknown', { accessToken: 'O' })).rejects.toThrow(/not implemented/);
    });
});
