// Clean-room reimplementation of the LLM withRetry strategy engine inspired by
// Claude Code / OpenClaude's services/api/withRetry.ts behavior.
// No original source code copied.

import { classifyLLMError } from './classify.js';
import type { ClassifiedLLMError, LLMErrorKind } from './errors.js';

/**
 * Maximum retry attempts per error kind. `0` means "classified but never
 * retried; always rethrow". Keep these numbers conservative — the caller can
 * always compose a second policy at a higher layer (e.g. reactive compaction
 * or fallback model selection).
 */
const MAX_ATTEMPTS_BY_KIND: Readonly<Record<LLMErrorKind, number>> = Object.freeze({
    throttle: 5,
    overload: 3,
    oauth401: 1,
    transient: 3,
    stream_idle: 0,
    prompt_too_long: 0,
    fatal: 0,
});

/**
 * Upper bound on any single backoff wait. Prevents a malformed
 * `Retry-After: 9999999` header from stalling a request indefinitely.
 */
const MAX_BACKOFF_MS = 16_000;

/**
 * Dependencies injected into withRetry. Kept small so call sites stay legible
 * and tests can replace everything.
 */
export interface WithRetryDeps {
    providerName: string;
    signal?: AbortSignal;
    /** If true, overload (529) retries are enabled. Background / classifier
     *  calls should pass `false` to avoid amplifying load during incidents. */
    foreground?: boolean;
    /** Called once before an OAuth 401 retry to refresh the token. */
    refreshOauthToken?: () => Promise<void>;
    /** Swap-in for setTimeout-based delay (tests inject a controllable clock). */
    sleep?: (ms: number) => Promise<void>;
    /** Swap-in for the RNG used when adding backoff jitter. */
    random?: () => number;
    /** Observation hook fired before each retry; useful for logging / metrics. */
    onRetry?: (info: {
        attempt: number;
        delayMs: number;
        error: ClassifiedLLMError;
    }) => void;
}

/**
 * Wrap a provider call so socket-level hiccups and provider-side throttling
 * are absorbed transparently. The wrapped function is invoked at least once.
 * On a classified retriable error it waits according to the policy for the
 * error's `kind` and retries, up to `MAX_ATTEMPTS_BY_KIND[kind]` total
 * attempts.
 *
 * Non-retriable classifications (prompt_too_long, stream_idle, fatal) are
 * rethrown as classified errors so callers can dispatch on `kind` instead of
 * inspecting messages. Abort signals take precedence over any retry schedule.
 */
export async function withRetry<T>(
    deps: WithRetryDeps,
    op: () => Promise<T>,
): Promise<T> {
    const sleep = deps.sleep ?? defaultSleep;
    const random = deps.random ?? Math.random;

    let attempt = 0;

    while (true) {
        throwIfAborted(deps.signal);

        try {
            return await op();
        } catch (rawError) {
            const classified = classifyLLMError(rawError, deps.providerName);
            const maxAttempts = MAX_ATTEMPTS_BY_KIND[classified.kind];
            const canRetry =
                attempt < maxAttempts &&
                (classified.kind !== 'overload' || deps.foreground === true);

            if (!canRetry) {
                throw classified;
            }

            if (classified.kind === 'oauth401' && deps.refreshOauthToken) {
                await deps.refreshOauthToken();
            }

            const delayMs = computeDelay(attempt, classified, random);
            deps.onRetry?.({ attempt: attempt + 1, delayMs, error: classified });

            throwIfAborted(deps.signal);
            if (delayMs > 0) {
                await sleep(delayMs);
            }
            attempt += 1;
        }
    }
}

function computeDelay(
    attempt: number,
    classified: ClassifiedLLMError,
    random: () => number,
): number {
    if (classified.kind === 'throttle' && classified.retryAfterMs !== undefined) {
        // Respect Retry-After but clamp to MAX_BACKOFF_MS so a pathological
        // header can't stall the client.
        return clamp(classified.retryAfterMs, 0, MAX_BACKOFF_MS);
    }
    if (classified.kind === 'transient') {
        // Socket-level hiccups deserve an immediate retry: the issue is the
        // connection not the server, and exponential backoff here just means
        // the user stares at a frozen terminal longer.
        return 0;
    }
    return exponentialBackoff(attempt, random);
}

function exponentialBackoff(attempt: number, random: () => number): number {
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
    const jitter = Math.floor(random() * 250);
    return base + jitter;
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

async function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        const reason =
            typeof (signal as { reason?: unknown }).reason === 'string'
                ? (signal as { reason: string }).reason
                : 'aborted';
        throw new DOMException(reason, 'AbortError');
    }
}
