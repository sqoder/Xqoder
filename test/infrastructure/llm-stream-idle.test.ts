// Clean-room tests for the stream idle watchdog.
// Covers createIdleWatchdog timer lifecycle and wrapStream semantics with a
// fully injectable fake timer so tests complete in microseconds.

import { describe, expect, it } from 'bun:test';
import {
    StreamIdleError,
    createIdleWatchdog,
    isClassifiedLLMError,
    wrapStream,
    type IdleWatchdogTimer,
} from '../../src/infra/llm/retry/index.js';

interface FakeTimer extends IdleWatchdogTimer {
    /** Advance virtual time by `ms`, firing any callbacks whose deadline has been reached. */
    advance: (ms: number) => void;
    /** Number of currently-armed timers (for sanity checks). */
    pending: () => number;
}

function makeFakeTimer(): FakeTimer {
    interface Entry {
        handle: number;
        deadline: number;
        fn: () => void;
    }
    let now = 0;
    let nextHandle = 1;
    const entries = new Map<number, Entry>();

    return {
        set: (fn, ms) => {
            const handle = nextHandle++;
            entries.set(handle, { handle, deadline: now + ms, fn });
            return handle;
        },
        clear: (handle) => {
            entries.delete(handle as number);
        },
        advance: (ms) => {
            now += ms;
            for (const entry of [...entries.values()]) {
                if (entry.deadline <= now && entries.has(entry.handle)) {
                    entries.delete(entry.handle);
                    entry.fn();
                }
            }
        },
        pending: () => entries.size,
    };
}

/**
 * Yield to the microtask queue so a Promise.race outcome settles before we
 * assert on it.
 */
function flushMicrotasks(): Promise<void> {
    return Promise.resolve();
}

describe('createIdleWatchdog', () => {
    it('fires StreamIdleError when idleMs elapses without tick', async () => {
        const timer = makeFakeTimer();
        const watchdog = createIdleWatchdog({
            providerName: 'openai',
            idleMs: 120_000,
            timer,
        });

        timer.advance(120_000);

        let caught: unknown;
        try {
            await watchdog.waitForIdle();
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(StreamIdleError);
        expect(isClassifiedLLMError(caught)).toBe(true);
        expect((caught as StreamIdleError).kind).toBe('stream_idle');
        expect((caught as StreamIdleError).idleMs).toBe(120_000);
        watchdog.stop();
    });

    it('does not fire if tick() is called before deadline', async () => {
        const timer = makeFakeTimer();
        const watchdog = createIdleWatchdog({
            providerName: 'anthropic',
            idleMs: 100,
            timer,
        });

        timer.advance(99);
        watchdog.tick(); // reset — deadline is now at t=199
        timer.advance(99);
        // If the timer had not been reset this would have fired by now.
        expect(timer.pending()).toBe(1);

        // Race completes favor the resolved side; we just assert that
        // waitForIdle is still pending by racing against a zero-delay resolve.
        const winner = await Promise.race([
            watchdog.waitForIdle().then(() => 'idle').catch(() => 'idle'),
            Promise.resolve('live'),
        ]);
        expect(winner).toBe('live');

        watchdog.stop();
        expect(timer.pending()).toBe(0);
    });

    it('stop() is idempotent and clears the pending timer', () => {
        const timer = makeFakeTimer();
        const watchdog = createIdleWatchdog({
            providerName: 'openai',
            idleMs: 100,
            timer,
        });
        expect(timer.pending()).toBe(1);
        watchdog.stop();
        expect(timer.pending()).toBe(0);
        watchdog.stop();
        expect(timer.pending()).toBe(0);
    });

    it('tick after stop() is a no-op', () => {
        const timer = makeFakeTimer();
        const watchdog = createIdleWatchdog({
            providerName: 'openai',
            idleMs: 100,
            timer,
        });
        watchdog.stop();
        watchdog.tick();
        expect(timer.pending()).toBe(0);
    });
});

async function* fromSteps<T>(
    steps: Array<{ kind: 'value'; value: T } | { kind: 'throw'; err: Error }>,
): AsyncGenerator<T, void, void> {
    for (const step of steps) {
        if (step.kind === 'throw') {
            throw step.err;
        }
        yield step.value;
    }
}

describe('wrapStream', () => {
    it('passes through values when source produces before idle', async () => {
        const timer = makeFakeTimer();
        const source = fromSteps<number>([
            { kind: 'value', value: 1 },
            { kind: 'value', value: 2 },
            { kind: 'value', value: 3 },
        ]);
        const collected: number[] = [];
        for await (const v of wrapStream(source, {
            providerName: 'openai',
            idleMs: 1000,
            timer,
        })) {
            collected.push(v);
        }
        expect(collected).toEqual([1, 2, 3]);
        expect(timer.pending()).toBe(0);
    });

    it('throws StreamIdleError when the source never yields a chunk', async () => {
        const timer = makeFakeTimer();
        // Source that blocks forever: its AsyncIterator.next() never resolves.
        const neverSource: AsyncIterable<number> = {
            [Symbol.asyncIterator]() {
                return {
                    next: () => new Promise<IteratorResult<number>>(() => {
                        /* never resolves */
                    }),
                    return: async () => ({ done: true as const, value: undefined }),
                };
            },
        };

        const iterator = wrapStream(neverSource, {
            providerName: 'openai',
            idleMs: 120_000,
            timer,
        })[Symbol.asyncIterator]();

        const pending = iterator.next();
        timer.advance(120_000);

        let caught: unknown;
        try {
            await pending;
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(StreamIdleError);
        expect((caught as StreamIdleError).idleMs).toBe(120_000);
    });

    it('closes the underlying iterator via iterator.return() on idle', async () => {
        const timer = makeFakeTimer();
        let returnCalled = 0;
        const source: AsyncIterable<number> = {
            [Symbol.asyncIterator]() {
                return {
                    next: () => new Promise<IteratorResult<number>>(() => {
                        /* never resolves */
                    }),
                    return: async () => {
                        returnCalled += 1;
                        return { done: true as const, value: undefined };
                    },
                };
            },
        };

        const iterator = wrapStream(source, {
            providerName: 'openai',
            idleMs: 50,
            timer,
        })[Symbol.asyncIterator]();
        const pending = iterator.next();
        timer.advance(50);
        await pending.catch(() => {
            /* expected StreamIdleError — awaiting here ensures the generator's
             * finally block (which calls iterator.return()) has run. */
        });
        expect(returnCalled).toBe(1);
    });

    it('propagates errors thrown by the source without wrapping', async () => {
        const timer = makeFakeTimer();
        const boom = new Error('upstream boom');
        const source = fromSteps<number>([
            { kind: 'value', value: 1 },
            { kind: 'throw', err: boom },
        ]);

        let caught: unknown;
        try {
            for await (const _ of wrapStream(source, {
                providerName: 'openai',
                idleMs: 1000,
                timer,
            })) {
                /* consume */
            }
        } catch (err) {
            caught = err;
        }
        expect(caught).toBe(boom);
        expect(timer.pending()).toBe(0);
    });
});
