// ============================================================
// OpenRouter LLM Provider
// 使用 OpenAI 兼容端点访问 OpenRouter 模型聚合 API
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { OPENROUTER_BASE_URL } from '@xqoder/shared';
import { OpenAIProvider } from './providers/index.js';

const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o';

/**
 * OpenRouterProvider
 * 通过 OpenAI 兼容 API 访问 OpenRouter
 *
 * 支持模型：支持 OpenRouter 平台上的所有模型，通过传入 `provider/model-name` 格式即可，例如 `anthropic/claude-3.5-sonnet`
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
