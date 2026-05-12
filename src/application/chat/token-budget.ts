// P09 sub-PR 1: token budget estimator. Lets the query loop detect context
// pressure *before* the provider rejects the request, feeding the snip → micro
// → collapse → autocompact ladder proactively.
//
// No real tokenizer in repo; use the industry ~4-chars-per-token heuristic.
// It under-counts code and over-counts prose but stays within ±30% — enough
// for a "near-exhaustion" trigger.

import type { LLMMessage, ToolCall } from '@xqoder/shared';
import { getContextWindow } from '@xqoder/shared';

export type TokenBudgetReason = 'ok' | 'near' | 'exhausted';

export interface TokenBudgetResult {
    readonly used: number;
    readonly remaining: number;
    readonly contextWindow: number | undefined;
    readonly reason: TokenBudgetReason;
}

export interface EstimateTokenBudgetOptions {
    readonly reserveForCompletion?: number;
    readonly nearThresholdFraction?: number;
}

export const DEFAULT_COMPLETION_RESERVE = 8192;
export const DEFAULT_NEAR_FRACTION = 0.1;
export const CHARS_PER_TOKEN_HEURISTIC = 4;

export function approximateTokens(messages: readonly LLMMessage[]): number {
    let total = 0;
    for (const message of messages) {
        total += charsOfMessage(message);
    }
    return Math.ceil(total / CHARS_PER_TOKEN_HEURISTIC);
}

export function estimateTokenBudget(
    messages: readonly LLMMessage[],
    model: string,
    options: EstimateTokenBudgetOptions = {},
): TokenBudgetResult {
    const used = approximateTokens(messages);
    const contextWindow = getContextWindow(model);
    const reserve = options.reserveForCompletion ?? DEFAULT_COMPLETION_RESERVE;
    const nearFraction = options.nearThresholdFraction ?? DEFAULT_NEAR_FRACTION;

    if (contextWindow === undefined) {
        return { used, remaining: Number.POSITIVE_INFINITY, contextWindow: undefined, reason: 'ok' };
    }

    const remaining = contextWindow - used - reserve;
    const reason: TokenBudgetReason = remaining <= 0
        ? 'exhausted'
        : remaining < contextWindow * nearFraction
            ? 'near'
            : 'ok';

    return { used, remaining, contextWindow, reason };
}

function charsOfMessage(message: LLMMessage): number {
    let chars = message.content?.length ?? 0;
    if (message.thinking) {
        chars += message.thinking.length;
    }
    if (message.toolCalls) {
        for (const toolCall of message.toolCalls) {
            chars += charsOfToolCall(toolCall);
        }
    }
    // Attachments aren't charged here: binary/base64 payloads are tokenized by
    // provider-specific logic (image tokens for vision models) that this
    // char-based heuristic cannot approximate. We intentionally under-count
    // rather than guess.
    return chars;
}

function charsOfToolCall(toolCall: ToolCall): number {
    return (toolCall.name?.length ?? 0) + (toolCall.arguments?.length ?? 0);
}
