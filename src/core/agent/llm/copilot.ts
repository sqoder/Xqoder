// ============================================================
// GitHub Copilot Provider
// Accesses models through GitHub Copilot API
// Reference: internal/llm/provider/copilot.go
// ============================================================

import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig, logger, loadGitHubCopilotToken } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

const COPILOT_API_BASE = 'https://api.githubcopilot.com';
const COPILOT_DEFAULT_MODEL = 'gpt-4o';

interface CopilotTokenResponse {
    token: string;
    expires_at: number;
}

/**
 * CopilotProvider
 * Accesses AI models through GitHub Copilot API endpoints
 *
 * Authentication Process:
 *   1. Get GitHub Token (GITHUB_TOKEN environment variable or gh auth token)
 *   2. Exchange GitHub Token for Copilot Bearer Token
 *   3. Call Copilot OpenAI-compatible API with the Bearer Token
 *
 * Supported Models:
 *   - gpt-4o              (OpenAI GPT-4o)
 *   - claude-3.5-sonnet    (Anthropic Claude 3.5 Sonnet)
 *   - o3-mini              (OpenAI o3-mini)
 */
export class CopilotProvider extends OpenAIProvider {
    override readonly name = 'copilot';
    private bearerToken?: string;
    private tokenExpiresAt = 0;

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'copilot' as LLMProviderConfig['provider'],
            model: config.model || COPILOT_DEFAULT_MODEL,
            baseUrl: COPILOT_API_BASE,
            apiKey: config.apiKey || 'placeholder', // Replaced at runtime
        }));
    }

    /**
     * Get or refresh Copilot Bearer Token
     */
    async ensureBearerToken(): Promise<string> {
        // If token is still valid
        if (this.bearerToken && Date.now() / 1000 < this.tokenExpiresAt - 60) {
            return this.bearerToken;
        }

        const githubToken = await this.getGitHubToken();
        if (!githubToken) {
            throw new Error(
                'GitHub Token is not configured. Please set GITHUB_TOKEN environment variable, ' +
                'or ensure GitHub CLI/Copilot is authenticated.',
            );
        }

        try {
            const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
                headers: {
                    'Authorization': `Token ${githubToken}`,
                    'User-Agent': 'Xqoder/1.0',
                },
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Token exchange failed (${response.status}): ${text}`);
            }

            const data = await response.json() as CopilotTokenResponse;
            this.bearerToken = data.token;
            this.tokenExpiresAt = data.expires_at;

            logger.info('Copilot Bearer Token refreshed');
            return this.bearerToken;
        } catch (err) {
            throw new Error(
                `Unable to obtain Copilot Bearer Token: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * Get GitHub Token
     */
    private async getGitHubToken(): Promise<string | undefined> {
        // 1. Environment variable
        const envToken = process.env['GITHUB_TOKEN'];
        if (envToken) return envToken;

        // 2. apiKey from config
        if (this.apiKey && this.apiKey !== 'placeholder') {
            return this.apiKey;
        }

        // 3. VS Code / GitHub Copilot OAuth hosts.json
        const copilotToken = loadGitHubCopilotToken();
        if (copilotToken) return copilotToken;

        // 4. Try gh auth token
        try {
            const { execSync } = await import('node:child_process');
            return execSync('gh auth token', { encoding: 'utf-8' }).trim();
        } catch {
            return undefined;
        }
    }
}
