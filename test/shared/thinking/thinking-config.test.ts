import { describe, expect, it } from 'bun:test';
import {
    DEFAULT_THINKING_CONFIG,
    isThinkingEnabled,
    mapEffortToBudgetTokens,
    resolveThinking,
    shouldEnableThinkingByDefault,
} from '../../../src/shared/thinking/thinking-config.js';

describe('mapEffortToBudgetTokens (P20a)', () => {
    it('maps low/medium/high/xhigh to ascending budgets', () => {
        expect(mapEffortToBudgetTokens('low')).toBe(2_000);
        expect(mapEffortToBudgetTokens('medium')).toBe(8_000);
        expect(mapEffortToBudgetTokens('high')).toBe(16_000);
        expect(mapEffortToBudgetTokens('xhigh')).toBe(32_000);
    });

    it('falls back to medium budget for undefined', () => {
        expect(mapEffortToBudgetTokens(undefined)).toBe(8_000);
    });
});

describe('shouldEnableThinkingByDefault (P20a)', () => {
    it('enables thinking for OpenAI o-series and gpt-5 codex', () => {
        expect(shouldEnableThinkingByDefault('o1')).toEqual({ mode: 'enabled', effort: 'medium' });
        expect(shouldEnableThinkingByDefault('o3-mini')).toEqual({ mode: 'enabled', effort: 'medium' });
        expect(shouldEnableThinkingByDefault('gpt-5.1-codex-preview')).toEqual({ mode: 'enabled', effort: 'medium' });
    });

    it('uses adaptive for Claude sonnet/opus 4.x families', () => {
        expect(shouldEnableThinkingByDefault('claude-sonnet-4-20250514')).toEqual({ mode: 'adaptive', effort: 'medium' });
        expect(shouldEnableThinkingByDefault('claude-opus-4-20250101')).toEqual({ mode: 'adaptive', effort: 'medium' });
    });

    it('enables thinking for DeepSeek R1 and qwen3/qwq families', () => {
        expect(shouldEnableThinkingByDefault('deepseek-reasoner')).toEqual({ mode: 'enabled', effort: 'medium' });
        expect(shouldEnableThinkingByDefault('qwen3-235b-a22b')).toEqual({ mode: 'adaptive', effort: 'medium' });
        expect(shouldEnableThinkingByDefault('qwq-32b-preview')).toEqual({ mode: 'adaptive', effort: 'medium' });
    });

    it('returns empty object for models without thinking defaults', () => {
        expect(shouldEnableThinkingByDefault('gpt-4o')).toEqual({});
        expect(shouldEnableThinkingByDefault('claude-3-5-sonnet-20241022')).toEqual({});
    });
});

describe('resolveThinking (P20a)', () => {
    it('applies DEFAULT_THINKING_CONFIG when no model default and no override', () => {
        const config = resolveThinking('gpt-4o');
        expect(config).toEqual({ mode: 'disabled', fastMode: 'standard' });
    });

    it('derives budgetTokens from effort when mode is enabled', () => {
        const config = resolveThinking('o1', { mode: 'enabled', effort: 'high' });
        expect(config.mode).toBe('enabled');
        expect(config.effort).toBe('high');
        expect(config.budgetTokens).toBe(16_000);
    });

    it('preserves explicit budgetTokens over effort-derived default', () => {
        const config = resolveThinking('o1', { mode: 'enabled', effort: 'high', budgetTokens: 4242 });
        expect(config.budgetTokens).toBe(4242);
    });

    it('merges model defaults with user override (override wins)', () => {
        const config = resolveThinking('claude-sonnet-4-20250514', { effort: 'xhigh' });
        expect(config.mode).toBe('adaptive');
        expect(config.effort).toBe('xhigh');
        expect(config.budgetTokens).toBe(32_000);
    });

    it('leaves budgetTokens undefined when mode is disabled', () => {
        const config = resolveThinking('gpt-4o', { mode: 'disabled', effort: 'high' });
        expect(config.budgetTokens).toBeUndefined();
        expect(config.effort).toBe('high');
    });

    it('propagates fastMode override', () => {
        const config = resolveThinking('claude-sonnet-4-20250514', { fastMode: 'fast' });
        expect(config.fastMode).toBe('fast');
    });
});

describe('isThinkingEnabled (P20a)', () => {
    it('is true for enabled and adaptive', () => {
        expect(isThinkingEnabled({ ...DEFAULT_THINKING_CONFIG, mode: 'enabled' })).toBe(true);
        expect(isThinkingEnabled({ ...DEFAULT_THINKING_CONFIG, mode: 'adaptive' })).toBe(true);
    });

    it('is false for disabled', () => {
        expect(isThinkingEnabled({ ...DEFAULT_THINKING_CONFIG, mode: 'disabled' })).toBe(false);
    });
});
