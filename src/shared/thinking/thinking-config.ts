// P20a — ThinkingConfig: provider-agnostic configuration for reasoning depth
// (Anthropic `thinking`), effort level (OpenAI/Codex `reasoning_effort`), and
// Anthropic `speed: fast` beta.
//
// This file holds pure logic — default resolution + merge + model-family
// detection. Runtime wiring into provider params lives in P20b.

export type ThinkingMode = 'disabled' | 'adaptive' | 'enabled';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh';

export type FastMode = 'standard' | 'fast';

export interface ThinkingConfig {
    readonly mode: ThinkingMode;
    readonly budgetTokens?: number;
    readonly effort?: EffortLevel;
    readonly fastMode?: FastMode;
}

export const DEFAULT_THINKING_CONFIG: ThinkingConfig = {
    mode: 'disabled',
    fastMode: 'standard',
};

/**
 * Map effort → Anthropic `budget_tokens`. Mirrors OpenClaude's mapping with a
 * slight adjustment for `xhigh` (spec caps at 32k in practice, OpenClaude uses
 * higher values; we keep 32000 to stay within all provider limits).
 */
export function mapEffortToBudgetTokens(effort: EffortLevel | undefined): number {
    switch (effort) {
        case 'low':
            return 2_000;
        case 'medium':
            return 8_000;
        case 'high':
            return 16_000;
        case 'xhigh':
            return 32_000;
        case undefined:
        default:
            return 8_000;
    }
}

/**
 * Certain reasoning-first model families ship with thinking enabled by
 * default (Claude Sonnet 4.x, OpenAI o-series, DeepSeek R1).
 */
export function shouldEnableThinkingByDefault(model: string): Partial<ThinkingConfig> {
    const lower = model.toLowerCase();
    if (/^o\d/.test(lower) || lower.startsWith('gpt-5.1') || lower.startsWith('gpt-5-codex')) {
        return { mode: 'enabled', effort: 'medium' };
    }
    if (lower.startsWith('claude-sonnet-4') || lower.startsWith('claude-opus-4')) {
        return { mode: 'adaptive', effort: 'medium' };
    }
    if (lower.includes('deepseek-reasoner') || lower.includes('deepseek-r1')) {
        return { mode: 'enabled', effort: 'medium' };
    }
    if (lower.includes('qwen3') || lower.includes('qwq')) {
        return { mode: 'adaptive', effort: 'medium' };
    }
    return {};
}

/**
 * Resolve the effective ThinkingConfig for a turn:
 *   DEFAULT_THINKING_CONFIG < model defaults < user override.
 *
 * Missing fields in `userOverride` are inherited from model defaults; missing
 * fields in both are inherited from DEFAULT_THINKING_CONFIG.
 */
export function resolveThinking(
    model: string,
    userOverride: Partial<ThinkingConfig> = {},
): ThinkingConfig {
    const modelDefaults = shouldEnableThinkingByDefault(model);
    const merged: Partial<ThinkingConfig> = {
        ...DEFAULT_THINKING_CONFIG,
        ...modelDefaults,
        ...userOverride,
    };
    // If mode is enabled/adaptive and budget missing, derive from effort.
    if (merged.mode !== 'disabled' && merged.budgetTokens === undefined) {
        return {
            mode: merged.mode ?? 'disabled',
            ...(merged.effort !== undefined ? { effort: merged.effort } : {}),
            ...(merged.fastMode !== undefined ? { fastMode: merged.fastMode } : {}),
            budgetTokens: mapEffortToBudgetTokens(merged.effort),
        };
    }
    return {
        mode: merged.mode ?? 'disabled',
        ...(merged.budgetTokens !== undefined ? { budgetTokens: merged.budgetTokens } : {}),
        ...(merged.effort !== undefined ? { effort: merged.effort } : {}),
        ...(merged.fastMode !== undefined ? { fastMode: merged.fastMode } : {}),
    };
}

export function isThinkingEnabled(config: ThinkingConfig): boolean {
    return config.mode === 'enabled' || config.mode === 'adaptive';
}
