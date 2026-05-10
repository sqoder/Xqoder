import { describe, expect, it } from 'bun:test';
import {
    __resetFastModeCooldownForTests,
    toAnthropicThinkingParams,
    toCodexReasoningParams,
    toOpenAIReasoningEffort,
    triggerFastModeCooldown,
} from '../../../src/shared/thinking/index.js';

describe('toAnthropicThinkingParams (P20b)', () => {
    it('returns empty params when thinking disabled and fast mode standard', () => {
        expect(toAnthropicThinkingParams(undefined)).toEqual({ dropTemperature: false });
        expect(toAnthropicThinkingParams({ mode: 'disabled', fastMode: 'standard' }))
            .toEqual({ dropTemperature: false });
    });

    it('enables thinking with budget derived from effort', () => {
        const params = toAnthropicThinkingParams({ mode: 'enabled', effort: 'high' });
        expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 16_000 });
        expect(params.dropTemperature).toBe(true);
    });

    it('respects explicit budgetTokens over effort-derived default', () => {
        const params = toAnthropicThinkingParams({ mode: 'enabled', effort: 'high', budgetTokens: 4242 });
        expect(params.thinking?.budget_tokens).toBe(4242);
    });

    it('emits speed: fast when fastMode and not cooling down', () => {
        __resetFastModeCooldownForTests();
        const params = toAnthropicThinkingParams({ mode: 'enabled', fastMode: 'fast' });
        expect(params.speed).toBe('fast');
    });

    it('suppresses speed: fast during cooldown', () => {
        __resetFastModeCooldownForTests();
        triggerFastModeCooldown();
        const params = toAnthropicThinkingParams({ mode: 'enabled', fastMode: 'fast' });
        expect(params.speed).toBeUndefined();
        __resetFastModeCooldownForTests();
    });

    it('allows fast mode on top of thinking-disabled config', () => {
        __resetFastModeCooldownForTests();
        const params = toAnthropicThinkingParams({ mode: 'disabled', fastMode: 'fast' });
        expect(params.thinking).toBeUndefined();
        expect(params.speed).toBe('fast');
        expect(params.dropTemperature).toBe(false);
    });
});

describe('toOpenAIReasoningEffort (P20b)', () => {
    it('omits field when no effort is set', () => {
        expect(toOpenAIReasoningEffort(undefined)).toEqual({});
        expect(toOpenAIReasoningEffort({ mode: 'disabled' })).toEqual({});
    });

    it('passes through canonical effort levels', () => {
        expect(toOpenAIReasoningEffort({ mode: 'enabled', effort: 'low' })).toEqual({ reasoning_effort: 'low' });
        expect(toOpenAIReasoningEffort({ mode: 'enabled', effort: 'medium' })).toEqual({ reasoning_effort: 'medium' });
        expect(toOpenAIReasoningEffort({ mode: 'enabled', effort: 'high' })).toEqual({ reasoning_effort: 'high' });
    });

    it('collapses xhigh to high for OpenAI chat completions compat', () => {
        expect(toOpenAIReasoningEffort({ mode: 'enabled', effort: 'xhigh' })).toEqual({ reasoning_effort: 'high' });
    });
});

describe('toCodexReasoningParams (P20b)', () => {
    it('defaults to medium when no override', () => {
        expect(toCodexReasoningParams(undefined)).toEqual({ reasoning: { effort: 'medium' } });
    });

    it('passes through low / medium / high', () => {
        expect(toCodexReasoningParams({ mode: 'enabled', effort: 'low' })).toEqual({ reasoning: { effort: 'low' } });
        expect(toCodexReasoningParams({ mode: 'enabled', effort: 'high' })).toEqual({ reasoning: { effort: 'high' } });
    });

    it('collapses xhigh to high for Codex /responses compat', () => {
        expect(toCodexReasoningParams({ mode: 'enabled', effort: 'xhigh' })).toEqual({ reasoning: { effort: 'high' } });
    });
});
