import type { LLMProviderConfig, LLMProviderName } from './llm-types.js';

export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const LOCAL_BASE_URL = 'http://localhost:11434/v1';
export const XAI_BASE_URL = 'https://api.x.ai/v1';
export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

const DEFAULT_MODELS: Record<LLMProviderName, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-3-7-sonnet-latest',
    dashscope: 'qwen-plus',
    gemini: 'gemini-2.0-flash',
    'openai-compatible': 'gpt-4o',
    azure: 'gpt-4o',
    bedrock: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
    copilot: 'gpt-4o',
    vertexai: 'gemini-2.0-flash',
    groq: 'llama-3.3-70b-versatile',
    openrouter: 'openai/gpt-4o',
    local: 'llama3',
    xai: 'grok-3-beta',
    zhipu: 'glm-4-flash',
};

export const SUPPORTED_LLM_PROVIDERS = Object.keys(DEFAULT_MODELS) as LLMProviderName[];

export function getDefaultModelForProvider(provider: LLMProviderName): string {
    return DEFAULT_MODELS[provider];
}

export function getKnownModelsForProvider(provider: LLMProviderName): string[] {
    return [DEFAULT_MODELS[provider]];
}

export function isLLMProviderName(value: string | undefined): value is LLMProviderName {
    return Boolean(value && SUPPORTED_LLM_PROVIDERS.includes(value as LLMProviderName));
}

export function getDefaultBaseUrlForProvider(provider: LLMProviderName): string | undefined {
    switch (provider) {
        case 'dashscope': return DASHSCOPE_BASE_URL;
        case 'gemini': return GEMINI_BASE_URL;
        case 'groq': return GROQ_BASE_URL;
        case 'openrouter': return OPENROUTER_BASE_URL;
        case 'local': return LOCAL_BASE_URL;
        case 'xai': return XAI_BASE_URL;
        case 'zhipu': return ZHIPU_BASE_URL;
        default: return undefined;
    }
}

export function normalizeLLMConfig(
    config: Partial<Omit<LLMProviderConfig, 'provider'>> & Pick<LLMProviderConfig, 'provider'>,
): LLMProviderConfig {
    return {
        provider: config.provider,
        model: config.model ?? getDefaultModelForProvider(config.provider),
        apiKey: config.apiKey ?? '',
        baseUrl: config.baseUrl ?? getDefaultBaseUrlForProvider(config.provider),
        maxTokens: config.maxTokens ?? 4096,
        temperature: config.temperature ?? 0.1,
    };
}
