import { describe, expect, it } from 'bun:test';
import { pollDeviceToken, requestDeviceCode } from '../../../src/shared/auth/device-flow.js';

describe('requestDeviceCode (P21a)', () => {
    it('parses a successful device authorization response', async () => {
        const fetchMock = async (_url: unknown, init: unknown) => {
            const body = (init as { body: string }).body;
            expect(body).toContain('client_id=my-client');
            expect(body).toContain('scope=read%3Auser');
            return new Response(JSON.stringify({
                device_code: 'dev-123',
                user_code: 'WDJB-MJHT',
                verification_uri: 'https://github.com/login/device',
                verification_uri_complete: 'https://github.com/login/device?user_code=WDJB-MJHT',
                expires_in: 900,
                interval: 5,
            }), { status: 200 });
        };
        const result = await requestDeviceCode({
            deviceAuthorizationEndpoint: 'https://example.com/device',
            clientId: 'my-client',
            scope: 'read:user',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
        });
        expect(result.deviceCode).toBe('dev-123');
        expect(result.userCode).toBe('WDJB-MJHT');
        expect(result.verificationUri).toBe('https://github.com/login/device');
        expect(result.expiresIn).toBe(900);
        expect(result.intervalSeconds).toBe(5);
    });

    it('throws on non-2xx response', async () => {
        const fetchMock = async () => new Response('nope', { status: 400 });
        await expect(requestDeviceCode({
            deviceAuthorizationEndpoint: 'x',
            clientId: 'c',
            scope: 's',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
        })).rejects.toThrow(/400/);
    });

    it('throws when required fields are missing', async () => {
        const fetchMock = async () => new Response(JSON.stringify({ foo: 'bar' }), { status: 200 });
        await expect(requestDeviceCode({
            deviceAuthorizationEndpoint: 'x',
            clientId: 'c',
            scope: 's',
            fetch: fetchMock as unknown as typeof globalThis.fetch,
        })).rejects.toThrow(/missing required/);
    });
});

describe('pollDeviceToken (P21a)', () => {
    it('succeeds on the second poll after authorization_pending', async () => {
        let calls = 0;
        const fetchMock = async () => {
            calls += 1;
            if (calls === 1) {
                return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 });
            }
            return new Response(JSON.stringify({ access_token: 'TOK', expires_in: 3600 }), { status: 200 });
        };
        const tokens = await pollDeviceToken({
            tokenEndpoint: 'x',
            clientId: 'c',
            deviceCode: 'd',
            intervalSeconds: 1,
            expiresIn: 10,
            fetch: fetchMock as unknown as typeof globalThis.fetch,
            sleep: async () => { /* no-op */ },
        });
        expect(tokens.accessToken).toBe('TOK');
        expect(calls).toBe(2);
    });

    it('expands interval on slow_down', async () => {
        let calls = 0;
        let sleeps: number[] = [];
        const fetchMock = async () => {
            calls += 1;
            if (calls < 3) {
                return new Response(JSON.stringify({ error: 'slow_down' }), { status: 400 });
            }
            return new Response(JSON.stringify({ access_token: 'T' }), { status: 200 });
        };
        await pollDeviceToken({
            tokenEndpoint: 'x',
            clientId: 'c',
            deviceCode: 'd',
            intervalSeconds: 1,
            expiresIn: 30,
            fetch: fetchMock as unknown as typeof globalThis.fetch,
            sleep: async (ms) => { sleeps.push(ms); },
        });
        expect(sleeps[0]).toBe(1000);
        expect(sleeps[1]).toBe(6000);
        expect(sleeps[2]).toBe(11_000);
    });

    it('throws on generic error', async () => {
        const fetchMock = async () => new Response(JSON.stringify({ error: 'access_denied' }), { status: 400 });
        await expect(pollDeviceToken({
            tokenEndpoint: 'x',
            clientId: 'c',
            deviceCode: 'd',
            intervalSeconds: 1,
            expiresIn: 10,
            fetch: fetchMock as unknown as typeof globalThis.fetch,
            sleep: async () => { /* no-op */ },
        })).rejects.toThrow(/access_denied/);
    });

    it('throws after expiry', async () => {
        let clock = 0;
        const fetchMock = async () => new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 });
        const sleep = async (ms: number) => {
            clock += ms;
        };
        await expect(pollDeviceToken({
            tokenEndpoint: 'x',
            clientId: 'c',
            deviceCode: 'd',
            intervalSeconds: 5,
            expiresIn: 10,
            fetch: fetchMock as unknown as typeof globalThis.fetch,
            sleep,
            now: () => clock,
        })).rejects.toThrow(/expired/);
    });
});
