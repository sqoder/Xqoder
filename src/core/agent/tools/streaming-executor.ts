import type { ToolCall } from '@xqoder/shared';
import type { ToolBatch } from './partition.js';

export interface ToolBatchExecutionContext<TResult = unknown> {
    signal: AbortSignal;
    run: (call: ToolCall) => Promise<TResult>;
}

/**
 * Drive execution of pre-partitioned tool batches.
 * Concurrent batches run via Promise.all and are yielded in input order.
 * Serial batches run one call at a time.
 * Checks ctx.signal between batches and between serial calls within a batch.
 */
export async function* runToolBatches<TResult>(
    batches: ToolBatch[],
    ctx: ToolBatchExecutionContext<TResult>,
): AsyncIterable<TResult> {
    for (const batch of batches) {
        if (ctx.signal.aborted) return;

        if (batch.concurrent) {
            const results = await Promise.all(batch.calls.map((call) => ctx.run(call)));
            for (const result of results) yield result;
            continue;
        }

        for (const call of batch.calls) {
            if (ctx.signal.aborted) return;
            yield await ctx.run(call);
        }
    }
}
