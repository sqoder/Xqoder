// Clean-room tests for the LLM retry layer.
// Covers error classification, withRetry policy per kind, AbortSignal,
// Retry-After honoring, OAuth refresh callback, and max-attempt ceilings.

import { describe, expect, it } from 'bun:test';
import {
    FatalLLMError,
    OAuth401Error,
    OverloadError,
    PromptTooLongError,
    ThrottleError,
    TransientIOError,
    classifyLLMError,
    isClassifiedLLMError,
    withRetry,
    type WithRetryDeps,
} from '../../src/infra/llm/retry/index.js';
import { LLMError } from '../../src/infra/shared/errors.js';

function sdkError(partial: Record<string, unknown>): Error & Record<string, unknown> {
    const err = new Error(String(partial.message ?? 'mock error'));
    Object.assign(err, partial);
    return err as Error & Record<string, unknown>;
}

describe('classifyLLMError', () => {
    it('returns TransientIOError for ECONNRESET at the top level', () => {
        const out = classifyLLMError(sdkError({ code: 'ECONNRESET', message: 'socket hangup' }), 'openai');
        expect(out).toBeInstanceOf(TransientIOError);
        expect(out.kind).toBe('transient');
        expect(out).toBeInstanceOf(LLMError);
    });

    it('unwraps transient socket codes nested under .cause', () => {
        const inner = sdkError({ code: 'EPIPE', message: 'pipe broken' });
        const outer = sdkError({ message: 'fetch failed', cause: inner });
        const out = classifyLLMError(outer, 'openai');
        expect(out).toBeInstanceOf(TransientIOError);
    });

    it('classifies 429 with Retry-After header (seconds form)', () => {
        const out = classifyLLMError(
            sdkError({ status: 429, headers: { 'retry-after': '3' }, message: 'rate limited' }),
            'dashscope',
        );
        expect(out).toBeInstanceOf(ThrottleError);
        const throttle = out as ThrottleError;
        expect(throttle.kind).toBe('throttle');
        expect(throttle.retryAfterMs).toBe(3000);
        expect(throttle.httpStatus).toBe(429);
    });

    it('classifies 429 with a Headers-like (.get) instance', () => {
        const headers: { get: (k: string) => string | null } = {
            get: (k) => (k.toLowerCase() === 'retry-after' ? '1.5' : null),
        };
        const out = classifyLLMError(sdkError({ status: 429, headers }), 'openai');
        expect(out).toBeInstanceOf(ThrottleError);
        expect((out as ThrottleError).retryAfterMs).toBe(1500);
    });

    it('classifies 529 overloaded_error as OverloadError', () => {
        const out = classifyLLMError(sdkError({ status: 529, message: 'busy' }), 'anthropic');
        expect(out).toBeInstanceOf(OverloadError);
        expect(out.kind).toBe('overload');
    });

    it('classifies Anthropic body { error.type: "overloaded_error" } as OverloadError', () => {
        const out = classifyLLMError(
            sdkError({ status: 500, error: { type: 'overloaded_error' }, message: 'overloaded' }),
            'anthropic',
        );
        expect(out).toBeInstanceOf(OverloadError);
    });

    it('classifies 401 with Bearer error=invalid_token as OAuth401Error', () => {
        const out = classifyLLMError(
            sdkError({
                status: 401,
                headers: { 'www-authenticate': 'Bearer realm="api", error="invalid_token"' },
                message: 'token expired',
            }),
            'anthropic',
        );
        expect(out).toBeInstanceOf(OAuth401Error);
        expect(out.kind).toBe('oauth401');
    });

    it('classifies plain 401 (no bearer challenge) as FatalLLMError', () => {
        const out = classifyLLMError(sdkError({ status: 401, message: 'bad api key' }), 'openai');
        expect(out).toBeInstanceOf(FatalLLMError);
        expect(out.kind).toBe('fatal');
    });

    it('classifies 400 + "prompt is too long" as PromptTooLongError', () => {
        const out = classifyLLMError(
            sdkError({ status: 400, message: 'prompt is too long: 220000 tokens > 200000' }),
            'anthropic',
        );
        expect(out).toBeInstanceOf(PromptTooLongError);
        expect(out.kind).toBe('prompt_too_long');
    });

    it('classifies 400 + "context length" (OpenAI) as PromptTooLongError', () => {
        const out = classifyLLMError(
            sdkError({ status: 400, message: 'context length exceeded for gpt-4o' }),
            'openai',
        );
        expect(out).toBeInstanceOf(PromptTooLongError);
    });

    it('passes through already-classified errors unchanged', () => {
        const original = new ThrottleError('x', 'openai', { retryAfterMs: 2000, httpStatus: 429 });
        const out = classifyLLMError(original, 'openai');
        expect(out).toBe(original);
    });

    it('falls back to FatalLLMError for unknown 4xx', () => {
        const out = classifyLLMError(sdkError({ status: 403, message: 'forbidden' }), 'openai');
        expect(out).toBeInstanceOf(FatalLLMError);
        expect((out as FatalLLMError).httpStatus).toBe(403);
    });

    it('isClassifiedLLMError narrows correctly', () => {
        const err: unknown = new FatalLLMError('x', 'openai');
        expect(isClassifiedLLMError(err)).toBe(true);
        expect(isClassifiedLLMError(new Error('plain'))).toBe(false);
    });
});

interface MockRunLog {
    readonly attempts: number;
    readonly retries: Array<{ attempt: number; delayMs: number; kind: string }>;
    readonly sleeps: number[];
}

function makeDeps(overrides: Partial<WithRetryDeps> = {}): {
    deps: WithRetryDeps;
    log: MockRunLog;
} {
    const retries: Array<{ attempt: number; delayMs: number; kind: string }> = [];
    const sleeps: number[] = [];
    const deps: WithRetryDeps = {
        providerName: 'openai',
        foreground: true,
        sleep: async (ms) => {
            sleeps.push(ms);
        },
        random: () => 0, // deterministic jitter
        onRetry: (info) => {
            retries.push({ attempt: info.attempt, delayMs: info.delayMs, kind: info.error.kind });
        },
        ...overrides,
    };
    const log: MockRunLog = {
        get attempts() {
            return sleeps.length + 1;
        },
        retries,
        sleeps,
    };
    return { deps, log };
}

describe('withRetry', () => {
    it('resolves immediately when the operation succeeds on first try', async () => {
        const { deps, log } = makeDeps();
        const result = await withRetry(deps, async () => 42);
        expect(result).toBe(42);
        expect(log.sleeps.length).toBe(0);
    });

    it('retries throttle errors using Retry-After', async () => {
        const { deps, log } = makeDeps();
        let calls = 0;
        const result = await withRetry(deps, async () => {
            calls += 1;
            if (calls < 3) {
                throw sdkError({ status: 429, headers: { 'retry-after': '2' } });
            }
            return 'ok';
        });
        expect(result).toBe('ok');
        expect(calls).toBe(3);
        expect(log.sleeps).toEqual([2000, 2000]);
        expect(log.retries[0]?.kind).toBe('throttle');
    });

    it('retries transient socket errors with zero delay (no sleep invoked)', async () => {
        const { deps, log } = makeDeps();
        let calls = 0;
        await withRetry(deps, async () => {
            calls += 1;
            if (calls < 3) throw sdkError({ code: 'ECONNRESET' });
            return 'ok';
        });
        expect(calls).toBe(3);
        // withRetry skips the sleep call when delayMs is 0, so the mock never fires.
        expect(log.sleeps).toEqual([]);
        expect(log.retries.map((r) => r.kind)).toEqual(['transient', 'transient']);
    });

    it('gives up on throttle after 5 retries (6 attempts total)', async () => {
        const { deps, log } = makeDeps();
        let calls = 0;
        const promise = withRetry(deps, async () => {
            calls += 1;
            throw sdkError({ status: 429, headers: { 'retry-after': '0' } });
        });
        await expect(promise).rejects.toBeInstanceOf(ThrottleError);
        expect(calls).toBe(6);
        // 5 retries with retry-after: 0 → 5 onRetry hooks, no sleep calls.
        expect(log.retries.length).toBe(5);
        expect(log.sleeps).toEqual([]);
    });

    it('does not retry overload when foreground=false', async () => {
        const { deps } = makeDeps({ foreground: false });
        let calls = 0;
        await expect(
            withRetry(deps, async () => {
                calls += 1;
                throw sdkError({ status: 529 });
            }),
        ).rejects.toBeInstanceOf(OverloadError);
        expect(calls).toBe(1);
    });

    it('retries overload up to 3 times when foreground=true', async () => {
        const { deps } = makeDeps({ foreground: true });
        let calls = 0;
        await expect(
            withRetry(deps, async () => {
                calls += 1;
                throw sdkError({ status: 529 });
            }),
        ).rejects.toBeInstanceOf(OverloadError);
        expect(calls).toBe(4);
    });

    it('refreshes OAuth token exactly once on 401 and retries', async () => {
        let refreshes = 0;
        const { deps } = makeDeps({
            refreshOauthToken: async () => {
                refreshes += 1;
            },
        });
        let calls = 0;
        const result = await withRetry(deps, async () => {
            calls += 1;
            if (calls === 1) {
                throw sdkError({
                    status: 401,
                    headers: { 'www-authenticate': 'Bearer error="invalid_token"' },
                });
            }
            return 'ok';
        });
        expect(result).toBe('ok');
        expect(refreshes).toBe(1);
        expect(calls).toBe(2);
    });

    it('does not retry prompt_too_long — caller drives reactive compaction', async () => {
        const { deps } = makeDeps();
        let calls = 0;
        await expect(
            withRetry(deps, async () => {
                calls += 1;
                throw sdkError({ status: 400, message: 'prompt is too long' });
            }),
        ).rejects.toBeInstanceOf(PromptTooLongError);
        expect(calls).toBe(1);
    });

    it('rethrows fatal errors immediately', async () => {
        const { deps } = makeDeps();
        let calls = 0;
        await expect(
            withRetry(deps, async () => {
                calls += 1;
                throw sdkError({ status: 403, message: 'forbidden' });
            }),
        ).rejects.toBeInstanceOf(FatalLLMError);
        expect(calls).toBe(1);
    });

    it('aborts before invoking op when signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const { deps } = makeDeps({ signal: controller.signal });
        let calls = 0;
        let caught: unknown;
        try {
            await withRetry(deps, async () => {
                calls += 1;
                return 'should not reach';
            });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(DOMException);
        expect((caught as DOMException).name).toBe('AbortError');
        expect(calls).toBe(0);
    });

    it('aborts between retries', async () => {
        const controller = new AbortController();
        const { deps } = makeDeps({
            signal: controller.signal,
            sleep: async () => {
                controller.abort();
            },
        });
        let calls = 0;
        let caught: unknown;
        try {
            await withRetry(deps, async () => {
                calls += 1;
                throw sdkError({ status: 429, headers: { 'retry-after': '1' } });
            });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(DOMException);
        expect((caught as DOMException).name).toBe('AbortError');
        expect(calls).toBe(1);
    });

    it('clamps oversized Retry-After to MAX_BACKOFF_MS', async () => {
        const { deps, log } = makeDeps();
        let calls = 0;
        await withRetry(deps, async () => {
            calls += 1;
            if (calls < 2) throw sdkError({ status: 429, headers: { 'retry-after': '9999' } });
            return 'ok';
        });
        expect(log.sleeps[0]).toBeLessThanOrEqual(16_000);
    });

    it('uses exponential backoff for throttle without Retry-After', async () => {
        const { deps, log } = makeDeps({ random: () => 0 });
        let calls = 0;
        await withRetry(deps, async () => {
            calls += 1;
            if (calls < 4) throw sdkError({ status: 429 });
            return 'ok';
        });
        // attempts 0..2 -> 1000, 2000, 4000 with random=0 (no jitter)
        expect(log.sleeps).toEqual([1000, 2000, 4000]);
    });
});
