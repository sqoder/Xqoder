// P21b — GitHub Device Flow for GitHub Models.
//
// GitHub uses device flow for CLIs: call device_authorization, display the
// user_code + verification_uri, poll the token endpoint until the user
// completes authorization. No loopback server required.
//
// Client ID is configurable via XQODER_GITHUB_OAUTH_CLIENT_ID.

import {
    pollDeviceToken,
    requestDeviceCode,
    type DeviceAuthorizationResponse,
} from '../device-flow.js';
import { refreshAccessToken } from '../oauth-client.js';
import type { OAuthTokens } from '../types.js';

export interface GitHubDeviceFlowConfig {
    readonly clientId: string;
    readonly deviceAuthorizationEndpoint?: string;
    readonly tokenEndpoint?: string;
    readonly scope?: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly onPrompt?: (prompt: DeviceAuthorizationResponse) => void;
}

const DEFAULT_DEVICE_ENDPOINT = 'https://github.com/login/device/code';
const DEFAULT_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const DEFAULT_SCOPE = 'read:user';

export function resolveGitHubDeviceFlowConfig(
    overrides: Partial<GitHubDeviceFlowConfig> = {},
    env: NodeJS.ProcessEnv = process.env,
): GitHubDeviceFlowConfig {
    const clientId = overrides.clientId ?? env['XQODER_GITHUB_OAUTH_CLIENT_ID'];
    if (!clientId) {
        throw new Error('GitHub OAuth client id not set. Provide XQODER_GITHUB_OAUTH_CLIENT_ID.');
    }
    return {
        clientId,
        deviceAuthorizationEndpoint: overrides.deviceAuthorizationEndpoint ?? DEFAULT_DEVICE_ENDPOINT,
        tokenEndpoint: overrides.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
        scope: overrides.scope ?? DEFAULT_SCOPE,
        ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
        ...(overrides.onPrompt ? { onPrompt: overrides.onPrompt } : {}),
    };
}

export async function loginGitHubDevice(
    config: GitHubDeviceFlowConfig,
): Promise<OAuthTokens> {
    const response = await requestDeviceCode({
        deviceAuthorizationEndpoint: config.deviceAuthorizationEndpoint ?? DEFAULT_DEVICE_ENDPOINT,
        clientId: config.clientId,
        scope: config.scope ?? DEFAULT_SCOPE,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    config.onPrompt?.(response);
    return pollDeviceToken({
        tokenEndpoint: config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
        clientId: config.clientId,
        deviceCode: response.deviceCode,
        intervalSeconds: response.intervalSeconds,
        expiresIn: response.expiresIn,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
}

export async function refreshGitHubDevice(
    tokens: OAuthTokens,
    overrides: Partial<GitHubDeviceFlowConfig> = {},
    env: NodeJS.ProcessEnv = process.env,
): Promise<OAuthTokens> {
    if (!tokens.refreshToken) {
        // GitHub Device Flow tokens are long-lived but do not always carry a
        // refresh_token. When absent, the caller must re-login.
        throw new Error('GitHub Device Flow tokens missing refresh_token — re-login required');
    }
    const config = resolveGitHubDeviceFlowConfig(overrides, env);
    return refreshAccessToken({
        tokenEndpoint: config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
        clientId: config.clientId,
        refreshToken: tokens.refreshToken,
        ...(config.fetch ? { fetch: config.fetch } : {}),
    });
}
