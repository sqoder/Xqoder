import { describe, expect, it } from 'bun:test';
import { openBrowser } from '../../../src/shared/auth/open-browser.js';

function fakeSpawn(platform: 'darwin' | 'win32' | 'linux') {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spawnImpl = ((cmd: string, args: string[]) => {
        calls.push({ cmd, args });
        return { unref: () => { /* noop */ } } as unknown as ReturnType<typeof import('node:child_process').spawn>;
    }) as unknown as typeof import('node:child_process').spawn;
    return {
        open: (url: string) => openBrowser(url, { spawnImpl, platform }),
        calls,
    };
}

describe('openBrowser (P21b)', () => {
    it('uses `open` on darwin', () => {
        const { open, calls } = fakeSpawn('darwin');
        expect(open('https://example.com')).toBe(true);
        expect(calls[0]?.cmd).toBe('open');
        expect(calls[0]?.args).toEqual(['https://example.com']);
    });

    it('uses `cmd /c start` on win32 with & escaped', () => {
        const { open, calls } = fakeSpawn('win32');
        open('https://example.com/path?a=1&b=2');
        expect(calls[0]?.cmd).toBe('cmd');
        expect(calls[0]?.args[2]).toBe('""');
        expect(calls[0]?.args[3]).toBe('https://example.com/path?a=1^&b=2');
    });

    it('uses xdg-open on linux', () => {
        const { open, calls } = fakeSpawn('linux');
        open('https://example.com');
        expect(calls[0]?.cmd).toBe('xdg-open');
    });

    it('returns false when spawn throws', () => {
        const spawnImpl = (() => { throw new Error('no browser'); }) as unknown as typeof import('node:child_process').spawn;
        expect(openBrowser('https://example.com', { spawnImpl, platform: 'linux' })).toBe(false);
    });
});
