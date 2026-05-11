// P19b — Cron scheduler.
//
// Pure-logic core (`tick(now)`) that tests drive by hand, plus a thin
// `start/stop` wrapper that schedules the next `setTimeout` around the
// earliest nextFireAt in the store. No third-party cron library —
// this is ~50 lines of honest scanning.
//
// On each tick we:
//   1. Load all enabled jobs with nextFireAt <= now
//   2. For each: try to claim the (jobId, minute) slot via cron-lock
//   3. If we won the slot, invoke the injected `dispatch` callback
//   4. Whether or not we won, advance nextFireAt via `store.recordFire(id, fireTime)`
//
// `dispatch` is where the task gets materialised and started — kept out of
// this module so tests can use a simple spy and prod can inject the
// task-service + task-runner glue.

import type { CronJob, CronStore } from './cron-store.js';
import type { CronLock } from './cron-lock.js';

export interface CronDispatchRecord {
    jobId: string;
    firedAt: Date;
    job: CronJob;
    error?: Error;
}

export type CronDispatchFn = (
    job: CronJob,
    firedAt: Date,
) => Promise<unknown> | unknown;

export interface CronSchedulerOptions {
    store: CronStore;
    lock: CronLock;
    dispatch: CronDispatchFn;
    /** Defaults to Date.now. Tests inject a clock. */
    now?: () => Date;
    /** Logging hook — defaults to a no-op. */
    logger?: {
        warn?: (msg: string, meta?: Record<string, unknown>) => void;
        info?: (msg: string, meta?: Record<string, unknown>) => void;
    };
    /** Upper bound on setTimeout(ms). Node caps at 2^31-1; we default to 1h
     * so long-dormant jobs re-tick and pick up config changes. */
    maxIdleMs?: number;
}

export interface CronScheduler {
    /** Scan and fire all due jobs at `at`. Returns per-job records. */
    tick(at?: Date): Promise<CronDispatchRecord[]>;
    /** Start the setTimeout-driven loop. No-op if already running. */
    start(): void;
    /** Clear any pending timer. Idempotent. */
    stop(): void;
    /** Is the timer-driven loop active right now? */
    isRunning(): boolean;
}

export const DEFAULT_CRON_IDLE_MS = 60 * 60_000; // 1 hour

export function createCronScheduler(options: CronSchedulerOptions): CronScheduler {
    const { store, lock, dispatch } = options;
    const now = options.now ?? (() => new Date());
    const logger = options.logger ?? {};
    const maxIdleMs = options.maxIdleMs ?? DEFAULT_CRON_IDLE_MS;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;

    async function tick(at?: Date): Promise<CronDispatchRecord[]> {
        const when = at ?? now();
        const due = store
            .list({ enabled: true })
            .filter((job) => job.nextFireAt && job.nextFireAt.getTime() <= when.getTime());

        const records: CronDispatchRecord[] = [];
        for (const job of due) {
            const fireAt = job.nextFireAt ?? when;
            let won = false;
            try {
                won = lock.tryAcquire(job.id, fireAt);
            } catch (err) {
                logger.warn?.('cron: lock error', {
                    jobId: job.id,
                    err: err instanceof Error ? err.message : String(err),
                });
            }

            let dispatchErr: Error | undefined;
            if (won) {
                try {
                    await dispatch(job, fireAt);
                } catch (err) {
                    dispatchErr = err instanceof Error ? err : new Error(String(err));
                    logger.warn?.('cron: dispatch error', {
                        jobId: job.id,
                        err: dispatchErr.message,
                    });
                }
            }

            // Always advance nextFireAt — if we didn't win the lock, the peer
            // that did will also advance, and both advances converge on the
            // same next minute.
            try {
                store.recordFire(job.id, fireAt);
            } catch (err) {
                logger.warn?.('cron: recordFire failed', {
                    jobId: job.id,
                    err: err instanceof Error ? err.message : String(err),
                });
            }

            records.push({
                jobId: job.id,
                firedAt: fireAt,
                job,
                error: dispatchErr,
            });
        }
        return records;
    }

    function scheduleNext(): void {
        if (!running) return;
        const jobs = store.list({ enabled: true });
        const current = now().getTime();
        let earliest = current + maxIdleMs;
        for (const job of jobs) {
            if (job.nextFireAt) {
                const t = job.nextFireAt.getTime();
                if (t < earliest) earliest = t;
            }
        }
        // If next fire is already in the past, fire on the next macrotask.
        const delay = Math.max(0, earliest - current);
        // Node's setTimeout caps at ~24.8d; our maxIdleMs default is well
        // under that, but clamp defensively.
        const clamped = Math.min(delay, 2_147_483_000);
        timer = setTimeout(() => {
            void (async () => {
                try {
                    await tick();
                } catch (err) {
                    logger.warn?.('cron: tick failed', {
                        err: err instanceof Error ? err.message : String(err),
                    });
                }
                if (running) {
                    scheduleNext();
                }
            })();
        }, clamped);
        // Don't keep the event loop alive for the cron tick — the main REPL /
        // daemon will own liveness. Without `unref`, a long idle timer would
        // block `process.exit()` cleanup in short-lived CLIs that happened to
        // instantiate the scheduler.
        if (typeof timer === 'object' && timer && 'unref' in timer) {
            (timer as { unref?: () => void }).unref?.();
        }
    }

    return {
        tick,
        start() {
            if (running) return;
            running = true;
            scheduleNext();
        },
        stop() {
            running = false;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        },
        isRunning() {
            return running;
        },
    };
}
