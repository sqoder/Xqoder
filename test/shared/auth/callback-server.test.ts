import { afterEach, describe, expect, it } from 'bun:test';
import { startCallbackServer, type RunningCallbackServer } from '../../../src/shared/auth/callback-server.js';

const servers: RunningCallbackServer[] = [];

afterEach(async () => {
    while (servers.length > 0) {
        const s = servers.pop();
        if (s) await s.close();
    }
});

async function start(options?: Parameters<typeof startCallbackServer>[0]): Promise<RunningCallbackServer> {
    const s = await startCallbackServer(options);
    servers.push(s);
    return s;
}

describe('startCallbackServer (P21b)', () => {
    it('resolves with code + state when /callback is hit', async () => {
        const s = await start({ path: '/callback' });
        void fetch(`${s.redirectUri}?code=the-code&state=xyz`);
        const result = await s.done;
        expect(result.code).toBe('the-code');
        expect(result.state).toBe('xyz');
    });

    it('uses an ephemeral port when port is omitted', async () => {
        const s = await start();
        expect(s.port).toBeGreaterThan(0);
        expect(s.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
        void fetch(`${s.redirectUri}?code=x`);
        await s.done;
    });

    it('404s unrelated paths without resolving done', async () => {
        const s = await start();
        const response = await fetch(`http://127.0.0.1:${s.port}/other`);
        expect(response.status).toBe(404);
        // follow-up with the real callback so we can close cleanly
        void fetch(`${s.redirectUri}?code=ok`);
        await s.done;
    });

    it('rejects done when the IdP returns an error param', async () => {
        const s = await start();
        void fetch(`${s.redirectUri}?error=access_denied`);
        await expect(s.done).rejects.toThrow(/access_denied/);
    });

    it('rejects done when code is missing', async () => {
        const s = await start();
        void fetch(`${s.redirectUri}?state=xyz`);
        await expect(s.done).rejects.toThrow(/missing code/);
    });

    it('rejects when the signal aborts', async () => {
        const controller = new AbortController();
        const s = await start({ signal: controller.signal });
        controller.abort();
        await expect(s.done).rejects.toThrow(/aborted/);
    });
});
