// ============================================================
// GitHub Copilot Provider
// 通过 GitHub Copilot API 访问模型
// 参考 OpenCode: internal/llm/provider/copilot.go
// ============================================================

import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig, logger, loadGitHubCopilotToken } from '@xqoder/shared';
import { OpenAIProvider } from './providers/index.js';

const COPILOT_API_BASE = 'https://api.githubcopilot.com';
const COPILOT_DEFAULT_MODEL = 'gpt-4o';

interface CopilotTokenResponse {
    token: string;
    expires_at: number;
}

/**
 * CopilotProvider
 * 通过 GitHub Copilot API 端点访问 AI 模型
 *
 * 认证流程：
 *   1. 获取 GitHub Token（GITHUB_TOKEN 环境变量 或 gh auth token）
 *   2. 用 GitHub Token 换取 Copilot Bearer Token
 *   3. 用 Bearer Token 调用 Copilot OpenAI-compatible API
 *
 * 支持模型：
 *   - gpt-4o              (OpenAI GPT-4o)
 *   - claude-3.5-sonnet    (Anthropic Claude)
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
            apiKey: config.apiKey || 'placeholder', // 会在运行时替换
        }));
    }

    /**
     * 获取或刷新 Copilot Bearer Token
     */
    async ensureBearerToken(): Promise<string> {
        // 如果 token 还有效
        if (this.bearerToken && Date.now() / 1000 < this.tokenExpiresAt - 60) {
            return this.bearerToken;
        }

        const githubToken = this.getGitHubToken();
        if (!githubToken) {
            throw new Error(
                'GitHub Token 未配置。请设置 GITHUB_TOKEN 环境变量，' +
                '或确保 GitHub CLI/Copilot 已认证。',
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
                throw new Error(`Token 交换失败 (${response.status}): ${text}`);
            }

            const data = await response.json() as CopilotTokenResponse;
            this.bearerToken = data.token;
            this.tokenExpiresAt = data.expires_at;

            logger.info('Copilot Bearer Token 已刷新');
            return this.bearerToken;
        } catch (err) {
            throw new Error(
                `无法获取 Copilot Bearer Token: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /**
     * 获取 GitHub Token
     */
    private getGitHubToken(): string | undefined {
        // 1. 环境变量
        const envToken = process.env['GITHUB_TOKEN'];
        if (envToken) return envToken;

        // 2. config 中的 apiKey
        if (this.apiKey && this.apiKey !== 'placeholder') {
            return this.apiKey;
        }

        // 3. VS Code / GitHub Copilot OAuth hosts.json
        const copilotToken = loadGitHubCopilotToken();
        if (copilotToken) return copilotToken;

        // 4. 尝试 gh auth token
        try {
            const { execSync } = require('node:child_process');
            return execSync('gh auth token', { encoding: 'utf-8' }).trim();
        } catch {
            return undefined;
        }
    }
}
