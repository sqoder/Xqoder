// ============================================================
// xAI LLM Provider
// Accesses xAI (Grok) API using OpenAI-compatible endpoints
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { XAI_BASE_URL } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

const XAI_DEFAULT_MODEL = 'grok-3-beta';

/**
 * XAIProvider
 * Accesses xAI (Grok) models through OpenAI-compatible API
 *
 * Supported Models:
 *   - grok-3-beta
 *   - grok-3-mini-beta
 *   - grok-3-fast-beta
 *   - grok-3-mini-fast-beta
 */
export class XAIProvider extends OpenAIProvider {
    override readonly name: LLMProviderName = 'xai';

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'xai' as LLMProviderConfig['provider'],
            model: config.model || XAI_DEFAULT_MODEL,
            baseUrl: config.baseUrl || XAI_BASE_URL,
        }));
    }
}
