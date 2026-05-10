// P21a — Shared types for OAuth + credentials.

export interface OAuthTokens {
    readonly accessToken: string;
    readonly refreshToken?: string;
    /** ms since epoch. undefined for tokens that do not carry an expiry. */
    readonly expiresAt?: number;
    readonly tokenType?: string;
    readonly scope?: string;
    /** Provider-specific metadata (e.g. codex account id). Opaque to the shared layer. */
    readonly metadata?: Record<string, string>;
}

export interface SecureStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    /** Optional: enumerate keys. Not all backends support this. */
    list?(): Promise<string[]>;
}

export interface CredentialsManagerDependencies {
    storage: SecureStorage;
    /** Current wall-clock time provider (injectable for tests). */
    now?: () => number;
    /** Refresh callback invoked when tokens are within the refresh window. */
    refresh: (provider: string, tokens: OAuthTokens) => Promise<OAuthTokens>;
}

export interface CredentialsSerializer {
    serialize(tokens: OAuthTokens): string;
    parse(raw: string): OAuthTokens;
}

/** Default ms before expiry at which we pre-refresh. Spec: 5 min. */
export const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1000;
