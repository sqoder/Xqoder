// ============================================================
// xAI LLM Provider
// 使用 OpenAI 兼容端点访问 xAI (Grok) API
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { XAI_BASE_URL } from '@xqoder/shared';
import { OpenAIProvider } from './providers/index.js';

const XAI_DEFAULT_MODEL = 'grok-3-beta';

/**
 * XAIProvider
 * 通过 OpenAI 兼容 API 访问 xAI (Grok) 模型
 *
 * 支持模型：
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
