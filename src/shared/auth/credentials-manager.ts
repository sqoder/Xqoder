// P21a — Credentials manager.
//
// Serializes OAuthTokens to JSON, writes/reads through a SecureStorage, and
// automatically refreshes tokens within the refresh window (5 min by default).
// Pure logic + injected refresh callback; provider-specific OAuth flows live
// in P21b.

import {
    DEFAULT_REFRESH_WINDOW_MS,
    type CredentialsManagerDependencies,
    type OAuthTokens,
} from './types.js';

export class CredentialsManager {
    private readonly storage: CredentialsManagerDependencies['storage'];
    private readonly now: () => number;
    private readonly refresh: CredentialsManagerDependencies['refresh'];
    private readonly refreshWindowMs: number;

    constructor(dependencies: CredentialsManagerDependencies, refreshWindowMs: number = DEFAULT_REFRESH_WINDOW_MS) {
        this.storage = dependencies.storage;
        this.now = dependencies.now ?? (() => Date.now());
        this.refresh = dependencies.refresh;
        this.refreshWindowMs = refreshWindowMs;
    }

    async save(provider: string, tokens: OAuthTokens): Promise<void> {
        await this.storage.set(provider, serialize(tokens));
    }

    async load(provider: string): Promise<OAuthTokens | null> {
        const raw = await this.storage.get(provider);
        return raw ? parse(raw) : null;
    }

    async delete(provider: string): Promise<void> {
        await this.storage.delete(provider);
    }

    /**
     * Returns fresh OAuthTokens. Refreshes when the stored token is within
     * the refresh window (or already expired). Throws if the provider has
     * no stored credentials.
     */
    async ensureFreshTokens(provider: string): Promise<OAuthTokens> {
        const current = await this.load(provider);
        if (!current) {
            throw new NotLoggedInError(provider);
        }
        if (!this.needsRefresh(current)) return current;
        if (!current.refreshToken) {
            throw new RefreshNotPossibleError(provider);
        }
        const refreshed = await this.refresh(provider, current);
        await this.save(provider, refreshed);
        return refreshed;
    }

    async listProviders(): Promise<string[]> {
        if (!this.storage.list) return [];
        return this.storage.list();
    }

    private needsRefresh(tokens: OAuthTokens): boolean {
        if (tokens.expiresAt === undefined) return false;
        return tokens.expiresAt - this.now() <= this.refreshWindowMs;
    }
}

export class NotLoggedInError extends Error {
    constructor(public readonly provider: string) {
        super(`not logged in to ${provider}`);
        this.name = 'NotLoggedInError';
    }
}

export class RefreshNotPossibleError extends Error {
    constructor(public readonly provider: string) {
        super(`${provider} tokens near expiry but no refresh_token is available; re-login required`);
        this.name = 'RefreshNotPossibleError';
    }
}

export function serialize(tokens: OAuthTokens): string {
    return JSON.stringify(tokens);
}

export function parse(raw: string): OAuthTokens {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const accessToken = typeof parsed['accessToken'] === 'string' ? parsed['accessToken'] : undefined;
    if (!accessToken) {
        throw new Error('stored credentials missing accessToken');
    }
    const refreshToken = typeof parsed['refreshToken'] === 'string' ? parsed['refreshToken'] : undefined;
    const expiresAt = typeof parsed['expiresAt'] === 'number' ? parsed['expiresAt'] : undefined;
    const tokenType = typeof parsed['tokenType'] === 'string' ? parsed['tokenType'] : undefined;
    const scope = typeof parsed['scope'] === 'string' ? parsed['scope'] : undefined;
    const metadataRaw = parsed['metadata'];
    const metadata = metadataRaw && typeof metadataRaw === 'object' && !Array.isArray(metadataRaw)
        ? Object.fromEntries(
            Object.entries(metadataRaw as Record<string, unknown>)
                .filter(([, value]) => typeof value === 'string'),
        ) as Record<string, string>
        : undefined;

    return {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(tokenType ? { tokenType } : {}),
        ...(scope ? { scope } : {}),
        ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
}
