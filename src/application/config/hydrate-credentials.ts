// P21c — Hydrate an LLMProviderConfig with OAuth credentials when available.
//
// Strategy: look up saved credentials for the provider; if present, run
// ensureFreshTokens (refreshing within the 5-minute window), and return a
// copy of the config with `apiKey` set to the fresh access token. If no
// credentials are stored, returns the input unchanged — preserving the
// existing `xqoder login` pathway via `providers.<name>.apiKey`.
//
// Providers that already have a non-empty apiKey keep it unchanged when
// `preferStoredApiKey` is true (default), matching the order of precedence
// env > config apiKey > OAuth.

import type { LLMProviderConfig } from '@xqoder/shared';
import type { CredentialsManager } from '../../shared/auth/index.js';

export interface HydrateLLMConfigOptions {
    readonly credentialsManager: CredentialsManager;
    readonly preferStoredApiKey?: boolean;
    /** Alias mapping. Default: anthropic → anthropic, codex → codex, github-models → github, gemini → gemini */
    readonly aliasMap?: Record<string, string>;
}

const DEFAULT_ALIAS_MAP: Record<string, string> = {
    anthropic: 'anthropic',
    codex: 'codex',
    'github-models': 'github-models',
    gemini: 'gemini',
};

export async function hydrateLLMConfigFromCredentials(
    config: LLMProviderConfig,
    options: HydrateLLMConfigOptions,
): Promise<LLMProviderConfig> {
    const preferStoredApiKey = options.preferStoredApiKey ?? true;
    if (preferStoredApiKey && config.apiKey && config.apiKey.trim().length > 0) {
        return config;
    }
    const aliasMap = options.aliasMap ?? DEFAULT_ALIAS_MAP;
    const provider = aliasMap[config.provider] ?? config.provider;
    const tokens = await options.credentialsManager.load(provider);
    if (!tokens) return config;
    const fresh = await options.credentialsManager.ensureFreshTokens(provider);
    return { ...config, apiKey: fresh.accessToken };
}
