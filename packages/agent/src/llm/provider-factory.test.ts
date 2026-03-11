import { describe, expect, it } from 'vitest';
import { createLLMProvider } from '../agent.js';
import { DashScopeProvider } from './dashscope.js';
import { OpenAIProvider } from '@xqoder/provider-openai';
import { AnthropicProvider } from '@xqoder/provider-anthropic';
import { GroqProvider } from './groq.js';
import { OpenRouterProvider } from './openrouter.js';
import { LocalProvider } from './local.js';
import { XAIProvider } from './xai.js';

describe('createLLMProvider', () => {
    it('creates a DashScope provider for dashscope configs', () => {
        const provider = createLLMProvider({
            provider: 'dashscope',
            model: 'qwen-plus',
            apiKey: 'test-key',
        });

        expect(provider).toBeInstanceOf(DashScopeProvider);
        expect(provider.name).toBe('dashscope');
    });

    it('keeps existing providers working', () => {
        expect(createLLMProvider({
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'test-key',
        })).toBeInstanceOf(OpenAIProvider);

        expect(createLLMProvider({
            provider: 'anthropic',
            model: 'claude-3-7-sonnet-latest',
            apiKey: 'test-key',
        })).toBeInstanceOf(AnthropicProvider);

        expect(createLLMProvider({
            provider: 'groq',
            model: 'llama-3.3-70b-versatile',
            apiKey: 'test-key',
        })).toBeInstanceOf(GroqProvider);

        expect(createLLMProvider({
            provider: 'openrouter',
            model: 'openai/gpt-4o',
            apiKey: 'test-key',
        })).toBeInstanceOf(OpenRouterProvider);

        expect(createLLMProvider({
            provider: 'local',
            model: 'llama3',
            apiKey: 'test-key',
        })).toBeInstanceOf(LocalProvider);

        expect(createLLMProvider({
            provider: 'xai',
            model: 'grok-3-beta',
            apiKey: 'test-key',
        })).toBeInstanceOf(XAIProvider);
    });
});
