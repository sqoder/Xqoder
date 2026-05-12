// P20b — provider-params mapping for ThinkingConfig.
//
// Pure helpers that translate a ThinkingConfig into provider-specific request
// params. Kept in shared/thinking so infra providers can import without a
// infra → application hop, and so unit tests can drive them without booting
// a real provider.

import type { ThinkingConfig } from './thinking-config.js';
import { isFastModeCoolingDown } from './fast-mode.js';
import { mapEffortToBudgetTokens } from './thinking-config.js';

export interface AnthropicThinkingParams {
    readonly thinking?: { readonly type: 'enabled'; readonly budget_tokens: number };
    readonly speed?: 'fast';
    /** True when Anthropic requires temperature to be dropped (thinking enabled). */
    readonly dropTemperature: boolean;
}

export function toAnthropicThinkingParams(
    config: ThinkingConfig | undefined,
    options: { now?: number } = {},
): AnthropicThinkingParams {
    if (!config || config.mode === 'disabled') {
        if (config?.fastMode === 'fast' && !isFastModeCoolingDown(options.now ?? Date.now())) {
            return { speed: 'fast', dropTemperature: false };
        }
        return { dropTemperature: false };
    }
    const budget = config.budgetTokens ?? mapEffortToBudgetTokens(config.effort);
    const base: AnthropicThinkingParams = {
        thinking: { type: 'enabled', budget_tokens: budget },
        dropTemperature: true,
    };
    if (config.fastMode === 'fast' && !isFastModeCoolingDown(options.now ?? Date.now())) {
        return { ...base, speed: 'fast' };
    }
    return base;
}

export interface OpenAIReasoningEffortParams {
    readonly reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh';
}

/**
 * OpenAI chat completions: `reasoning_effort` low|medium|high (no xhigh).
 * We collapse 'xhigh' → 'high' for compat; 'medium' is the default so we
 * only emit the field when the caller explicitly requested a level.
 */
export function toOpenAIReasoningEffort(
    config: ThinkingConfig | undefined,
): OpenAIReasoningEffortParams {
    if (!config?.effort) return {};
    const effort = config.effort === 'xhigh' ? 'high' : config.effort;
    return { reasoning_effort: effort };
}

export interface CodexReasoningParams {
    readonly reasoning?: { readonly effort: 'low' | 'medium' | 'high' };
}

/**
 * Codex /responses: `reasoning.effort` low|medium|high. 'xhigh' collapses to
 * 'high'. Unlike OpenAI chat completions we always emit because Codex requires
 * a default effort; callers that did not override still get medium.
 */
export function toCodexReasoningParams(
    config: ThinkingConfig | undefined,
): CodexReasoningParams {
    const effort = !config?.effort
        ? 'medium'
        : config.effort === 'xhigh' ? 'high' : config.effort;
    return { reasoning: { effort } };
}
