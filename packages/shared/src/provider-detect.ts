// ============================================================
// Provider Auto-Detection — 根据环境变量自动选择 LLM Provider
// 参考 OpenCode: internal/config/config.go setProviderDefaults()
// ============================================================

import type { LLMProviderName } from './llm-types.js';

interface DetectedProvider {
    provider: LLMProviderName;
    model: string;
    apiKey: string;
}

interface ProviderCandidate {
    provider: LLMProviderName;
    envKey: string;
    defaultModel: string;
}

const PROVIDER_PRIORITY: ProviderCandidate[] = [
    { provider: 'copilot', envKey: 'GITHUB_TOKEN', defaultModel: 'gpt-4o' },
    { provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-20250514' },
    { provider: 'openai', envKey: 'OPENAI_API_KEY', defaultModel: 'gpt-4o' },
    { provider: 'gemini', envKey: 'GEMINI_API_KEY', defaultModel: 'gemini-2.5-pro' },
    { provider: 'groq', envKey: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile' },
    { provider: 'openrouter', envKey: 'OPENROUTER_API_KEY', defaultModel: 'anthropic/claude-sonnet-4' },
    { provider: 'xai', envKey: 'XAI_API_KEY', defaultModel: 'grok-3' },
    { provider: 'zhipu', envKey: 'ZHIPU_API_KEY', defaultModel: 'glm-4-flash' },
    { provider: 'dashscope', envKey: 'DASHSCOPE_API_KEY', defaultModel: 'qwen-max' },
    { provider: 'bedrock', envKey: 'AWS_ACCESS_KEY_ID', defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0' },
    { provider: 'azure', envKey: 'AZURE_OPENAI_API_KEY', defaultModel: 'gpt-4o' },
    { provider: 'vertexai', envKey: 'GOOGLE_APPLICATION_CREDENTIALS', defaultModel: 'gemini-2.5-pro' },
];

/**
 * Detect the best available LLM provider based on environment variables.
 * Returns the first provider whose API key is found in the environment.
 */
export function detectProviderFromEnv(env: NodeJS.ProcessEnv = process.env): DetectedProvider | undefined {
    for (const candidate of PROVIDER_PRIORITY) {
        const apiKey = env[candidate.envKey];
        if (apiKey && apiKey.trim()) {
            return {
                provider: candidate.provider,
                model: candidate.defaultModel,
                apiKey,
            };
        }
    }
    return undefined;
}

/**
 * List all providers that have API keys available in the environment.
 */
export function listAvailableProviders(env: NodeJS.ProcessEnv = process.env): DetectedProvider[] {
    const result: DetectedProvider[] = [];
    for (const candidate of PROVIDER_PRIORITY) {
        const apiKey = env[candidate.envKey];
        if (apiKey && apiKey.trim()) {
            result.push({
                provider: candidate.provider,
                model: candidate.defaultModel,
                apiKey,
            });
        }
    }
    return result;
}

/**
 * Get the default model for a given provider.
 */
export function getDefaultModelForProvider(provider: LLMProviderName): string {
    const candidate = PROVIDER_PRIORITY.find(c => c.provider === provider);
    return candidate?.defaultModel ?? 'gpt-4o';
}
