import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { OpenAIProvider } from '@xqoder/provider-openai';

export class DashScopeProvider extends OpenAIProvider {
    readonly name = 'dashscope';

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'dashscope',
        }));
    }
}
