import { describe, expect, it } from 'vitest';
import {
    createRealLlmE2EConfig,
    getRealLlmE2ESettings,
} from './fix.e2e-utils.js';

describe('fix E2E environment parsing', () => {
    it('stays disabled by default', () => {
        const settings = getRealLlmE2ESettings({});

        expect(settings.enabled).toBe(false);
        expect(settings.fixtures).toEqual(['syntax-error']);
        expect(settings.skipReason).toContain('XQODER_REAL_LLM_E2E=1');
    });

    it('requires an API key when enabled', () => {
        const settings = getRealLlmE2ESettings({
            XQODER_REAL_LLM_E2E: '1',
        });

        expect(settings.enabled).toBe(false);
        expect(settings.skipReason).toContain('API_KEY');
    });

    it('parses provider, fixtures, and attempts from env', () => {
        const settings = getRealLlmE2ESettings({
            XQODER_REAL_LLM_E2E: '1',
            XQODER_E2E_API_KEY: 'test-key',
            XQODER_E2E_PROVIDER: 'openai',
            XQODER_E2E_MODEL: 'gpt-4o-mini',
            XQODER_E2E_FIXTURES: 'syntax-error,missing-local-module,unknown',
            XQODER_E2E_MAX_ATTEMPTS: '4',
        });

        expect(settings.enabled).toBe(true);
        expect(settings.fixtures).toEqual(['syntax-error', 'missing-local-module']);
        expect(settings.maxAttempts).toBe(4);
        expect(settings.llmConfig).toMatchObject({
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: 'test-key',
        });
    });

    it('supports DashScope-specific defaults and API key env', () => {
        const settings = getRealLlmE2ESettings({
            XQODER_REAL_LLM_E2E: '1',
            XQODER_E2E_PROVIDER: 'dashscope',
            DASHSCOPE_API_KEY: 'dashscope-key',
        });

        expect(settings.enabled).toBe(true);
        expect(settings.llmConfig).toMatchObject({
            provider: 'dashscope',
            model: 'qwen-plus',
            apiKey: 'dashscope-key',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        });
    });

    it('creates a config object for enabled settings', () => {
        const config = createRealLlmE2EConfig({
            enabled: true,
            fixtures: ['syntax-error'],
            maxAttempts: 2,
            llmConfig: {
                provider: 'openai',
                model: 'gpt-4o',
                apiKey: 'test-key',
            },
        });

        expect(config.llm.apiKey).toBe('test-key');
        expect(config.debug).toBe(false);
    });
});
