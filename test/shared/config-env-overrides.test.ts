import { describe, expect, it } from 'bun:test';
import { createDefaultConfig } from '../../src/infra/shared/config-defaults.js';
import {
    DASHSCOPE_BASE_URL,
    OPENROUTER_BASE_URL,
    getDefaultBaseUrlForProvider,
} from '../../src/infra/shared/llm.js';
import { normalizeXQoderConfig } from '../../src/infra/shared/config-normalizers.js';
import { resolveConfigWithEnvOverrides } from '../../src/infra/shared/config.js';
import { normalizeLLMConfig } from '../../src/infra/shared/llm.js';

// Build a base config that has dashscope as the active provider (simulates a
// user who previously ran with dashscope and whose ~/.xqoder/config.json has
// llm.provider = 'dashscope' and llm.baseUrl = DASHSCOPE_BASE_URL).
function makeDashscopeBaseConfig() {
    const base = createDefaultConfig({});
    return normalizeXQoderConfig({
        ...base,
        llm: normalizeLLMConfig({ provider: 'dashscope' }),
        providers: {
            ...base.providers,
            dashscope: {
                apiKey: 'test-dashscope-key',
                defaultModel: 'qwen-plus',
                baseUrl: DASHSCOPE_BASE_URL,
                disabled: false,
            },
        },
    });
}

describe('resolveConfigWithEnvOverrides — provider switch', () => {
    it('Bug 1: switching XQODER_LLM_PROVIDER to openrouter clears dashscope baseUrl', () => {
        const base = makeDashscopeBaseConfig();
        // Sanity: base config really has dashscope URL
        expect(base.llm.baseUrl).toBe(DASHSCOPE_BASE_URL);

        const { config } = resolveConfigWithEnvOverrides(base, {
            XQODER_LLM_PROVIDER: 'openrouter',
            XQODER_LLM_API_KEY: 'test-openrouter-key',
        });

        // After switching to openrouter WITHOUT an explicit XQODER_LLM_BASE_URL,
        // the resolved baseUrl must be openrouter's default, NOT dashscope's.
        expect(config.llm.provider).toBe('openrouter');
        expect(config.llm.baseUrl).toBe(OPENROUTER_BASE_URL);
        expect(config.llm.baseUrl).not.toBe(DASHSCOPE_BASE_URL);
    });

    it('Bug 1: switching XQODER_LLM_PROVIDER to anthropic clears dashscope baseUrl', () => {
        const base = makeDashscopeBaseConfig();

        const { config } = resolveConfigWithEnvOverrides(base, {
            XQODER_LLM_PROVIDER: 'anthropic',
            XQODER_LLM_API_KEY: 'test-anthropic-key',
        });

        expect(config.llm.provider).toBe('anthropic');
        // anthropic has no custom baseUrl (uses SDK default), so baseUrl should be undefined
        expect(config.llm.baseUrl).toBeUndefined();
        expect(config.llm.baseUrl).not.toBe(DASHSCOPE_BASE_URL);
    });

    it('explicit XQODER_LLM_BASE_URL is respected even when provider changes', () => {
        const base = makeDashscopeBaseConfig();
        const customUrl = 'https://my-proxy.example.com/v1';

        const { config } = resolveConfigWithEnvOverrides(base, {
            XQODER_LLM_PROVIDER: 'openrouter',
            XQODER_LLM_API_KEY: 'test-openrouter-key',
            XQODER_LLM_BASE_URL: customUrl,
        });

        expect(config.llm.provider).toBe('openrouter');
        expect(config.llm.baseUrl).toBe(customUrl);
    });

    it('no provider change keeps existing baseUrl', () => {
        const base = makeDashscopeBaseConfig();

        const { config } = resolveConfigWithEnvOverrides(base, {
            XQODER_LLM_MODEL: 'qwen-max',
        });

        expect(config.llm.provider).toBe('dashscope');
        expect(config.llm.baseUrl).toBe(DASHSCOPE_BASE_URL);
    });
});

describe('resolveConfigWithEnvOverrides — default provider entries', () => {
    it('Bug 1b: openrouter provider entry is created with correct baseUrl when switching', () => {
        const base = makeDashscopeBaseConfig();

        const { config } = resolveConfigWithEnvOverrides(base, {
            XQODER_LLM_PROVIDER: 'openrouter',
            XQODER_LLM_API_KEY: 'test-openrouter-key',
        });

        const openrouterEntry = config.providers?.openrouter;
        expect(openrouterEntry).toBeDefined();
        expect(openrouterEntry?.disabled).toBe(false);
        // The provider entry's baseUrl should also be openrouter's, not dashscope's
        if (openrouterEntry?.baseUrl !== undefined) {
            expect(openrouterEntry.baseUrl).toBe(OPENROUTER_BASE_URL);
        }
    });

    it('Bug 1b: anthropic provider entry is created when switching', () => {
        const base = makeDashscopeBaseConfig();

        const { config } = resolveConfigWithEnvOverrides(base, {
            XQODER_LLM_PROVIDER: 'anthropic',
            XQODER_LLM_API_KEY: 'test-anthropic-key',
        });

        const anthropicEntry = config.providers?.anthropic;
        expect(anthropicEntry).toBeDefined();
        expect(anthropicEntry?.disabled).toBe(false);
        expect(anthropicEntry?.apiKey).toBe('test-anthropic-key');
    });
});
