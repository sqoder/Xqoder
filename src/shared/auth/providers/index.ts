// P21b barrel: provider-specific OAuth flows.
export {
    loginAnthropicConsole,
    refreshAnthropicConsole,
    resolveAnthropicOAuthConfig,
    type AnthropicConsoleOAuthConfig,
    type AnthropicConsoleOAuthDeps,
} from './anthropic-console.js';
export {
    loginCodex,
    refreshCodex,
    resolveCodexOAuthConfig,
    type CodexOAuthConfig,
    type CodexOAuthDeps,
} from './codex.js';
export {
    loginGitHubDevice,
    refreshGitHubDevice,
    resolveGitHubDeviceFlowConfig,
    type GitHubDeviceFlowConfig,
} from './github-device.js';
export {
    loginGemini,
    refreshGemini,
    resolveGeminiOAuthConfig,
    type GeminiOAuthConfig,
    type GeminiOAuthDeps,
} from './gemini.js';

import type { OAuthTokens } from '../types.js';

import { refreshAnthropicConsole } from './anthropic-console.js';
import { refreshCodex } from './codex.js';
import { refreshGitHubDevice } from './github-device.js';
import { refreshGemini } from './gemini.js';

/**
 * Dispatch a refresh call based on the provider id saved alongside the tokens.
 * Used by CredentialsManager so the manager itself stays provider-agnostic.
 */
export async function refreshForProvider(
    provider: string,
    tokens: OAuthTokens,
    env: NodeJS.ProcessEnv = process.env,
): Promise<OAuthTokens> {
    switch (provider) {
        case 'anthropic':
        case 'anthropic-console':
            return refreshAnthropicConsole(tokens, {}, env);
        case 'codex':
            return refreshCodex(tokens, {}, env);
        case 'github-models':
        case 'github':
            return refreshGitHubDevice(tokens, {}, env);
        case 'gemini':
            return refreshGemini(tokens, {}, env);
        default:
            throw new Error(`refresh not implemented for provider: ${provider}`);
    }
}
