import { describe, expect, it } from 'bun:test';
import { normalizeLLMConfig, resolveLLMProviderCapabilities } from '../../src/infra/shared/index.js';

describe('provider capability matrix', () => {
    it('enables native PDF for OpenAI models with file input support', () => {
        const capabilities = resolveLLMProviderCapabilities(normalizeLLMConfig({
            provider: 'openai',
            model: 'gpt-4.1',
        }));

        expect(capabilities.input).toMatchObject({
            image: true,
            pdf: true,
        });
        expect(capabilities.nativePdf).toBe(true);
        expect(capabilities.openAIFileDataFormat).toBe('base64');

        expect(resolveLLMProviderCapabilities(normalizeLLMConfig({
            provider: 'openai',
            model: 'gpt-5.5',
        })).nativePdf).toBe(true);
    });

    it('keeps DashScope qwen-plus text-only unless explicitly overridden', () => {
        const capabilities = resolveLLMProviderCapabilities(normalizeLLMConfig({
            provider: 'dashscope',
            model: 'qwen-plus',
        }));

        expect(capabilities.input.pdf).toBe(false);
        expect(capabilities.nativePdf).toBe(false);
        expect(capabilities.openAIFileDataFormat).toBe('data-url');
    });

    it('honors explicit modality overrides for custom OpenAI-compatible providers', () => {
        const capabilities = resolveLLMProviderCapabilities(normalizeLLMConfig({
            provider: 'openai-compatible',
            model: 'custom-doc-model',
            modalities: { pdf: true },
        }));

        expect(capabilities.input.pdf).toBe(true);
        expect(capabilities.nativePdf).toBe(true);
    });

    it('does not blindly enable Gemini PDF through the OpenAI-compatible adapter', () => {
        const capabilities = resolveLLMProviderCapabilities(normalizeLLMConfig({
            provider: 'gemini',
            model: 'gemini-2.5-flash',
        }));

        expect(capabilities.input.pdf).toBe(true);
        expect(capabilities.nativePdf).toBe(false);
    });
});
