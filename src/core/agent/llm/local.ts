// ============================================================
// Local LLM Provider (Ollama/LM Studio etc)
// Access local models using OpenAI-compatible endpoints
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig, logger } from '@xqoder/shared';
import { LOCAL_BASE_URL } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

const LOCAL_DEFAULT_MODEL = 'llama3';

export interface LocalModelInfo {
    id: string;
    object: string;
    // May have other fields depending on the server (Ollama / LMStudio)
}

/**
 * LocalProvider
 * Accesses local models (e.g., Ollama, LM Studio, vLLM, etc.) via OpenAI-compatible API
 */
export class LocalProvider extends OpenAIProvider {
    override readonly name: LLMProviderName = 'local';

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'local' as LLMProviderConfig['provider'],
            model: config.model || LOCAL_DEFAULT_MODEL,
            baseUrl: config.baseUrl || LOCAL_BASE_URL,
            // Local models usually don't require authentication, or any dummy string will do
            apiKey: config.apiKey || 'dummy',
        }));
    }

    /**
     * Queries the list of available local models
     * @param baseUrl Local OpenAI API endpoint base URL
     */
    static async listModels(baseUrl: string = LOCAL_BASE_URL): Promise<LocalModelInfo[]> {
        let endpoint = baseUrl;
        // Correct path, usually /v1/models
        if (!endpoint.endsWith('/models')) {
            endpoint = endpoint.replace(/\/$/, '') + '/models';
        }

        try {
            const res = await fetch(endpoint);
            if (!res.ok) {
                logger.warn(`Local model list failed (HTTP ${res.status}): ${endpoint}`);
                return [];
            }
            const data = await res.json() as { data?: LocalModelInfo[] };
            return data.data || [];
        } catch (err) {
            logger.warn(`Local model fetch failed: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
}
