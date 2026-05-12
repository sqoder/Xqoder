// P21c — `xqoder login <provider>` CLI.
//
// Starts the configured OAuth flow, persists the resulting tokens, and prints
// a success line. Distinct from `xqoder login` (existing API-key command) —
// routed through the `auth login` subcommand namespace.

import { Command } from 'commander';
import { loginAnthropicConsole, resolveAnthropicOAuthConfig } from '../../shared/auth/providers/anthropic-console.js';
import { loginCodex, resolveCodexOAuthConfig } from '../../shared/auth/providers/codex.js';
import { loginGemini, resolveGeminiOAuthConfig } from '../../shared/auth/providers/gemini.js';
import { loginGitHubDevice, resolveGitHubDeviceFlowConfig } from '../../shared/auth/providers/github-device.js';
import { getSharedCredentialsManager } from '../../application/config/credentials.js';
import type { CredentialsManager, OAuthTokens } from '../../shared/auth/index.js';

type SupportedProvider = 'anthropic' | 'codex' | 'github-models' | 'gemini';

export interface AuthLoginDependencies {
    credentialsManager?: CredentialsManager;
    env?: NodeJS.ProcessEnv;
    writeOutput?: (line: string) => void;
}

function writer(dependencies: AuthLoginDependencies): (line: string) => void {
    return dependencies.writeOutput ?? ((line) => process.stdout.write(line + '\n'));
}

export async function runLogin(
    provider: SupportedProvider,
    dependencies: AuthLoginDependencies = {},
): Promise<{ provider: SupportedProvider; expiresAt?: number }> {
    const env = dependencies.env ?? process.env;
    const write = writer(dependencies);
    let tokens: OAuthTokens;
    switch (provider) {
        case 'anthropic': {
            const config = resolveAnthropicOAuthConfig({}, env);
            write('Anthropic: opening browser for Console OAuth...');
            tokens = await loginAnthropicConsole(config);
            break;
        }
        case 'codex': {
            const config = resolveCodexOAuthConfig({}, env);
            write('Codex: opening browser for OpenAI OAuth...');
            tokens = await loginCodex(config);
            break;
        }
        case 'gemini': {
            const config = resolveGeminiOAuthConfig({}, env);
            write('Gemini: opening browser for Google OAuth...');
            tokens = await loginGemini(config);
            break;
        }
        case 'github-models': {
            const config = resolveGitHubDeviceFlowConfig({
                onPrompt: (prompt) => {
                    write('GitHub Models: open ' + prompt.verificationUri + ' and enter code ' + prompt.userCode);
                },
            }, env);
            tokens = await loginGitHubDevice(config);
            break;
        }
        default: {
            const unknown: never = provider;
            throw new Error('unsupported provider: ' + String(unknown));
        }
    }
    const credentialsManager = dependencies.credentialsManager ?? getSharedCredentialsManager();
    await credentialsManager.save(provider, tokens);
    write('login ok: ' + provider + (tokens.expiresAt ? ' (expires ' + new Date(tokens.expiresAt).toISOString() + ')' : ''));
    const result: { provider: SupportedProvider; expiresAt?: number } = { provider };
    if (tokens.expiresAt !== undefined) result.expiresAt = tokens.expiresAt;
    return result;
}

function toProvider(raw: string): SupportedProvider {
    switch (raw) {
        case 'anthropic':
        case 'codex':
        case 'github-models':
        case 'gemini':
            return raw;
        case 'github':
            return 'github-models';
        default:
            throw new Error('unsupported provider: ' + raw + ' (use anthropic|codex|github-models|gemini)');
    }
}

export function createAuthLoginCommand(dependencies: AuthLoginDependencies = {}): Command {
    return new Command('login')
        .description('OAuth login for an LLM provider (anthropic | codex | github-models | gemini).')
        .argument('<provider>', 'Provider name')
        .action(async (raw: string) => {
            try {
                const provider = toProvider(raw);
                await runLogin(provider, dependencies);
            } catch (error) {
                process.stderr.write('auth login failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
                process.exit(1);
            }
        });
}
