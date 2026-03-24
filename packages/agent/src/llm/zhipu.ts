import type { LLMProviderConfig } from '@xqoder/shared';
import { normalizeLLMConfig } from '@xqoder/shared';
import { OpenAIProvider } from './providers/index.js';

export class ZhipuProvider extends OpenAIProvider {
    readonly name = 'zhipu';

    constructor(config: LLMProviderConfig) {
        super(normalizeLLMConfig({
            ...config,
            provider: 'zhipu',
        }));
    }
}
