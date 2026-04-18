// ============================================================
// Groq LLM Provider
// Accesses Groq ultra-fast inference API using OpenAI-compatible endpoints
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { GROQ_BASE_URL } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/**
 * GroqProvider
 * Accesses Groq via OpenAI-compatible API
 *
 * Supported Models:
 *   - llama-3.3-70b-versatile
 *   - qwen-qwq-32b
 *   - llama-4-scout-17b-16e-instruct
 *   - llama-4-maverick-17b-128e-instruct
 *   - deepseek-r1-distill-llama-70b
 */
export class GroqProvider extends OpenAIProvider {
    override readonly name: LLMProviderName = 'groq';

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'groq' as LLMProviderConfig['provider'],
            model: config.model || GROQ_DEFAULT_MODEL,
            baseUrl: config.baseUrl || GROQ_BASE_URL,
        }));
    }
}
