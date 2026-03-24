// ============================================================
// Azure OpenAI Provider
// 使用 Azure OpenAI Service 端点
// 参考 OpenCode: internal/llm/provider/azure.go
// ============================================================

import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { OpenAIProvider } from './providers/index.js';

/**
 * AzureOpenAIProvider
 * 通过 Azure OpenAI Service 端点访问 OpenAI 模型
 *
 * 环境变量：
 *   - AZURE_OPENAI_ENDPOINT   — Azure 端点 (https://xxx.openai.azure.com)
 *   - AZURE_OPENAI_API_KEY    — Azure API Key
 *   - AZURE_OPENAI_API_VERSION — API 版本 (e.g., 2025-04-01-preview)
 *
 * Base URL 格式：
 *   https://{resource}.openai.azure.com/openai/deployments/{deployment}/
 */
export class AzureOpenAIProvider extends OpenAIProvider {
    override readonly name = 'azure';

    constructor(config: LLMProviderConfig) {
        const endpoint = config.baseUrl
            ?? process.env['AZURE_OPENAI_ENDPOINT']
            ?? '';
        const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2025-04-01-preview';
        const apiKey = config.apiKey
            ?? process.env['AZURE_OPENAI_API_KEY']
            ?? '';

        // Azure 端点格式需要加上 /openai/deployments/{model}
        const baseUrl = endpoint.endsWith('/')
            ? `${endpoint}openai/deployments/${config.model}`
            : `${endpoint}/openai/deployments/${config.model}`;

        super(normalizeLLMConfig({
            ...config,
            provider: 'azure' as LLMProviderConfig['provider'],
            apiKey,
            baseUrl: `${baseUrl}?api-version=${apiVersion}`,
        }));
    }
}
