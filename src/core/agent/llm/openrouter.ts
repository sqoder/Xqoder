// ============================================================
// OpenRouter LLM Provider
// Accesses OpenRouter model aggregation API using OpenAI-compatible endpoints
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { OPENROUTER_BASE_URL } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o';

/**
 * OpenRouterProvider
 * Accesses OpenRouter via OpenAI-compatible API
 *
 * Supported Models: All models on the OpenRouter platform, using the `provider/model-name` format, e.g., `anthropic/claude-3.5-sonnet`
 */
export class OpenRouterProvider extends OpenAIProvider {
    override readonly name: LLMProviderName = 'openrouter';

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'openrouter' as LLMProviderConfig['provider'],
            model: config.model || OPENROUTER_DEFAULT_MODEL,
            baseUrl: config.baseUrl || OPENROUTER_BASE_URL,
        }));
    }
}
