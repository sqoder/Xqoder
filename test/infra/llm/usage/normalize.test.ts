import { describe, expect, it } from 'bun:test';
import {
    normalizeAnthropic,
    normalizeCodex,
    normalizeGeneric,
    normalizeMinimax,
    normalizeOpenAI,
    normalizeUsage,
} from '../../../../src/infra/llm/usage/index.js';

describe('normalizeUsage (P15a)', () => {
    describe('anthropic', () => {
        it('splits cache_read/cache_creation out of input_tokens when API reports raw shape', () => {
            const raw = {
                input_tokens: 12, // excludes cache
                output_tokens: 8,
                cache_read_input_tokens: 100,
                cache_creation_input_tokens: 50,
            };
            const usage = normalizeAnthropic(raw, 'anthropic', 'claude-3-5-sonnet-20241022');
            expect(usage.input).toBe(12);
            expect(usage.output).toBe(8);
            expect(usage.cacheRead).toBe(100);
            expect(usage.cacheCreate).toBe(50);
        });

        it('subtracts cache buckets when input_tokens has already been folded (internal shape)', () => {
            const raw = {
                promptTokens: 162, // 12 regular + 100 read + 50 create
                completionTokens: 8,
                cacheReadTokens: 100,
                cacheCreationTokens: 50,
            };
            const usage = normalizeAnthropic(raw, 'anthropic', 'claude-3-5-sonnet-20241022');
            expect(usage.input).toBe(12);
            expect(usage.cacheRead).toBe(100);
            expect(usage.cacheCreate).toBe(50);
        });

        it('omits cache fields when zero', () => {
            const usage = normalizeAnthropic(
                { input_tokens: 20, output_tokens: 5 },
                'anthropic',
                'claude-3-5-sonnet-20241022',
            );
            expect(usage.cacheRead).toBeUndefined();
            expect(usage.cacheCreate).toBeUndefined();
        });

        it('dispatches through normalizeUsage by provider alias', () => {
            const usage = normalizeUsage(
                { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 7 },
                'anthropic-bedrock',
                'claude-3-5-sonnet-20241022',
            );
            expect(usage.provider).toBe('anthropic-bedrock');
            expect(usage.input).toBe(10);
            expect(usage.cacheRead).toBe(7);
        });
    });

    describe('openai', () => {
        it('subtracts cached_tokens from prompt_tokens (OpenAI includes cache in prompt)', () => {
            const raw = {
                prompt_tokens: 500,
                completion_tokens: 42,
                total_tokens: 542,
                prompt_tokens_details: { cached_tokens: 400 },
                completion_tokens_details: { reasoning_tokens: 12 },
            };
            const usage = normalizeOpenAI(raw, 'openai', 'gpt-4o');
            expect(usage.input).toBe(100);
            expect(usage.output).toBe(42);
            expect(usage.cacheRead).toBe(400);
            expect(usage.reasoning).toBe(12);
        });

        it('handles missing details object', () => {
            const usage = normalizeOpenAI(
                { prompt_tokens: 10, completion_tokens: 5 },
                'openai',
                'gpt-4o',
            );
            expect(usage.input).toBe(10);
            expect(usage.output).toBe(5);
            expect(usage.cacheRead).toBeUndefined();
        });

        it('maps generic OpenAI-compatible providers through the same path', () => {
            const usage = normalizeUsage(
                { prompt_tokens: 100, completion_tokens: 20 },
                'dashscope',
                'qwen-plus',
            );
            expect(usage.input).toBe(100);
            expect(usage.output).toBe(20);
            expect(usage.provider).toBe('dashscope');
        });
    });

    describe('codex', () => {
        it('parses /responses payload with input_tokens + cached_tokens', () => {
            const raw = {
                input_tokens: 1200,
                output_tokens: 300,
                total_tokens: 1500,
                input_tokens_details: { cached_tokens: 1000 },
                output_tokens_details: { reasoning_tokens: 150 },
            };
            const usage = normalizeCodex(raw, 'codex', 'gpt-5.1-codex');
            expect(usage.input).toBe(200);
            expect(usage.output).toBe(300);
            expect(usage.cacheRead).toBe(1000);
            expect(usage.reasoning).toBe(150);
        });

        it('defaults to zero when Codex returns empty usage', () => {
            const usage = normalizeCodex({}, 'codex', 'gpt-5.1-codex');
            expect(usage.input).toBe(0);
            expect(usage.output).toBe(0);
            expect(usage.cacheRead).toBeUndefined();
            expect(usage.reasoning).toBeUndefined();
        });
    });

    describe('minimax', () => {
        it('reads prompt_tokens / completion_tokens directly when provided', () => {
            const usage = normalizeMinimax(
                { prompt_tokens: 80, completion_tokens: 12, total_tokens: 92 },
                'minimax',
                'abab6.5-chat',
            );
            expect(usage.input).toBe(80);
            expect(usage.output).toBe(12);
        });

        it('falls back to total_tokens when only total is provided', () => {
            const usage = normalizeMinimax(
                { total_tokens: 300 },
                'minimax',
                'abab6.5-chat',
            );
            expect(usage.input).toBe(300);
            expect(usage.output).toBe(0);
        });

        it('accepts snake_case input_tokens variant', () => {
            const usage = normalizeMinimax(
                { input_tokens: 50, output_tokens: 10 },
                'minimax',
                'abab6.5-chat',
            );
            expect(usage.input).toBe(50);
            expect(usage.output).toBe(10);
        });
    });

    describe('generic', () => {
        it('picks up common aliases for unknown providers', () => {
            const usage = normalizeGeneric(
                { promptTokens: 11, completionTokens: 4 },
                'custom-relay',
                'mystery-model',
            );
            expect(usage.input).toBe(11);
            expect(usage.output).toBe(4);
        });

        it('returns zeros on totally unknown shape', () => {
            const usage = normalizeGeneric({}, 'custom', 'custom-model');
            expect(usage).toEqual({
                provider: 'custom',
                model: 'custom-model',
                input: 0,
                output: 0,
            });
        });

        it('dispatches unknown provider names through the generic path', () => {
            const usage = normalizeUsage(
                { prompt_tokens: 1, completion_tokens: 2 },
                'brand-new-provider',
                'custom',
            );
            expect(usage.input).toBe(1);
            expect(usage.output).toBe(2);
        });
    });

    describe('cost attachment', () => {
        it('attaches costUsd when model pricing is known', () => {
            const usage = normalizeUsage(
                { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
                'openai',
                'gpt-4o',
            );
            expect(usage.costUsd).toBeDefined();
            expect(usage.costUsd!).toBeGreaterThan(0);
        });

        it('omits costUsd when model is unknown', () => {
            const usage = normalizeUsage(
                { prompt_tokens: 100, completion_tokens: 50 },
                'custom',
                'totally-unknown-model',
            );
            expect(usage.costUsd).toBeUndefined();
        });

        it('applies cached rate when cacheRead is present', () => {
            const fullRateOnly = normalizeUsage(
                { prompt_tokens: 2_000_000, completion_tokens: 0 },
                'openai',
                'gpt-4o',
            );
            const withCache = normalizeUsage(
                {
                    prompt_tokens: 2_000_000,
                    completion_tokens: 0,
                    prompt_tokens_details: { cached_tokens: 1_000_000 },
                },
                'openai',
                'gpt-4o',
            );
            expect(withCache.costUsd!).toBeLessThan(fullRateOnly.costUsd!);
        });
    });

    describe('ignore malformed input', () => {
        it('never throws on null / undefined / non-object', () => {
            expect(normalizeUsage(null, 'openai', 'gpt-4o').input).toBe(0);
            expect(normalizeUsage(undefined, 'openai', 'gpt-4o').input).toBe(0);
            expect(normalizeUsage([], 'openai', 'gpt-4o').input).toBe(0);
            expect(normalizeUsage('garbage', 'openai', 'gpt-4o').input).toBe(0);
        });
    });
});
