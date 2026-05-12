// DoD integration test for P02: 200-turn simulation driven through the
// composed applyToolResultBudget → snipCompactIfNeeded → microcompact
// pipeline. No provider calls — all compaction is local + pure.

import { describe, expect, it } from 'bun:test';
import type { LLMMessage } from '@xqoder/shared';
import {
    TOOL_RESULT_MAX_BYTES,
    applyToolResultBudget,
} from '../../src/core/agent/session/compaction/tool-result-budget.js';
import {
    SNIP_THRESHOLD_BYTES,
    snipCompactIfNeeded,
} from '../../src/core/agent/session/compaction/snip.js';
import {
    microcompact,
} from '../../src/core/agent/session/compaction/microcompact.js';

function randInt(state: { seed: number }, min: number, max: number): number {
    // Deterministic xorshift32 so the simulation is reproducible across runs.
    let x = state.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    state.seed = x >>> 0;
    const range = max - min + 1;
    return min + (state.seed % range);
}

function runPipeline(msgs: LLMMessage[]): {
    messages: LLMMessage[];
    budgetHits: number;
    snipHits: number;
} {
    const budgeted = applyToolResultBudget(msgs);
    const snipped = snipCompactIfNeeded(budgeted.messages);
    const after = microcompact(snipped.messages);
    return {
        messages: after,
        budgetHits: budgeted.truncated.length,
        snipHits: snipped.snipped ? 1 : 0,
    };
}

describe('P02 DoD: 200-turn simulation', () => {
    it('keeps messages bounded, preserves recent turns, hits budget + snip without auto', () => {
        const rng = { seed: 42 };
        const baseSystem: LLMMessage = { role: 'system', content: 'base system prompt' };
        let history: LLMMessage[] = [baseSystem];

        let totalBudgetHits = 0;
        let totalSnipHits = 0;

        const TURNS = 200;
        for (let turn = 0; turn < TURNS; turn++) {
            // User turn.
            history.push({ role: 'user', content: `turn-${turn} user input` });

            // Random 1–2 tool_use + tool_result pairs per turn. Each result is 1–64 KB.
            const toolCount = randInt(rng, 1, 2);
            const toolCalls = Array.from({ length: toolCount }, (_, i) => ({
                id: `t_${turn}_${i}`,
                name: 'read_file',
                arguments: '{}',
            }));
            history.push({ role: 'assistant', content: '', toolCalls });
            for (const call of toolCalls) {
                const sizeKb = randInt(rng, 1, 64);
                history.push({
                    role: 'tool',
                    content: 'X'.repeat(sizeKb * 1024),
                    toolCallId: call.id,
                });
            }
            // Assistant narrative reply.
            history.push({ role: 'assistant', content: `turn-${turn} narrative reply` });

            const result = runPipeline(history);
            history = result.messages;
            totalBudgetHits += result.budgetHits;
            totalSnipHits += result.snipHits;
        }

        // DoD 1: budget must have fired at least once (64KB > 32KB threshold guarantees this).
        expect(totalBudgetHits).toBeGreaterThan(0);

        // DoD 2: snip must have fired at least once over 200 turns of heavy tool output.
        expect(totalSnipHits).toBeGreaterThan(0);

        // DoD 3: most recent turn's user input and narrative must still be present.
        const recentTurnId = TURNS - 1;
        const recentHasUser = history.some(
            (m) => m.role === 'user' && m.content === `turn-${recentTurnId} user input`,
        );
        const recentHasNarrative = history.some(
            (m) => m.role === 'assistant' && m.content === `turn-${recentTurnId} narrative reply`,
        );
        expect(recentHasUser).toBe(true);
        expect(recentHasNarrative).toBe(true);

        // DoD 4: baseSystem survives at the front.
        expect(history[0]).toBe(baseSystem);

        // DoD 5: no tool message should exceed budget threshold after pipeline.
        for (const m of history) {
            if (m.role === 'tool') {
                expect(Buffer.byteLength(m.content, 'utf8')).toBeLessThanOrEqual(
                    TOOL_RESULT_MAX_BYTES + 4096, // allow ellipsis marker overhead
                );
            }
        }

        // DoD 6: total bytes after the turn-by-turn snip are bounded (snip threshold + one turn's worth of new headroom).
        const totalBytes = history.reduce(
            (n, m) => n + Buffer.byteLength(m.content, 'utf8'),
            0,
        );
        expect(totalBytes).toBeLessThan(SNIP_THRESHOLD_BYTES * 2);

        // DoD 7: all tool_result messages in the output have a surviving tool_use id.
        const surviving = new Set<string>();
        for (const m of history) {
            if (m.role === 'assistant' && m.toolCalls) {
                for (const c of m.toolCalls) surviving.add(c.id);
            }
        }
        for (const m of history) {
            if (m.role === 'tool' && m.toolCallId) {
                expect(surviving.has(m.toolCallId)).toBe(true);
            }
        }
    });
});
