import { describe, expect, it } from 'bun:test';
import {
    buildAuthorizeUrl,
    exchangeCode,
    generatePkceChallenge,
    parseTokenResponse,
    randomVerifier,
    refreshAccessToken,
} from '../../../src/shared/auth/oauth-client.js';

describe('generatePkceChallenge (P21a)', () => {
    it('produces a 43-char+ verifier and S256 challenge', () => {
        const challenge = generatePkceChallenge();
        expect(challenge.verifier.length).toBeGreaterThanOrEqual(43);
        expect(challenge.method).toBe('S256');
        expect(challenge.challenge.length).toBeGreaterThan(0);
    });

    it('is deterministic given a verifier', () => {
        const verifier = 'test-verifier-12345678901234567890123456';
        const a = generatePkceChallenge(verifier);
        const b = generatePkceChallenge(verifier);
        expect(a.challenge).toBe(b.challenge);
    });
});

describe('randomVerifier (P21a)', () => {
    it('yields base64url strings of at least 43 chars', () => {
        const v = randomVerifier();
        expect(v.length).toBeGreaterThanOrEqual(43);
        expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    });
});

describe('buildAuthorizeUrl (P21a)', () => {
    it('assembles the required PKCE query params', () => {
        const url = buildAuthorizeUrl({
            authorizationEndpoint: 'https://example.com/authorize',
            clientId: 'cid',
            redirectUri: 'http://127.0.0.1:1234/callback',
            scope: 'read write',
            state: 'xyz',
            codeChallenge: 'abc',
        });
        const parsed = new URL(url);
        expect(parsed.searchParams.get('response_type')).toBe('code');
        expect(parsed.searchParams.get('client_id')).toBe('cid');
        expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1234/callback');
        expect(parsed.searchParams.get('scope')).toBe('read write');
        expect(parsed.searchParams.get('state')).toBe('xyz');
        expect(parsed.searchParams.get('code_challenge')).toBe('abc');
        expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('appends extraParams', () => {
        const url = buildAuthorizeUrl({
            authorizationEndpoint: 'https://example.com/authorize',
            clientId: 'c',
            redirectUri: 'http://127.0.0.1:1234/callback',
            scope: 's',
            state: 't',
            codeChallenge: 'x',
            extraParams: { access_type: 'offline', prompt: 'consent' },
        });
        const parsed = new URL(url);
        expect(parsed.searchParams.get('access_type')).toBe('offline');
        expect(parsed.searchParams.get('prompt')).toBe('consent');
    });
});

describe('parseTokenResponse (P21a)', () => {
    it('extracts access_token + refresh_token + expiry', () => {
        const now = 1_700_000_000_000;
        const tokens = parseTokenResponse({
            access_token: 'A',
            refresh_token: 'R',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: 's1 s2',
        }, now);
        expect(tokens.accessToken).toBe('A');
        expect(tokens.refreshToken).toBe('R');
        expect(tokens.expiresAt).toBe(now + 3_600_000);
        expect(tokens.tokenType).toBe('Bearer');
        expect(tokens.scope).toBe('s1 s2');
    });

    it('preserves previous refresh token when response omits it', () => {
        const tokens = parseTokenResponse({ access_token: 'A', expires_in: 60 }, 1000, 'keep-me');
        expect(tokens.refreshToken).toBe('keep-me');
    });

    it('throws on missing access_token', () => {
        expect(() => parseTokenResponse({ foo: 'bar' }, 0)).toThrow(/access_token/);
    });

    it('throws on non-object payload', () => {
        expect(() => parseTokenResponse(null, 0)).toThrow(/JSON object/);
        expect(() => parseTokenResponse('string', 0)).toThrow(/JSON object/);
    });
});

describe('exchangeCode (P21a)', () => {
    it('POSTs to token endpoint and returns parsed tokens', async () => {
        const fetchMock = async (url: unknown, init: unknown) => {
            expect(url).toBe('https://example.com/token');
            const body = (init as { body: string }).body;
            const parsed = new URLSearchParams(body);
            expect(parsed.get('grant_type')).toBe('authorization_code');
            expect(parsed.get('code')).toBe('the-code');
            expect(parsed.get('code_verifier')).toBe('the-verifier');
            return new Response(JSON.stringify({ access_token: 'AA', expires_in: 60 }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        };
        const tokens = await exchangeCode({
            tokenEndpoint: 'https://example.com/token',
            clientId: 'cid',
            code: 'the-code',
            redirectUri: 'http://127.0.0.1:1234/callback',
            codeVerifier: 'the-verifier',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
        });
        expect(tokens.accessToken).toBe('AA');
    });

    it('throws with status info when the endpoint returns an error', async () => {
        const fetchMock = async () => new Response('bad code', { status: 400 });
        await expect(exchangeCode({
            tokenEndpoint: 'https://x',
            clientId: 'c',
            code: 'c',
            redirectUri: 'r',
            codeVerifier: 'v',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
        })).rejects.toThrow(/400/);
    });
});

describe('refreshAccessToken (P21a)', () => {
    it('uses grant_type=refresh_token and returns new tokens', async () => {
        const fetchMock = async (_url: unknown, init: unknown) => {
            const body = (init as { body: string }).body;
            const parsed = new URLSearchParams(body);
            expect(parsed.get('grant_type')).toBe('refresh_token');
            expect(parsed.get('refresh_token')).toBe('OLD');
            return new Response(JSON.stringify({ access_token: 'NEW', expires_in: 30 }), { status: 200 });
        };
        const tokens = await refreshAccessToken({
            tokenEndpoint: 'https://example.com/token',
            clientId: 'c',
            refreshToken: 'OLD',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
        });
        expect(tokens.accessToken).toBe('NEW');
    });
});
