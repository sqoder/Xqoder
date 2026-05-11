// P16c — Batch fork coordinator with concurrency cap.
//
// When the parent agent wants to fan out multiple subagents, we schedule at
// most `maxConcurrency` forks in flight at a time. Default cap is 4, matching
// OpenClaude's `AgentTool` scheduler.
//
// Ordering: results are returned in the same order as the input specs, so
// callers can correlate results to their original task list without extra
// bookkeeping. Individual fork failures become `{ error }` entries in the
// result array so a single bad subagent does not poison the batch.

import { forkSubagent, type ForkResult, type ForkSpec, type ForkSubagentDependencies, type ParentForkContext } from './fork.js';

export const DEFAULT_FORK_CONCURRENCY = 4;

export type BatchForkOutcome =
    | { readonly status: 'ok'; readonly result: ForkResult }
    | { readonly status: 'error'; readonly error: Error };

export interface BatchForkOptions {
    readonly maxConcurrency?: number;
    /** Abort the entire batch. Individual forks also receive this signal via spec.signal when set. */
    readonly signal?: AbortSignal;
}

/**
 * Runs a batch of fork specs concurrently, capped at `maxConcurrency`.
 * Returns outcomes in input order. Never throws — each failure is reported
 * as an outcome entry so the parent LLM can see partial success.
 */
export async function forkSubagentsBatch(
    parent: ParentForkContext,
    specs: readonly ForkSpec[],
    deps: ForkSubagentDependencies,
    options: BatchForkOptions = {},
): Promise<BatchForkOutcome[]> {
    const cap = Math.max(1, options.maxConcurrency ?? DEFAULT_FORK_CONCURRENCY);
    const outcomes: BatchForkOutcome[] = new Array(specs.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
        while (true) {
            if (options.signal?.aborted) return;
            const index = cursor;
            cursor += 1;
            if (index >= specs.length) return;
            const spec = specs[index]!;
            try {
                const result = await forkSubagent(parent, spec, deps);
                outcomes[index] = { status: 'ok', result };
            } catch (error) {
                outcomes[index] = {
                    status: 'error',
                    error: error instanceof Error ? error : new Error(String(error)),
                };
            }
        }
    };

    const workerCount = Math.min(cap, specs.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return outcomes;
}

/**
 * Convenience predicate: are all specs flagged `concurrencySafe`?
 * Callers use this before choosing `forkSubagentsBatch` vs a serial loop.
 */
export function areAllConcurrencySafe(specs: readonly ForkSpec[]): boolean {
    return specs.every((spec) => spec.agent.concurrencySafe);
}
