import { describe, expect, it } from 'bun:test';
import { loadImportSource } from '../../../src/commands/sessions/import.js';

const makeResponse = (init: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: string;
}): Response => {
    const headers = new Headers(init.headers ?? {});
    return new Response(init.body ?? '', {
        status: init.status ?? 200,
        statusText: init.statusText ?? 'OK',
        headers,
    });
};

describe('loadImportSource — SSRF hardening', () => {
    it('rejects http:// by default (plaintext)', async () => {
        await expect(
            loadImportSource('http://example.com/share.json', {
                fetchImpl: async () => makeResponse({ body: '{}' }),
            }),
        ).rejects.toThrow(/http/i);
    });

    it('rejects non-http(s) URL protocols', async () => {
        await expect(
            loadImportSource('file:///etc/passwd', {
                fetchImpl: async () => makeResponse({ body: '{}' }),
            }),
        ).rejects.toThrow();
    });

    it('rejects hostname resolving to a private IP', async () => {
        await expect(
            loadImportSource('https://intranet.corp/share.json', {
                fetchImpl: async () => makeResponse({ body: '{}' }),
                resolveIps: async () => ['10.0.0.5'],
            }),
        ).rejects.toThrow(/private|rfc1918/i);
    });

    it('rejects hostname resolving to loopback', async () => {
        await expect(
            loadImportSource('https://evil.example/share.json', {
                fetchImpl: async () => makeResponse({ body: '{}' }),
                resolveIps: async () => ['127.0.0.1'],
            }),
        ).rejects.toThrow(/loopback/i);
    });

    it('rejects responses exceeding the size cap via Content-Length', async () => {
        await expect(
            loadImportSource('https://share.example/big.json', {
                fetchImpl: async () =>
                    makeResponse({
                        headers: {
                            'content-type': 'application/json',
                            'content-length': String(10 * 1024 * 1024),
                        },
                        body: '{}',
                    }),
                resolveIps: async () => ['93.184.216.34'],
            }),
        ).rejects.toThrow(/size|too large|cap|limit/i);
    });

    it('rejects non-JSON content-type', async () => {
        await expect(
            loadImportSource('https://share.example/file.html', {
                fetchImpl: async () =>
                    makeResponse({
                        headers: { 'content-type': 'text/html' },
                        body: '<html></html>',
                    }),
                resolveIps: async () => ['93.184.216.34'],
            }),
        ).rejects.toThrow(/content.type|json/i);
    });

    it('accepts https:// + public IP + application/json', async () => {
        const payload = { summary: {}, snapshot: {} };
        const result = await loadImportSource('https://share.example/good.json', {
            fetchImpl: async () =>
                makeResponse({
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(payload),
                }),
            resolveIps: async () => ['93.184.216.34'],
        });
        expect(result).toEqual(payload);
    });

    it('accepts application/json; charset=utf-8', async () => {
        const payload = { ok: true };
        const result = await loadImportSource('https://share.example/utf.json', {
            fetchImpl: async () =>
                makeResponse({
                    headers: { 'content-type': 'application/json; charset=utf-8' },
                    body: JSON.stringify(payload),
                }),
            resolveIps: async () => ['93.184.216.34'],
        });
        expect(result).toEqual(payload);
    });

    it('propagates non-2xx fetch errors', async () => {
        await expect(
            loadImportSource('https://share.example/missing.json', {
                fetchImpl: async () =>
                    makeResponse({
                        status: 404,
                        statusText: 'Not Found',
                        headers: { 'content-type': 'application/json' },
                    }),
                resolveIps: async () => ['93.184.216.34'],
            }),
        ).rejects.toThrow(/404|Not Found/i);
    });
});
