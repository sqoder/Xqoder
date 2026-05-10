import { describe, expect, it } from 'bun:test';
import type { ToolCall } from '@xqoder/shared';
import { partitionToolCalls } from '../../../src/core/agent/tools/partition.js';

const call = (id: string, name: string): ToolCall => ({
    id,
    name,
    arguments: '{}',
});

describe('partitionToolCalls', () => {
    it('groups consecutive safe calls into concurrent batch and unsafe into serial batch', () => {
        const batches = partitionToolCalls(
            [
                call('a', 'read'),
                call('b', 'read'),
                call('c', 'glob'),
                call('d', 'grep'),
                call('e', 'edit'),
                call('f', 'write'),
            ],
            { isConcurrencySafe: (c) => ['read', 'glob', 'grep'].includes(c.name) },
        );

        expect(batches).toEqual([
            { concurrent: true, calls: [call('a', 'read'), call('b', 'read'), call('c', 'glob'), call('d', 'grep')] },
            { concurrent: false, calls: [call('e', 'edit')] },
            { concurrent: false, calls: [call('f', 'write')] },
        ]);
    });

    it('splits read/read/edit/read into 3 batches [concurrent(2), serial(1), concurrent(1)]', () => {
        const batches = partitionToolCalls(
            [call('1', 'read'), call('2', 'read'), call('3', 'edit'), call('4', 'read')],
            { isConcurrencySafe: (c) => c.name === 'read' },
        );

        expect(batches.map((b) => ({ concurrent: b.concurrent, size: b.calls.length }))).toEqual([
            { concurrent: true, size: 2 },
            { concurrent: false, size: 1 },
            { concurrent: true, size: 1 },
        ]);
    });

    it('caps concurrent batch at maxConcurrent and overflow becomes a new concurrent batch', () => {
        const calls = Array.from({ length: 12 }, (_, i) => call(String(i), 'read'));
        const batches = partitionToolCalls(calls, {
            isConcurrencySafe: () => true,
            maxConcurrent: 5,
        });

        expect(batches).toHaveLength(3);
        expect(batches[0]!.calls).toHaveLength(5);
        expect(batches[1]!.calls).toHaveLength(5);
        expect(batches[2]!.calls).toHaveLength(2);
        expect(batches.every((b) => b.concurrent)).toBe(true);
    });

    it('returns empty array for empty input', () => {
        expect(partitionToolCalls([], { isConcurrencySafe: () => true })).toEqual([]);
    });

    it('defaults maxConcurrent to 10', () => {
        const calls = Array.from({ length: 11 }, (_, i) => call(String(i), 'read'));
        const batches = partitionToolCalls(calls, { isConcurrencySafe: () => true });
        expect(batches).toHaveLength(2);
        expect(batches[0]!.calls).toHaveLength(10);
        expect(batches[1]!.calls).toHaveLength(1);
    });

    it('treats every call as serial when predicate returns false', () => {
        const batches = partitionToolCalls(
            [call('a', 'edit'), call('b', 'write')],
            { isConcurrencySafe: () => false },
        );
        expect(batches).toHaveLength(2);
        expect(batches.every((b) => !b.concurrent && b.calls.length === 1)).toBe(true);
    });
});
