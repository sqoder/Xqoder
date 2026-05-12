import { describe, expect, it } from 'bun:test';
import {
    CredentialsManager,
    InMemorySecureStorage,
    NotLoggedInError,
    RefreshNotPossibleError,
    parseCredentials,
    serializeCredentials,
    type OAuthTokens,
} from '../../../src/shared/auth/index.js';

describe('CredentialsManager (P21a)', () => {
    it('saves and loads tokens', async () => {
        const mgr = new CredentialsManager({
            storage: new InMemorySecureStorage(),
            refresh: async (_p, t) => t,
        });
        const tokens: OAuthTokens = { accessToken: 'A', expiresAt: Date.now() + 600_000 };
        await mgr.save('anthropic', tokens);
        const loaded = await mgr.load('anthropic');
        expect(loaded?.accessToken).toBe('A');
    });

    it('returns null on missing provider', async () => {
        const mgr = new CredentialsManager({
            storage: new InMemorySecureStorage(),
            refresh: async (_p, t) => t,
        });
        expect(await mgr.load('none')).toBeNull();
    });

    it('ensureFreshTokens throws NotLoggedInError when empty', async () => {
        const mgr = new CredentialsManager({
            storage: new InMemorySecureStorage(),
            refresh: async (_p, t) => t,
        });
        await expect(mgr.ensureFreshTokens('anthropic')).rejects.toBeInstanceOf(NotLoggedInError);
    });

    it('returns tokens without refresh when still fresh', async () => {
        const storage = new InMemorySecureStorage();
        const now = 1_700_000_000_000;
        let refreshed = 0;
        const mgr = new CredentialsManager({
            storage,
            now: () => now,
            refresh: async (_p, t) => {
                refreshed += 1;
                return { ...t, accessToken: 'NEW' };
            },
        });
        await mgr.save('anthropic', {
            accessToken: 'OLD',
            refreshToken: 'R',
            expiresAt: now + 10 * 60 * 1000,
        });
        const tokens = await mgr.ensureFreshTokens('anthropic');
        expect(tokens.accessToken).toBe('OLD');
        expect(refreshed).toBe(0);
    });

    it('refreshes when within the refresh window', async () => {
        const storage = new InMemorySecureStorage();
        const now = 1_700_000_000_000;
        let refreshed = 0;
        const mgr = new CredentialsManager({
            storage,
            now: () => now,
            refresh: async (_p, t) => {
                refreshed += 1;
                return { accessToken: 'NEW', refreshToken: t.refreshToken, expiresAt: now + 3600 * 1000 };
            },
        });
        await mgr.save('anthropic', {
            accessToken: 'OLD',
            refreshToken: 'R',
            expiresAt: now + 2 * 60 * 1000,
        });
        const tokens = await mgr.ensureFreshTokens('anthropic');
        expect(tokens.accessToken).toBe('NEW');
        expect(refreshed).toBe(1);
        const loaded = await mgr.load('anthropic');
        expect(loaded?.accessToken).toBe('NEW');
    });

    it('refreshes when already expired', async () => {
        const storage = new InMemorySecureStorage();
        const now = 1_700_000_000_000;
        const mgr = new CredentialsManager({
            storage,
            now: () => now,
            refresh: async (_p, t) => ({ ...t, accessToken: 'NEW', expiresAt: now + 3600 * 1000 }),
        });
        await mgr.save('anthropic', {
            accessToken: 'OLD',
            refreshToken: 'R',
            expiresAt: now - 1000,
        });
        const tokens = await mgr.ensureFreshTokens('anthropic');
        expect(tokens.accessToken).toBe('NEW');
    });

    it('throws RefreshNotPossibleError when expiring but no refresh token', async () => {
        const storage = new InMemorySecureStorage();
        const now = 1_700_000_000_000;
        const mgr = new CredentialsManager({
            storage,
            now: () => now,
            refresh: async (_p, t) => t,
        });
        await mgr.save('anthropic', { accessToken: 'OLD', expiresAt: now - 1 });
        await expect(mgr.ensureFreshTokens('anthropic')).rejects.toBeInstanceOf(RefreshNotPossibleError);
    });

    it('returns tokens with no expiry unchanged', async () => {
        const storage = new InMemorySecureStorage();
        const mgr = new CredentialsManager({
            storage,
            refresh: async (_p, t) => ({ ...t, accessToken: 'NEW' }),
        });
        await mgr.save('anthropic', { accessToken: 'TIMELESS' });
        const tokens = await mgr.ensureFreshTokens('anthropic');
        expect(tokens.accessToken).toBe('TIMELESS');
    });

    it('deletes credentials', async () => {
        const mgr = new CredentialsManager({
            storage: new InMemorySecureStorage(),
            refresh: async (_p, t) => t,
        });
        await mgr.save('anthropic', { accessToken: 'A' });
        await mgr.delete('anthropic');
        expect(await mgr.load('anthropic')).toBeNull();
    });

    it('lists providers when the backend supports list()', async () => {
        const mgr = new CredentialsManager({
            storage: new InMemorySecureStorage(),
            refresh: async (_p, t) => t,
        });
        await mgr.save('anthropic', { accessToken: 'A' });
        await mgr.save('codex', { accessToken: 'B' });
        expect((await mgr.listProviders()).sort()).toEqual(['anthropic', 'codex']);
    });
});

describe('serialize / parse (P21a)', () => {
    it('round-trips tokens including metadata', () => {
        const tokens: OAuthTokens = {
            accessToken: 'A',
            refreshToken: 'R',
            expiresAt: 1234,
            tokenType: 'Bearer',
            scope: 'x y',
            metadata: { account_id: '42' },
        };
        const raw = serializeCredentials(tokens);
        const back = parseCredentials(raw);
        expect(back).toEqual(tokens);
    });

    it('throws on missing accessToken', () => {
        expect(() => parseCredentials('{"foo":"bar"}')).toThrow(/accessToken/);
    });

    it('filters non-string metadata entries', () => {
        const raw = JSON.stringify({
            accessToken: 'A',
            metadata: { a: 'v', b: 42, c: null },
        });
        const parsed = parseCredentials(raw);
        expect(parsed.metadata).toEqual({ a: 'v' });
    });
});
