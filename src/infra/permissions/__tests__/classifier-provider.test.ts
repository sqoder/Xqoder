import { afterEach, describe, expect, it } from 'bun:test';
import type { StreamCallbacks } from '@xqoder/shared';
import type {
    CompletionRequest,
    CompletionResponse,
    ILLMProvider,
} from '../../../shared/llm-api/base.js';
import {
    __setClassifierProviderForTests,
    createClassifierProviderFactory,
    resetClassifierProviderCacheForTests,
} from '../classifier-provider.js';

function fakeProvider(model: string): ILLMProvider {
    return {
        name: 'fake',
        model,
        async complete(_request: CompletionRequest): Promise<CompletionResponse> {
            return {
                message: { role: 'assistant', content: 'noop' },
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                finishReason: 'stop',
            };
        },
        async stream(_r: CompletionRequest, _c: StreamCallbacks): Promise<CompletionResponse> {
            throw new Error('unused');
        },
    };
}

afterEach(() => {
    resetClassifierProviderCacheForTests();
});

describe('classifier-provider factory', () => {
    it('returns undefined when no provider has been warmed', () => {
        const factory = createClassifierProviderFactory();
        expect(factory(1)).toBeUndefined();
        expect(factory(2)).toBeUndefined();
    });

    it('returns the warmed provider for the requested tier', () => {
        const stage1 = fakeProvider('claude-3-5-haiku-latest');
        const stage2 = fakeProvider('claude-3-5-sonnet-latest');
        __setClassifierProviderForTests(1, stage1);
        __setClassifierProviderForTests(2, stage2);

        const factory = createClassifierProviderFactory();
        expect(factory(1)).toBe(stage1);
        expect(factory(2)).toBe(stage2);
    });

    it('resetClassifierProviderCacheForTests clears cache', () => {
        __setClassifierProviderForTests(1, fakeProvider('claude-3-5-haiku-latest'));
        resetClassifierProviderCacheForTests();
        const factory = createClassifierProviderFactory();
        expect(factory(1)).toBeUndefined();
    });
});
