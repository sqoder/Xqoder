// TDD for P02 module 3: microcompact.
// Folds oldest MICRO_PAIRS_TO_FOLD complete tool_use↔tool_result pairs into a
// single system summary. Multi-id assistant messages fold atomically.

import { describe, expect, it } from 'bun:test';
import type { LLMMessage } from '@xqoder/shared';
import {
    MICRO_PAIRS_THRESHOLD,
    MICRO_PAIRS_TO_FOLD,
    microcompact,
} from '../../src/core/agent/session/compaction/microcompact.js';

function assistantCall(ids: string[]): LLMMessage {
    return {
        role: 'assistant',
        content: '',
        toolCalls: ids.map((id) => ({ id, name: `tool_${id}`, arguments: '{}' })),
    };
}

function toolResult(id: string, content = `result of ${id}`): LLMMessage {
    return { role: 'tool', content, toolCallId: id };
}

function buildPairs(n: number): LLMMessage[] {
    const out: LLMMessage[] = [{ role: 'system', content: 'base' }];
    for (let i = 0; i < n; i++) {
        out.push(assistantCall([`id_${i}`]));
        out.push(toolResult(`id_${i}`));
    }
    return out;
}

describe('microcompact', () => {
    it('no-op when pair count below threshold', () => {
        const msgs = buildPairs(MICRO_PAIRS_THRESHOLD - 1);

        const result = microcompact(msgs);

        expect(result).toBe(msgs);
    });

    it('folds oldest MICRO_PAIRS_TO_FOLD pairs into one system summary when at threshold', () => {
        const pairs = MICRO_PAIRS_THRESHOLD; // e.g. 10
        const msgs = buildPairs(pairs);
        const originalLen = msgs.length;

        const result = microcompact(msgs);

        // Removed 2×MICRO_PAIRS_TO_FOLD messages, added 1 system summary.
        expect(result.length).toBe(originalLen - 2 * MICRO_PAIRS_TO_FOLD + 1);

        // A system summary should exist, mentioning folded tool calls.
        const summary = result.find(
            (m) => m.role === 'system' && m.content.includes('microcompact summary'),
        );
        expect(summary).toBeDefined();

        // Oldest pair id_0 should be gone; newest id_{pairs-1} retained.
        const hasOldest = result.some(
            (m) => m.role === 'tool' && m.toolCallId === 'id_0',
        );
        const hasNewest = result.some(
            (m) => m.role === 'tool' && m.toolCallId === `id_${pairs - 1}`,
        );
        expect(hasOldest).toBe(false);
        expect(hasNewest).toBe(true);
    });

    it('preserves base system message at front after folding', () => {
        const msgs = buildPairs(MICRO_PAIRS_THRESHOLD);

        const result = microcompact(msgs);

        expect(result[0]!.role).toBe('system');
        expect(result[0]!.content).toBe('base');
    });

    it('treats multi-id assistant message atomically: folds only when all ids resolve', () => {
        // Assistant message with 2 tool_use ids → must be folded together or not at all.
        const msgs: LLMMessage[] = [{ role: 'system', content: 'base' }];
        // First: a multi-id assistant call, only ONE matching tool_result.
        msgs.push(assistantCall(['multi_a', 'multi_b']));
        msgs.push(toolResult('multi_a'));
        // No tool_result for multi_b yet.
        // Add many complete single pairs so threshold is crossed.
        for (let i = 0; i < MICRO_PAIRS_THRESHOLD + 2; i++) {
            msgs.push(assistantCall([`ok_${i}`]));
            msgs.push(toolResult(`ok_${i}`));
        }

        const result = microcompact(msgs);

        // The incomplete multi-id assistant message should NOT be folded.
        const multiStillThere = result.some(
            (m) =>
                m.role === 'assistant'
                && m.toolCalls?.some((c) => c.id === 'multi_b'),
        );
        expect(multiStillThere).toBe(true);
    });

    it('does not fold when no complete pairs meet the threshold even if messages present', () => {
        // 15 dangling assistant calls with no matching tool_results.
        const msgs: LLMMessage[] = [{ role: 'system', content: 'base' }];
        for (let i = 0; i < 15; i++) {
            msgs.push(assistantCall([`lone_${i}`]));
        }

        const result = microcompact(msgs);

        expect(result).toBe(msgs);
    });
});
