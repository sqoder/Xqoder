// ============================================================
// Local LLM Provider (Ollama/LM Studio etc)
// 使用 OpenAI 兼容端点访问本地模型
// ============================================================

import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { normalizeLLMConfig, logger } from '@xqoder/shared';
import { LOCAL_BASE_URL } from '@xqoder/shared';
import { OpenAIProvider } from './providers/index.js';

const LOCAL_DEFAULT_MODEL = 'llama3';

export interface LocalModelInfo {
    id: string;
    object: string;
    // 可能还有其他字段，具体取决于服务端 (Ollama / LMStudio)
}

/**
 * LocalProvider
 * 通过 OpenAI 兼容 API 访问本地模型 (如 Ollama, LM Studio, vLLM 等)
 */
export class LocalProvider extends OpenAIProvider {
    override readonly name: LLMProviderName = 'local';

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'local' as LLMProviderConfig['provider'],
            model: config.model || LOCAL_DEFAULT_MODEL,
            baseUrl: config.baseUrl || LOCAL_BASE_URL,
            // 本地模型通常不需要鉴权，或者随便传个 dummy 字符串即可
            apiKey: config.apiKey || 'dummy',
        }));
    }

    /**
     * 查询本地可用的模型列表
     * @param baseUrl 本地 OpenAI API 端点基址
     */
    static async listModels(baseUrl: string = LOCAL_BASE_URL): Promise<LocalModelInfo[]> {
        let endpoint = baseUrl;
        // 修正路径，通常是 /v1/models
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
