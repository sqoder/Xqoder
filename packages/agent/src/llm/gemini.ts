// ============================================================
// Gemini LLM Provider
// 使用 Google Generative AI 的 OpenAI 兼容端点
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

/**
 * GeminiProvider
 * 通过 Google 的 OpenAI 兼容 API 访问 Gemini 模型
 *
 * 支持模型：
 *   - gemini-2.0-flash     (快速推理)
 *   - gemini-2.0-flash-lite (更轻量)
 *   - gemini-2.5-pro       (最强能力)
 *   - gemini-2.5-flash     (平衡)
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
