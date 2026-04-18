// ============================================================
// Gemini LLM Provider
// Uses OpenAI-compatible endpoints for Google Generative AI
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

/**
 * GeminiProvider
 * Accesses Gemini models through Google's OpenAI-compatible API
 *
 * Supported Models:
 *   - gemini-2.0-flash     (Fast inference)
 *   - gemini-2.0-flash-lite (Lighter weight)
 *   - gemini-2.5-pro       (Strongest capability)
 *   - gemini-2.5-flash     (Balanced)
 */
export class GeminiProvider extends OpenAIProvider {
    override readonly name: LLMProviderName = 'gemini';

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'gemini' as LLMProviderConfig['provider'],
            model: config.model || GEMINI_DEFAULT_MODEL,
            baseUrl: config.baseUrl || GEMINI_BASE_URL,
        }));
    }
}
