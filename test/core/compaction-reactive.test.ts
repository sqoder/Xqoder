// TDD for P02 module 4: nextReactiveStep + applyReactiveStep.
// Cascading snip → micro → auto on PromptTooLongError.

import { describe, expect, it } from 'bun:test';
import type { LLMMessage } from '@xqoder/shared';
import {
    nextReactiveStep,
    applyReactiveStep,
    type ReactiveStep,
    type ReactiveSessionTarget,
} from '../../src/core/agent/session/compaction/reactive.js';
import { SNIP_THRESHOLD_BYTES } from '../../src/core/agent/session/compaction/snip.js';
import { MICRO_PAIRS_THRESHOLD } from '../../src/core/agent/session/compaction/microcompact.js';

function mockSession(initial: LLMMessage[]): ReactiveSessionTarget & { replaced: LLMMessage[][]; performed: string[] } {
    let messages = [...initial];
    const replaced: LLMMessage[][] = [];
    const performed: string[] = [];
    return {
        getMessages: () => messages,
        replaceMessages: (next) => {
            messages = next;
            replaced.push(next);
        },
        performCompaction: (summary) => {
            performed.push(summary);
        },
        replaced,
        performed,
    };
}

describe('nextReactiveStep', () => {
    it('sequences undefined → snip → micro → auto → exhausted', () => {
        const seq: ReactiveStep[] = [];
        let step: ReactiveStep | undefined;
        for (let i = 0; i < 5; i++) {
            step = nextReactiveStep(step);
            seq.push(step);
        }
        expect(seq).toEqual(['snip', 'micro', 'auto', 'exhausted', 'exhausted']);
    });

    it('stays exhausted once reached', () => {
        expect(nextReactiveStep('exhausted')).toBe('exhausted');
    });
});

describe('applyReactiveStep', () => {
    it('no-ops for exhausted', () => {
        const session = mockSession([{ role: 'user', content: 'hi' }]);

        applyReactiveStep(session, 'exhausted');

        expect(session.replaced).toHaveLength(0);
        expect(session.performed).toHaveLength(0);
    });

    it('snip: replaces messages only when snipping actually happens', () => {
        const smallSession = mockSession([{ role: 'user', content: 'tiny' }]);

        applyReactiveStep(smallSession, 'snip');

        expect(smallSession.replaced).toHaveLength(0);

        // Build session above threshold.
        const body: LLMMessage[] = Array.from({ length: 30 }, (_, i) => ({
            role: 'user' as const,
            content: `m${i}:${'X'.repeat(10 * 1024)}`,
        }));
        const heavySession = mockSession([{ role: 'system', content: 'base' }, ...body]);
        expect(body.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8'), 0)).toBeGreaterThan(SNIP_THRESHOLD_BYTES);

        applyReactiveStep(heavySession, 'snip');

        expect(heavySession.replaced).toHaveLength(1);
    });

    it('micro: replaces messages when enough complete pairs exist', () => {
        const msgs: LLMMessage[] = [{ role: 'system', content: 'base' }];
        for (let i = 0; i < MICRO_PAIRS_THRESHOLD + 1; i++) {
            msgs.push({
                role: 'assistant',
                content: '',
                toolCalls: [{ id: `id_${i}`, name: 'grep', arguments: '{}' }],
            });
            msgs.push({ role: 'tool', content: `out_${i}`, toolCallId: `id_${i}` });
        }
        const session = mockSession(msgs);

        applyReactiveStep(session, 'micro');

        expect(session.replaced).toHaveLength(1);
    });

    it('auto: delegates to session.performCompaction with a deterministic summary', () => {
        const session = mockSession([{ role: 'user', content: 'hi' }]);

        applyReactiveStep(session, 'auto');

        expect(session.performed).toHaveLength(1);
        expect(session.performed[0]!).toContain('[reactive]');
    });
});
