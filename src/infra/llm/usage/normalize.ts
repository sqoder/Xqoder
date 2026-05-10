// P15a — NormalizedUsage: unified token/cost shape shared across providers.
//
// Each provider reports usage slightly differently (OpenAI flattens everything
// under `usage`, Anthropic splits cache buckets out of input_tokens, Codex
// reports cached_tokens as a nested field, Minimax uses snake_case fields).
// This module normalizes them into a single structure that the cost tracker,
// session totals, and telemetry layer can consume uniformly.
//
// The NormalizedUsage type itself lives in src/shared/telemetry/ so application
// and shared layers can depend on it without a shared → infra hop.

import { calculateCost } from '../../shared/model-costs.js';
import type { NormalizedUsage } from '../../../shared/telemetry/normalized-usage.js';

export type { NormalizedUsage };

const NUMERIC_ZERO = 0;

/**
 * Map a raw provider usage payload into NormalizedUsage.
 *
 * Dispatches by provider name; falls back to a generic "flatten known numeric
 * fields" strategy for custom/unknown providers.
 */
export function normalizeUsage(
    raw: unknown,
    provider: string,
    model: string,
): NormalizedUsage {
    const normalized = dispatchNormalize(raw, provider, model);
    return attachCost(normalized);
}

function dispatchNormalize(raw: unknown, provider: string, model: string): NormalizedUsage {
    const normalizedProvider = provider.toLowerCase();
    switch (normalizedProvider) {
        case 'anthropic':
        case 'anthropic-bedrock':
        case 'anthropic-vertex':
        case 'claude':
            return normalizeAnthropic(raw, provider, model);
        case 'codex':
        case 'codex-shim':
            return normalizeCodex(raw, provider, model);
        case 'minimax':
            return normalizeMinimax(raw, provider, model);
        case 'openai':
        case 'openai-shim':
        case 'dashscope':
        case 'qwen':
        case 'deepseek':
        case 'groq':
        case 'openrouter':
        case 'xai':
            return normalizeOpenAI(raw, provider, model);
        default:
            return normalizeGeneric(raw, provider, model);
    }
}

/**
 * Anthropic usage payload shape:
 *   { input_tokens, output_tokens, cache_read_input_tokens?,
 *     cache_creation_input_tokens? }
 *
 * Anthropic excludes cache tokens from `input_tokens`. We keep `input` as the
 * **regular (non-cached) input** to mirror what gets billed at the full rate,
 * and expose the cache buckets separately. This mirrors the internal shape
 * calculateCost() already expects.
 *
 * Disambiguation: the key name tells us whether the payload is raw Anthropic
 * (snake_case `cache_read_input_tokens`, input excludes cache) or XQoder's
 * folded internal shape (camelCase `cacheReadTokens`, `promptTokens` includes
 * cache). Raw form → no subtraction needed. Folded form → subtract.
 */
export function normalizeAnthropic(raw: unknown, provider: string, model: string): NormalizedUsage {
    const record = asRecord(raw);
    const rawCacheRead = readNumber(record, ['cache_read_input_tokens']) ?? 0;
    const rawCacheCreate = readNumber(record, ['cache_creation_input_tokens']) ?? 0;
    const rawCacheDelete = readNumber(record, ['cache_deletion_input_tokens']) ?? 0;
    const foldedCacheRead = readNumber(record, ['cacheReadInputTokens', 'cacheReadTokens']) ?? 0;
    const foldedCacheCreate = readNumber(record, ['cacheCreationInputTokens', 'cacheCreationTokens']) ?? 0;
    const foldedCacheDelete = readNumber(record, ['cacheDeletionInputTokens']) ?? 0;

    const cacheRead = rawCacheRead + foldedCacheRead;
    const cacheCreate = rawCacheCreate + foldedCacheCreate;
    const cacheDelete = rawCacheDelete + foldedCacheDelete;

    const rawInput = readNumber(record, ['input_tokens']) ?? 0; // raw Anthropic: excludes cache
    const foldedInput = readNumber(record, ['inputTokens', 'promptTokens']) ?? 0; // XQoder internal: includes cache
    const regular = rawInput + Math.max(foldedInput - foldedCacheRead - foldedCacheCreate, 0);

    const output = readNumber(record, ['output_tokens', 'outputTokens', 'completionTokens']) ?? 0;

    return {
        provider,
        model,
        input: regular,
        output,
        ...(cacheRead > 0 ? { cacheRead } : {}),
        ...(cacheCreate > 0 ? { cacheCreate } : {}),
        ...(cacheDelete > 0 ? { cacheDelete } : {}),
    };
}

/**
 * OpenAI-compatible chat/completions payload:
 *   { prompt_tokens, completion_tokens, total_tokens,
 *     prompt_tokens_details?: { cached_tokens?, ... } }
 *
 * OpenAI's prompt_tokens INCLUDES cached_tokens, so we subtract to get the
 * regular-rate bucket. This matches the pricing table's `inputCachedPer1M`
 * applying to cached_tokens only.
 */
export function normalizeOpenAI(raw: unknown, provider: string, model: string): NormalizedUsage {
    const record = asRecord(raw);
    const prompt = readNumber(record, ['prompt_tokens', 'promptTokens']) ?? 0;
    const completion = readNumber(record, ['completion_tokens', 'completionTokens']) ?? 0;
    const details = asRecord(record['prompt_tokens_details'] ?? record['promptTokensDetails']);
    const reasoningDetails = asRecord(record['completion_tokens_details'] ?? record['completionTokensDetails']);
    const cacheRead = readNumber(details, ['cached_tokens', 'cachedTokens']) ?? 0;
    const reasoning = readNumber(reasoningDetails, ['reasoning_tokens', 'reasoningTokens']) ?? 0;
    const input = Math.max(prompt - cacheRead, NUMERIC_ZERO);

    return {
        provider,
        model,
        input,
        output: completion,
        ...(cacheRead > 0 ? { cacheRead } : {}),
        ...(reasoning > 0 ? { reasoning } : {}),
    };
}

/**
 * Codex /responses payload:
 *   { input_tokens, output_tokens, total_tokens,
 *     input_tokens_details?: { cached_tokens? },
 *     output_tokens_details?: { reasoning_tokens? } }
 *
 * Codex uses `input_tokens` for prompt (same semantic as OpenAI's
 * prompt_tokens — includes cached). We subtract cached_tokens to get the
 * regular-rate bucket.
 */
export function normalizeCodex(raw: unknown, provider: string, model: string): NormalizedUsage {
    const record = asRecord(raw);
    const input = readNumber(record, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens']) ?? 0;
    const output = readNumber(record, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens']) ?? 0;
    const inputDetails = asRecord(record['input_tokens_details'] ?? record['inputTokensDetails']);
    const outputDetails = asRecord(record['output_tokens_details'] ?? record['outputTokensDetails']);
    const cacheRead = readNumber(inputDetails, ['cached_tokens', 'cachedTokens']) ?? 0;
    const reasoning = readNumber(outputDetails, ['reasoning_tokens', 'reasoningTokens']) ?? 0;
    const regular = Math.max(input - cacheRead, NUMERIC_ZERO);

    return {
        provider,
        model,
        input: regular,
        output,
        ...(cacheRead > 0 ? { cacheRead } : {}),
        ...(reasoning > 0 ? { reasoning } : {}),
    };
}

/**
 * Minimax chat payload observed in the wild:
 *   { total_tokens, total_characters, input_tokens?, output_tokens?,
 *     prompt_tokens?, completion_tokens? }
 *
 * Minimax does not return any cache bucket; treat prompt_tokens as the full
 * input. Some variants only return total_tokens — in that case we cannot split
 * input/output, so we report the total on `input` and leave `output` at 0.
 */
export function normalizeMinimax(raw: unknown, provider: string, model: string): NormalizedUsage {
    const record = asRecord(raw);
    const input = readNumber(record, ['prompt_tokens', 'promptTokens', 'input_tokens', 'inputTokens']);
    const output = readNumber(record, ['completion_tokens', 'completionTokens', 'output_tokens', 'outputTokens']);
    const total = readNumber(record, ['total_tokens', 'totalTokens']);
    if (input === undefined && output === undefined && total !== undefined) {
        return { provider, model, input: total, output: 0 };
    }
    return {
        provider,
        model,
        input: input ?? 0,
        output: output ?? 0,
    };
}

/**
 * Unknown/custom providers fall back to "pick any numeric field that looks
 * like input/output tokens." Preserves best-effort mapping for non-standard
 * shapes without crashing.
 */
export function normalizeGeneric(raw: unknown, provider: string, model: string): NormalizedUsage {
    const record = asRecord(raw);
    return {
        provider,
        model,
        input: readNumber(record, ['prompt_tokens', 'promptTokens', 'input_tokens', 'inputTokens']) ?? 0,
        output: readNumber(record, ['completion_tokens', 'completionTokens', 'output_tokens', 'outputTokens']) ?? 0,
    };
}

function attachCost(usage: NormalizedUsage): NormalizedUsage {
    // calculateCost expects the "folded" shape (promptTokens = input + cacheRead)
    // so we reconstruct that here without mutating the normalized struct.
    const promptTokens = usage.input + (usage.cacheRead ?? 0);
    const cost = calculateCost(usage.model, {
        promptTokens,
        completionTokens: usage.output,
        ...(usage.cacheRead !== undefined ? { cacheReadTokens: usage.cacheRead } : {}),
        ...(usage.cacheCreate !== undefined ? { cacheCreationTokens: usage.cacheCreate } : {}),
    });
    if (!Number.isFinite(cost) || cost <= 0) {
        return usage;
    }
    return { ...usage, costUsd: cost };
}

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
}

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}
