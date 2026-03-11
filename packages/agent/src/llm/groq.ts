// ============================================================
// Groq LLM Provider
// 使用 OpenAI 兼容端点访问 Groq 极速推理 API
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { GROQ_BASE_URL } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/**
 * GroqProvider
 * 通过 OpenAI 兼容 API 访问 Groq
 *
 * 支持模型：
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
