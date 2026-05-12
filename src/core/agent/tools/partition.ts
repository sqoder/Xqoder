import type { ToolCall } from '@xqoder/shared';

export interface ToolBatch {
    concurrent: boolean;
    calls: ToolCall[];
}

export interface PartitionOptions {
    isConcurrencySafe: (call: ToolCall) => boolean;
    maxConcurrent?: number;
}

/**
 * Group a linear list of tool calls into execution batches.
 * Consecutive safe calls are grouped into a concurrent batch bounded by maxConcurrent (default 10);
 * unsafe calls each become a serial batch of size 1.
 */
export function partitionToolCalls(
    calls: ToolCall[],
    options: PartitionOptions,
): ToolBatch[] {
    const max = options.maxConcurrent ?? 10;
    const batches: ToolBatch[] = [];
    let current: ToolBatch | null = null;

    for (const call of calls) {
        const safe = options.isConcurrencySafe(call);
        if (!safe) {
            current = { concurrent: false, calls: [call] };
            batches.push(current);
            current = null;
            continue;
        }

        if (!current || !current.concurrent || current.calls.length >= max) {
            current = { concurrent: true, calls: [] };
            batches.push(current);
        }
        current.calls.push(call);
    }

    return batches;
}
