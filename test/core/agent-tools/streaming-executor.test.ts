import { describe, expect, it } from 'bun:test';
import type { ToolCall } from '@xqoder/shared';
import { runToolBatches } from '../../../src/core/agent/tools/streaming-executor.js';
import type { ToolBatch } from '../../../src/core/agent/tools/partition.js';

const call = (id: string, name: string): ToolCall => ({ id, name, arguments: '{}' });

describe('runToolBatches', () => {
    it('awaits concurrent batches in parallel (Promise.all shape) and serial batches one-by-one', async () => {
        const order: string[] = [];
        const batches: ToolBatch[] = [
            { concurrent: true, calls: [call('r1', 'read'), call('r2', 'read')] },
            { concurrent: false, calls: [call('e1', 'edit')] },
        ];

        const results = [];
        for await (const r of runToolBatches(batches, {
            signal: new AbortController().signal,
            run: async (c) => {
                order.push(`start:${c.id}`);
                await new Promise((resolve) => setTimeout(resolve, c.id === 'r1' ? 10 : 0));
                order.push(`end:${c.id}`);
                return { id: c.id, ok: true };
            },
        })) {
            results.push(r);
        }

        expect(results.map((r) => r.id)).toEqual(['r1', 'r2', 'e1']);
        expect(order.slice(0, 2)).toEqual(['start:r1', 'start:r2']);
        expect(order.indexOf('end:r2')).toBeLessThan(order.indexOf('end:r1'));
        expect(order[order.length - 2]).toBe('start:e1');
        expect(order[order.length - 1]).toBe('end:e1');
    });

    it('stops before starting further batches when signal aborts between batches', async () => {
        const controller = new AbortController();
        const started: string[] = [];
        const batches: ToolBatch[] = [
            { concurrent: true, calls: [call('a', 'read')] },
            { concurrent: false, calls: [call('b', 'edit')] },
            { concurrent: false, calls: [call('c', 'edit')] },
        ];

        const results = [];
        for await (const r of runToolBatches(batches, {
            signal: controller.signal,
            run: async (c) => {
                started.push(c.id);
                if (c.id === 'a') controller.abort();
                return { id: c.id, ok: true };
            },
        })) {
            results.push(r);
        }

        expect(started).toEqual(['a']);
        expect(results).toHaveLength(1);
    });

    it('stops mid serial batch when signal aborts between calls', async () => {
        const controller = new AbortController();
        const started: string[] = [];
        const batches: ToolBatch[] = [
            { concurrent: false, calls: [call('a', 'edit'), call('b', 'edit'), call('c', 'edit')] },
        ];

        const results = [];
        for await (const r of runToolBatches(batches, {
            signal: controller.signal,
            run: async (c) => {
                started.push(c.id);
                if (c.id === 'a') controller.abort();
                return { id: c.id, ok: true };
            },
        })) {
            results.push(r);
        }

        expect(started).toEqual(['a']);
        expect(results).toHaveLength(1);
    });

    it('yields nothing when signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const batches: ToolBatch[] = [
            { concurrent: true, calls: [call('x', 'read')] },
        ];

        const seen: unknown[] = [];
        for await (const r of runToolBatches(batches, {
            signal: controller.signal,
            run: async () => ({ ok: true }),
        })) {
            seen.push(r);
        }
        expect(seen).toEqual([]);
    });
});
