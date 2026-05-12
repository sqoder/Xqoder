import type { LLMProviderConfig, LLMProviderName } from '@xqoder/shared';
import { AgentError, normalizeLLMConfig, getDefaultBaseUrlForProvider, getDefaultModelForProvider } from '@xqoder/shared';
import type { ILLMProvider } from './provider.js';

/**
 * LLM Provider Factory
 * Uses dynamic imports (Lazy Loading) to reduce initial bundle size and decouple dependencies
 */
export async function createLLMProvider(config: LLMProviderConfig): Promise<ILLMProvider> {
    if (shouldUseCodexShim(config)) {
        const { CodexShimProvider } = await import('../../../infra/llm/openai/shim/index.js');
        return new CodexShimProvider(normalizeCompatConfig(config));
    }
    if (shouldUseOpenAIShim(config.provider)) {
        const { OpenAIShimProvider } = await import('../../../infra/llm/openai/shim/index.js');
        return new OpenAIShimProvider(normalizeCompatConfig(config));
    }
    switch (config.provider) {
        case 'openai':
        case 'openai-compatible': {
            const { OpenAIProvider } = await import('@xqoder/provider-openai');
            return new OpenAIProvider(config);
        }
        case 'anthropic': {
            const { AnthropicProvider } = await import('@xqoder/provider-anthropic');
            return new AnthropicProvider(config);
        }
        case 'dashscope': {
            const { DashScopeProvider } = await import('./dashscope.js');
            return new DashScopeProvider(config);
        }
        case 'gemini': {
            const { GeminiProvider } = await import('./gemini.js');
            return new GeminiProvider(config);
        }
        case 'azure': {
            const { AzureOpenAIProvider } = await import('./azure.js');
            return new AzureOpenAIProvider(config);
        }
        case 'bedrock': {
            const { BedrockProvider } = await import('./bedrock.js');
            return new BedrockProvider(config);
        }
        case 'copilot': {
            const { CopilotProvider } = await import('./copilot.js');
            return new CopilotProvider(config);
        }
        case 'vertexai': {
            const { VertexAIProvider } = await import('./vertexai.js');
            return new VertexAIProvider(config);
        }
        case 'groq': {
            const { GroqProvider } = await import('./groq.js');
            return new GroqProvider(config);
        }
        case 'openrouter': {
            const { OpenRouterProvider } = await import('./openrouter.js');
            return new OpenRouterProvider(config);
        }
        case 'local': {
            const { LocalProvider } = await import('./local.js');
            return new LocalProvider(config);
        }
        case 'xai': {
            const { XAIProvider } = await import('./xai.js');
            return new XAIProvider(config);
        }
        default:
            throw new AgentError(`Unsupported LLM Provider: ${String(config.provider)}`);
    }
}

const SHIM_ELIGIBLE_PROVIDERS: ReadonlySet<LLMProviderName> = new Set([
    'openai',
    'openai-compatible',
    'dashscope',
    'groq',
    'openrouter',
    'xai',
    'local',
]);

function shouldUseOpenAIShim(provider: LLMProviderName): boolean {
    if (!SHIM_ELIGIBLE_PROVIDERS.has(provider)) return false;
    const flag = process.env.XQODER_USE_OPENAI_SHIM;
    return flag === '1' || flag === 'true';
}

const CODEX_MODEL_PATTERN = /^(?:codexplan|gpt-5(?:\.\d+)?(?:-codex)?|o\d+-codex)(?:[-._].*)?$/i;

function shouldUseCodexShim(config: LLMProviderConfig): boolean {
    const flag = process.env.XQODER_FEATURE_CODEX_SHIM;
    if (flag !== '1' && flag !== 'true') return false;
    if (config.provider !== 'openai' && config.provider !== 'openai-compatible') return false;
    const model = (config.model ?? '').trim();
    if (!model) return false;
    return CODEX_MODEL_PATTERN.test(model);
}

function normalizeCompatConfig(config: LLMProviderConfig): LLMProviderConfig {
    return normalizeLLMConfig({
        ...config,
        model: config.model || getDefaultModelForProvider(config.provider),
        baseUrl: config.baseUrl || getDefaultBaseUrlForProvider(config.provider),
        apiKey: config.apiKey || (config.provider === 'local' ? 'dummy' : ''),
    });
}
