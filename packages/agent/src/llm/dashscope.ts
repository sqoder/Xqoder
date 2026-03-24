import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { OpenAIProvider } from './providers/index.js';

export class DashScopeProvider extends OpenAIProvider {
    readonly name = 'dashscope';

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'dashscope',
        }));
    }
}
