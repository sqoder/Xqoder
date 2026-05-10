// P09 sub-PR 1: token-budget unit tests.
// Covers char heuristic, context-window lookups, "near"/"exhausted" triggers,
// and reserve/threshold overrides.

import { describe, expect, it } from 'bun:test';
import type { LLMMessage } from '@xqoder/shared';
import {
    CHARS_PER_TOKEN_HEURISTIC,
    DEFAULT_COMPLETION_RESERVE,
    DEFAULT_NEAR_FRACTION,
    approximateTokens,
    estimateTokenBudget,
} from '../../../src/application/chat/token-budget.js';

function sys(content: string): LLMMessage {
    return { role: 'system', content };
}

function user(content: string): LLMMessage {
    return { role: 'user', content };
}

function assistantWithCall(id: string, args: string): LLMMessage {
    return {
        role: 'assistant',
        content: '',
        toolCalls: [{ id, name: 'some_tool', arguments: args }],
    };
}

describe('approximateTokens', () => {
    it('uses 4-chars-per-token heuristic with ceil', () => {
        const msgs = [user('12345678')]; // 8 chars → 2 tokens
        expect(approximateTokens(msgs)).toBe(2);
    });

    it('rounds up partial tokens', () => {
        const msgs = [user('abcde')]; // 5 chars → ceil(5/4) = 2
        expect(approximateTokens(msgs)).toBe(2);
    });

    it('sums chars across content, thinking, and tool call arguments', () => {
        const msgs: LLMMessage[] = [
            { role: 'assistant', content: 'aaaa', thinking: 'bbbb' },
            assistantWithCall('call_1', '{"x":"ccc"}'),
        ];
        // 4 + 4 + (len('some_tool')=9) + (len('{"x":"ccc"}')=11) = 28 chars → 7 tokens
        expect(approximateTokens(msgs)).toBe(Math.ceil(28 / CHARS_PER_TOKEN_HEURISTIC));
    });

    it('handles empty message list', () => {
        expect(approximateTokens([])).toBe(0);
    });
});

describe('estimateTokenBudget', () => {
    it('reports ok when plenty of headroom remains (gpt-4o, 128k window)', () => {
        const msgs = [sys('short'), user('hello')];
        const result = estimateTokenBudget(msgs, 'gpt-4o');
        expect(result.reason).toBe('ok');
        expect(result.contextWindow).toBe(128000);
        expect(result.remaining).toBe(128000 - result.used - DEFAULT_COMPLETION_RESERVE);
    });

    it('reports exhausted when content alone exceeds the window minus reserve', () => {
        const huge = 'x'.repeat(128000 * 4); // ~128k tokens at 4 chars/token
        const result = estimateTokenBudget([user(huge)], 'gpt-4o');
        expect(result.reason).toBe('exhausted');
        expect(result.remaining).toBeLessThanOrEqual(0);
    });

    it('reports near when remaining < nearThresholdFraction * window', () => {
        // 128k window, default near = 10% = 12.8k. We need remaining in (0, 12800).
        // Aim for used such that: remaining = 128000 - used - 8192 = 1000.
        // → used = 128000 - 8192 - 1000 = 118808 tokens → 475232 chars.
        const chars = (128000 - DEFAULT_COMPLETION_RESERVE - 1000) * CHARS_PER_TOKEN_HEURISTIC;
        const result = estimateTokenBudget([user('x'.repeat(chars))], 'gpt-4o');
        expect(result.reason).toBe('near');
        expect(result.remaining).toBeGreaterThan(0);
    });

    it('returns reason=ok with infinite remaining when the model has no known window', () => {
        const result = estimateTokenBudget([user('x'.repeat(100))], 'mystery-model-9000');
        expect(result.reason).toBe('ok');
        expect(result.contextWindow).toBeUndefined();
        expect(result.remaining).toBe(Number.POSITIVE_INFINITY);
    });

    it('respects a custom reserveForCompletion', () => {
        const msgs = [user('a'.repeat(400))]; // 100 tokens
        const small = estimateTokenBudget(msgs, 'gpt-4o', { reserveForCompletion: 0 });
        const large = estimateTokenBudget(msgs, 'gpt-4o', { reserveForCompletion: 100_000 });
        expect(small.remaining - large.remaining).toBe(100_000);
    });

    it('respects a custom nearThresholdFraction', () => {
        // With the default 10% fraction, the same input reports ok; at 50% it trips "near".
        const used = 100 * CHARS_PER_TOKEN_HEURISTIC;
        const atTenPercent = estimateTokenBudget([user('x'.repeat(used))], 'gpt-4o');
        const atFiftyPercent = estimateTokenBudget(
            [user('x'.repeat(used))],
            'gpt-4o',
            { nearThresholdFraction: 0.95 },
        );
        expect(atTenPercent.reason).toBe('ok');
        expect(atFiftyPercent.reason).toBe('near');
    });

    it('uses the default near fraction constant (sanity check)', () => {
        expect(DEFAULT_NEAR_FRACTION).toBe(0.1);
    });
});
