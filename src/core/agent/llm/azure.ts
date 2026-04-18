// ============================================================
// Azure OpenAI Provider
// Uses Azure OpenAI Service endpoints
// Reference: internal/llm/provider/azure.go
// ============================================================

import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

/**
 * AzureOpenAIProvider
 * Accesses OpenAI models through Azure OpenAI Service endpoints
 *
 * Environment Variables:
 *   - AZURE_OPENAI_ENDPOINT   — Azure Endpoint (https://xxx.openai.azure.com)
 *   - AZURE_OPENAI_API_KEY    — Azure API Key
 *   - AZURE_OPENAI_API_VERSION — API Version (e.g., 2025-04-01-preview)
 *
 * Base URL Format:
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

        // Azure endpoint format requires adding /openai/deployments/{model}
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
