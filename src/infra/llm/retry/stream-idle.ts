// Clean-room implementation of a stream idle watchdog inspired by
// Claude Code / OpenClaude's STREAM_IDLE_MS heartbeat check. No original
// source code copied.
//
// Purpose: turn "SSE hung for > 120s with no chunk" from silent hang into a
// classified StreamIdleError that the caller can switch on (e.g. fall back
// to non-stream). The watchdog is injectable (timer + idleMs) so tests can
// advance a fake clock instead of waiting 120s wall-time.

import { StreamIdleError } from './errors.js';

/**
 * Default idle threshold. Aligns with OpenClaude's STREAM_IDLE_MS and matches
 * the Phase 01 DoD ("stream idle > 120s → StreamIdleError").
 */
export const DEFAULT_STREAM_IDLE_MS = 120_000;

export interface IdleWatchdogTimer {
    set: (fn: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
}

export interface IdleWatchdogOptions {
    providerName: string;
    idleMs?: number;
    /** Swap-in for setTimeout/clearTimeout (tests inject a controllable clock). */
    timer?: IdleWatchdogTimer;
}

export interface IdleWatchdog {
    /** Call on every chunk / event to reset the idle timer. */
    tick: () => void;
    /** Stop the watchdog. Idempotent. Must be called from the caller's finally. */
    stop: () => void;
    /**
     * A promise that rejects with `StreamIdleError` once the idle threshold
     * elapses without `tick()`. Resolves never — intended for `Promise.race`.
     */
    waitForIdle: () => Promise<never>;
}

const DEFAULT_TIMER: IdleWatchdogTimer = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
};

/**
 * Create an idle watchdog that fires `StreamIdleError` when no `tick()` has
 * occurred within `idleMs`. The returned `waitForIdle()` promise is designed
 * to be `Promise.race()`-d against the real work (async iterator `.next()`,
 * `finalMessage()`, etc) so the classified error propagates naturally.
 *
 * The watchdog arms itself immediately on creation; the first chunk must
 * arrive within `idleMs` or the handshake is considered idle.
 */
export function createIdleWatchdog(opts: IdleWatchdogOptions): IdleWatchdog {
    const timer = opts.timer ?? DEFAULT_TIMER;
    const idleMs = opts.idleMs ?? DEFAULT_STREAM_IDLE_MS;

    let handle: unknown = null;
    let stopped = false;
    let idleError: StreamIdleError | null = null;
    const listeners: Array<(err: StreamIdleError) => void> = [];

    const arm = (): void => {
        if (stopped) return;
        handle = timer.set(() => {
            if (stopped) return;
            stopped = true;
            handle = null;
            idleError = new StreamIdleError(
                `stream idle for > ${idleMs}ms on provider ${opts.providerName}`,
                opts.providerName,
                idleMs,
            );
            const snapshot = listeners.splice(0, listeners.length);
            for (const listener of snapshot) {
                listener(idleError);
            }
        }, idleMs);
    };

    const disarm = (): void => {
        if (handle !== null) {
            timer.clear(handle);
            handle = null;
        }
    };

    arm();

    return {
        tick: () => {
            if (stopped) return;
            disarm();
            arm();
        },
        stop: () => {
            if (stopped) return;
            stopped = true;
            disarm();
            // Drop any pending waiters on the floor — they will never resolve
            // because the watchdog was stopped before idle fired. That's the
            // correct semantics: a caller that stops the watchdog has taken
            // responsibility for completing the race some other way.
            listeners.length = 0;
        },
        waitForIdle: () => {
            const promise = new Promise<never>((_resolve, reject) => {
                if (idleError) {
                    reject(idleError);
                    return;
                }
                listeners.push(reject);
            });
            // Attach a silent catch so the Bun/Node runtime does not treat a
            // rejection that arrives a tick before the caller's Promise.race
            // wires up its handler as "unhandledRejection". Consumers are
            // expected to pass this promise to `Promise.race` against their
            // real work; they will see the rejection via the race.
            promise.catch(() => {
                /* noop */
            });
            return promise;
        },
    };
}

/**
 * Wrap an async iterable so each produced chunk resets the idle watchdog.
 * If the source stalls longer than `idleMs`, the wrapper throws
 * `StreamIdleError` and best-effort closes the underlying iterator.
 *
 * This is the right entry point for OpenAI-style `AsyncIterable<Chunk>`
 * streams. Event-emitter streams (Anthropic's MessageStream) should hook
 * `createIdleWatchdog` directly and race `waitForIdle()` against
 * `finalMessage()` — see AnthropicProvider.stream.
 */
export async function* wrapStream<T>(
    source: AsyncIterable<T>,
    opts: IdleWatchdogOptions,
): AsyncGenerator<T, void, void> {
    const watchdog = createIdleWatchdog(opts);
    const iterator = source[Symbol.asyncIterator]();
    try {
        while (true) {
            const result = await Promise.race([iterator.next(), watchdog.waitForIdle()]);
            if (result.done) {
                return;
            }
            watchdog.tick();
            yield result.value;
        }
    } finally {
        watchdog.stop();
        if (typeof iterator.return === 'function') {
            try {
                await iterator.return();
            } catch {
                /* best-effort cleanup; swallow secondary errors */
            }
        }
    }
}
