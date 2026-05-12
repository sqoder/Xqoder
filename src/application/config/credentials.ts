// P21c — Default CredentialsManager factory.
//
// Assembles the CredentialsManager with:
//   - EncryptedFileStorage at ~/.xqoder/credentials (~/.xqoder/master.key)
//   - refreshForProvider as the refresh dispatch
//
// Application layer code uses this when it needs to hydrate provider
// credentials or refresh after a 401.

import { getXQoderPaths } from '@xqoder/shared';
import {
    CredentialsManager,
    EncryptedFileStorage,
    type OAuthTokens,
    type SecureStorage,
} from '../../shared/auth/index.js';
import { refreshForProvider } from '../../shared/auth/providers/index.js';

export interface DefaultCredentialsManagerOptions {
    readonly homeDir?: string;
    readonly storage?: SecureStorage;
    readonly env?: NodeJS.ProcessEnv;
    readonly refresh?: (provider: string, tokens: OAuthTokens) => Promise<OAuthTokens>;
}

export function createDefaultCredentialsManager(
    options: DefaultCredentialsManagerOptions = {},
): CredentialsManager {
    const paths = getXQoderPaths(options.homeDir);
    const storage = options.storage ?? new EncryptedFileStorage({
        directory: paths.credentialsDir,
        masterKeyPath: paths.masterKeyFile,
    });
    const env = options.env ?? process.env;
    const refresh = options.refresh
        ?? ((provider, tokens) => refreshForProvider(provider, tokens, env));
    return new CredentialsManager({ storage, refresh });
}

let sharedManager: CredentialsManager | undefined;

/**
 * Process-wide CredentialsManager. Callers that do not need a custom
 * SecureStorage can share this instance to avoid re-reading the master key
 * on every provider bootstrap.
 */
export function getSharedCredentialsManager(): CredentialsManager {
    if (!sharedManager) sharedManager = createDefaultCredentialsManager();
    return sharedManager;
}

/** Test seam only. */
export function __resetSharedCredentialsManagerForTests(): void {
    sharedManager = undefined;
}
