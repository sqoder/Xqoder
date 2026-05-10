// P15c — build NormalizedUsage from a ConversationProviderUsage shape.
//
// The full provider-specific normalizer chain lives in src/infra/llm/usage/
// for incoming raw payloads. This helper is the simple application-layer path:
// given the already-shaped ConversationProviderUsage (which carries folded
// promptTokens = regular + cacheRead + cacheCreate plus optional cache buckets)
// plus the provider/model/cost the turn loop already computed, produce a
// NormalizedUsage for telemetry.

import type { NormalizedUsage } from './normalized-usage.js';

export interface ProviderUsageLike {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens?: number;
    readonly cacheReadTokens?: number;
    readonly cacheCreationTokens?: number;
}

export function buildNormalizedUsageFromProviderUsage(input: {
    usage: ProviderUsageLike;
    provider: string;
    model: string;
    costUsd?: number;
}): NormalizedUsage {
    const cacheRead = input.usage.cacheReadTokens ?? 0;
    const cacheCreate = input.usage.cacheCreationTokens ?? 0;
    const regularInput = Math.max(input.usage.promptTokens - cacheRead - cacheCreate, 0);

    return {
        provider: input.provider,
        model: input.model,
        input: regularInput,
        output: input.usage.completionTokens,
        ...(cacheRead > 0 ? { cacheRead } : {}),
        ...(cacheCreate > 0 ? { cacheCreate } : {}),
        ...(typeof input.costUsd === 'number' && Number.isFinite(input.costUsd) && input.costUsd > 0
            ? { costUsd: input.costUsd }
            : {}),
    };
}
