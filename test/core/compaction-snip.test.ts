// TDD for P02 module 2: snipCompactIfNeeded.
// Preserves baseSystem + head(4) + boundary + tail(8); drops orphan tool_result.

import { describe, expect, it } from 'bun:test';
import type { LLMMessage } from '@xqoder/shared';
import {
    SNIP_THRESHOLD_BYTES,
    SNIP_HEAD_COUNT,
    SNIP_TAIL_COUNT,
    snipCompactIfNeeded,
} from '../../src/core/agent/session/compaction/snip.js';

function sys(content: string): LLMMessage {
    return { role: 'system', content };
}

function user(content: string): LLMMessage {
    return { role: 'user', content };
}

function assistant(content: string, toolCalls?: { id: string; name: string; arguments: string }[]): LLMMessage {
    return toolCalls
        ? { role: 'assistant', content, toolCalls }
        : { role: 'assistant', content };
}

function tool(id: string, content: string): LLMMessage {
    return { role: 'tool', content, toolCallId: id };
}

function bulk(n: number, bytesEach: number, roleSeq: LLMMessage['role'][] = ['user', 'assistant']): LLMMessage[] {
    const out: LLMMessage[] = [];
    for (let i = 0; i < n; i++) {
        const role = roleSeq[i % roleSeq.length]!;
        out.push({ role, content: `${role}-${i}:${'X'.repeat(bytesEach)}` });
    }
    return out;
}

describe('snipCompactIfNeeded', () => {
    it('no-op when total bytes under threshold', () => {
        const messages: LLMMessage[] = [sys('base'), user('hi'), assistant('hello')];

        const result = snipCompactIfNeeded(messages);

        expect(result.snipped).toBe(false);
        expect(result.messages).toBe(messages);
    });

    it('no-op when over threshold but messages ≤ head + tail budget', () => {
        // 2 huge messages past threshold but not enough to have a middle to snip.
        const huge = 'X'.repeat(SNIP_THRESHOLD_BYTES);
        const messages: LLMMessage[] = [sys('base'), user(huge), assistant(huge)];

        const result = snipCompactIfNeeded(messages);

        expect(result.snipped).toBe(false);
    });

    it('snips middle, preserving baseSystem + head + boundary + tail', () => {
        const base = sys('base system prompt');
        // 30 non-system messages of ~10KB → 300KB > 256KB threshold.
        const body = bulk(30, 10 * 1024);
        const messages: LLMMessage[] = [base, ...body];

        const result = snipCompactIfNeeded(messages);

        expect(result.snipped).toBe(true);
        expect(result.messages[0]).toBe(base);
        // Head block immediately after base.
        for (let i = 0; i < SNIP_HEAD_COUNT; i++) {
            expect(result.messages[1 + i]).toBe(body[i]);
        }
        // Boundary is a single system message with [snipped ...] marker.
        const boundary = result.messages[1 + SNIP_HEAD_COUNT]!;
        expect(boundary.role).toBe('system');
        expect(boundary.content).toContain('[snipped');
        // Tail block = last SNIP_TAIL_COUNT messages of body.
        const tailStart = result.messages.length - SNIP_TAIL_COUNT;
        for (let i = 0; i < SNIP_TAIL_COUNT; i++) {
            expect(result.messages[tailStart + i]).toBe(body[body.length - SNIP_TAIL_COUNT + i]);
        }
        // Total shape: base + head + 1 boundary + tail.
        expect(result.messages).toHaveLength(1 + SNIP_HEAD_COUNT + 1 + SNIP_TAIL_COUNT);
    });

    it('snips when no base system message exists', () => {
        const body = bulk(30, 10 * 1024);

        const result = snipCompactIfNeeded(body);

        expect(result.snipped).toBe(true);
        // head + boundary + tail, no baseSystem.
        expect(result.messages).toHaveLength(SNIP_HEAD_COUNT + 1 + SNIP_TAIL_COUNT);
        expect(result.messages[SNIP_HEAD_COUNT]!.role).toBe('system');
    });

    it('drops orphan tool_result at start of tail block (no matching tool_use in head/base)', () => {
        const base = sys('base');
        // 30 messages; force a tool_result to land at tail start with no matching tool_use surviving.
        const body: LLMMessage[] = [];
        for (let i = 0; i < 20; i++) body.push(user(`pad-${i}:${'X'.repeat(20 * 1024)}`));
        // Tail window = last 8 messages. Index 22 (= body[22]) should be tail[0].
        // Replace body[22] with an orphan tool_result whose id references nothing in head/base.
        body.push(tool('orphan_call', 'orphan result payload'));
        for (let i = 0; i < 10; i++) body.push(user(`tail-pad-${i}:${'Y'.repeat(20 * 1024)}`));

        const result = snipCompactIfNeeded([base, ...body]);

        expect(result.snipped).toBe(true);
        // Assertion: no orphan tool_result survives in the output.
        const hasOrphan = result.messages.some(
            (m) => m.role === 'tool' && m.toolCallId === 'orphan_call',
        );
        expect(hasOrphan).toBe(false);
    });

    it('keeps tool_result when its matching tool_use survives in head block', () => {
        const base = sys('base');
        const head: LLMMessage[] = [
            user('hi'),
            assistant('calling', [{ id: 'call_keep', name: 'grep', arguments: '{}' }]),
            tool('call_keep', 'result'),
            user('continue'),
        ];
        // Force total bytes over threshold.
        const pad = bulk(30, 15 * 1024);
        const tail: LLMMessage[] = [
            tool('call_keep', 'follow-up reference'), // tail starts here — use_id survives in head
            ...bulk(7, 1024),
        ];

        const result = snipCompactIfNeeded([base, ...head, ...pad, ...tail]);

        expect(result.snipped).toBe(true);
        const tailBlock = result.messages.slice(-SNIP_TAIL_COUNT);
        // call_keep tool_use exists in head, so tool_result at tail[0] is NOT orphaned.
        expect(tailBlock[0]!.role).toBe('tool');
        expect(tailBlock[0]!.toolCallId).toBe('call_keep');
    });
});
