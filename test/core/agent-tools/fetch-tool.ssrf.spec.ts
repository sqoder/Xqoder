import { describe, expect, it } from 'bun:test';
import { checkUrlSafety } from '../../../src/core/agent/tools/url-safety.js';

const stubResolver = (ips: string[]) => async (_hostname: string): Promise<string[]> => ips;

describe('checkUrlSafety', () => {
    describe('literal IP rejection (no DNS)', () => {
        it('rejects IPv4 loopback', async () => {
            const result = await checkUrlSafety('http://127.0.0.1/', { allowHttp: true });
            expect(result.allowed).toBe(false);
            if (result.allowed === false) {
                expect(result.reason).toContain('loopback');
            }
        });

        it('rejects IPv4 0.0.0.0', async () => {
            const result = await checkUrlSafety('http://0.0.0.0/', { allowHttp: true });
            expect(result.allowed).toBe(false);
        });

        it('rejects cloud metadata 169.254.169.254', async () => {
            const result = await checkUrlSafety('http://169.254.169.254/latest/meta-data/', { allowHttp: true });
            expect(result.allowed).toBe(false);
            if (result.allowed === false) {
                expect(result.reason).toMatch(/link.local|metadata/i);
            }
        });

        it('rejects RFC1918 10/8', async () => {
            const result = await checkUrlSafety('http://10.0.0.1/', { allowHttp: true });
            expect(result.allowed).toBe(false);
        });

        it('rejects RFC1918 172.16/12', async () => {
            const result = await checkUrlSafety('http://172.20.5.5/', { allowHttp: true });
            expect(result.allowed).toBe(false);
        });

        it('rejects RFC1918 192.168/16', async () => {
            const result = await checkUrlSafety('http://192.168.1.1/', { allowHttp: true });
            expect(result.allowed).toBe(false);
        });

        it('rejects IPv6 loopback ::1', async () => {
            const result = await checkUrlSafety('http://[::1]/', { allowHttp: true });
            expect(result.allowed).toBe(false);
        });

        it('rejects IPv6 ULA fc00::/7', async () => {
            const result = await checkUrlSafety('http://[fc00::1]/', { allowHttp: true });
            expect(result.allowed).toBe(false);
        });

        it('rejects IPv6 link-local fe80::/10', async () => {
            const result = await checkUrlSafety('http://[fe80::1]/', { allowHttp: true });
            expect(result.allowed).toBe(false);
        });
    });

    describe('protocol policy', () => {
        it('rejects http:// by default (no opt-in)', async () => {
            const result = await checkUrlSafety('http://example.com/', {
                resolveIps: stubResolver(['93.184.216.34']),
            });
            expect(result.allowed).toBe(false);
            if (result.allowed === false) {
                expect(result.reason).toMatch(/http/i);
            }
        });

        it('allows http:// with allowHttp=true and public IP', async () => {
            const result = await checkUrlSafety('http://example.com/', {
                allowHttp: true,
                resolveIps: stubResolver(['93.184.216.34']),
            });
            expect(result.allowed).toBe(true);
        });

        it('rejects non-http(s) protocols', async () => {
            const result = await checkUrlSafety('ftp://example.com/', {});
            expect(result.allowed).toBe(false);
        });

        it('rejects file:// protocol', async () => {
            const result = await checkUrlSafety('file:///etc/passwd', {});
            expect(result.allowed).toBe(false);
        });
    });

    describe('hostname resolution', () => {
        it('allows https:// with public IP', async () => {
            const result = await checkUrlSafety('https://example.com/', {
                resolveIps: stubResolver(['93.184.216.34']),
            });
            expect(result.allowed).toBe(true);
        });

        it('rejects hostname that DNS-resolves to private IP', async () => {
            const result = await checkUrlSafety('https://internal.corp/', {
                resolveIps: stubResolver(['10.0.5.5']),
            });
            expect(result.allowed).toBe(false);
            if (result.allowed === false) {
                expect(result.reason).toMatch(/private|rfc1918/i);
            }
        });

        it('rejects hostname that DNS-resolves to loopback (DNS rebinding)', async () => {
            const result = await checkUrlSafety('https://evil.com/', {
                resolveIps: stubResolver(['127.0.0.1']),
            });
            expect(result.allowed).toBe(false);
        });

        it('rejects if ANY resolved IP is forbidden (first public, second private)', async () => {
            const result = await checkUrlSafety('https://mixed.com/', {
                resolveIps: stubResolver(['93.184.216.34', '10.0.0.5']),
            });
            expect(result.allowed).toBe(false);
        });

        it('rejects if DNS returns no IPs', async () => {
            const result = await checkUrlSafety('https://nowhere.invalid/', {
                resolveIps: stubResolver([]),
            });
            expect(result.allowed).toBe(false);
        });
    });

    describe('malformed input', () => {
        it('rejects empty url', async () => {
            const result = await checkUrlSafety('', {});
            expect(result.allowed).toBe(false);
        });

        it('rejects unparseable url', async () => {
            const result = await checkUrlSafety('not a url', {});
            expect(result.allowed).toBe(false);
        });
    });
});
