import type { LLMProviderConfig } from '@xqoder/shared';
import { AgentError } from '@xqoder/shared';
import type { ILLMProvider } from './provider.js';

/**
 * LLM Provider Factory
 * Uses dynamic imports (Lazy Loading) to reduce initial bundle size and decouple dependencies
 */
export async function createLLMProvider(config: LLMProviderConfig): Promise<ILLMProvider> {
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
