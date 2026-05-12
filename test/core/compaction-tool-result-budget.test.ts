// TDD for P02 module 1: applyToolResultBudget.
// Budget truncates oversize tool messages only; head+tail preserved; idempotent.

import { describe, expect, it } from 'bun:test';
import type { LLMMessage } from '@xqoder/shared';
import {
    TOOL_RESULT_MAX_BYTES,
    TOOL_RESULT_HEAD_BYTES,
    TOOL_RESULT_TAIL_BYTES,
    applyToolResultBudget,
} from '../../src/core/agent/session/compaction/tool-result-budget.js';

function toolMsg(id: string, content: string): LLMMessage {
    return { role: 'tool', content, toolCallId: id };
}

function userMsg(content: string): LLMMessage {
    return { role: 'user', content };
}

function assistantMsg(content: string): LLMMessage {
    return { role: 'assistant', content };
}

describe('applyToolResultBudget', () => {
    it('returns messages unchanged when no tool message exceeds threshold', () => {
        const messages: LLMMessage[] = [
            userMsg('hello'),
            toolMsg('call_1', 'small result'),
            assistantMsg('ok'),
        ];

        const result = applyToolResultBudget(messages);

        expect(result.messages).toEqual(messages);
        expect(result.truncated).toEqual([]);
    });

    it('truncates a single oversize tool message with head + ellipsis + tail', () => {
        const huge = 'A'.repeat(TOOL_RESULT_MAX_BYTES + 8 * 1024);
        const messages: LLMMessage[] = [toolMsg('call_big', huge)];

        const result = applyToolResultBudget(messages);

        expect(result.truncated).toHaveLength(1);
        expect(result.truncated[0]!.toolCallId).toBe('call_big');
        expect(result.truncated[0]!.originalBytes).toBe(huge.length);

        const truncatedContent = result.messages[0]!.content;
        expect(typeof truncatedContent).toBe('string');
        expect(truncatedContent).toContain('…[truncated');
        // Head + tail preserved verbatim at string ends.
        expect(truncatedContent.startsWith('A'.repeat(TOOL_RESULT_HEAD_BYTES))).toBe(true);
        expect(truncatedContent.endsWith('A'.repeat(TOOL_RESULT_TAIL_BYTES))).toBe(true);
        // Result bytes far smaller than original.
        expect(Buffer.byteLength(truncatedContent, 'utf8')).toBeLessThan(huge.length / 2);
    });

    it('does not truncate non-tool messages even when huge', () => {
        const huge = 'A'.repeat(TOOL_RESULT_MAX_BYTES * 2);
        const messages: LLMMessage[] = [userMsg(huge), assistantMsg(huge)];

        const result = applyToolResultBudget(messages);

        expect(result.messages[0]!.content).toBe(huge);
        expect(result.messages[1]!.content).toBe(huge);
        expect(result.truncated).toEqual([]);
    });

    it('is idempotent: re-running does not truncate already-truncated message', () => {
        const huge = 'A'.repeat(TOOL_RESULT_MAX_BYTES + 4 * 1024);
        const messages: LLMMessage[] = [toolMsg('call_big', huge)];

        const first = applyToolResultBudget(messages);
        const second = applyToolResultBudget(first.messages);

        expect(second.truncated).toEqual([]);
        expect(second.messages[0]!.content).toBe(first.messages[0]!.content);
    });

    it('only truncates the tool messages over threshold, leaves others untouched', () => {
        const small = 'tiny';
        const big = 'B'.repeat(TOOL_RESULT_MAX_BYTES + 1024);
        const messages: LLMMessage[] = [
            toolMsg('call_small', small),
            toolMsg('call_big', big),
            toolMsg('call_small2', small),
        ];

        const result = applyToolResultBudget(messages);

        expect(result.truncated).toHaveLength(1);
        expect(result.truncated[0]!.toolCallId).toBe('call_big');
        expect(result.messages[0]!.content).toBe(small);
        expect(result.messages[2]!.content).toBe(small);
    });

    it('uses byte length not character length (UTF-8 multibyte safe)', () => {
        // 3-byte chars in UTF-8. 10KB of "中" = 30KB bytes, under 32KB threshold.
        const chars10k = '中'.repeat(10_000);
        const messages: LLMMessage[] = [toolMsg('call_cjk', chars10k)];

        const result = applyToolResultBudget(messages);

        // 30KB < 32KB threshold → no truncation.
        expect(result.truncated).toEqual([]);
        expect(result.messages[0]!.content).toBe(chars10k);
    });

    it('reports keptBytes ≈ head + tail for truncated payload', () => {
        const huge = 'A'.repeat(TOOL_RESULT_MAX_BYTES * 2);
        const messages: LLMMessage[] = [toolMsg('call_big', huge)];

        const result = applyToolResultBudget(messages);

        // keptBytes should reflect head + tail + ellipsis marker bytes.
        const kept = result.truncated[0]!.keptBytes;
        expect(kept).toBeGreaterThanOrEqual(TOOL_RESULT_HEAD_BYTES + TOOL_RESULT_TAIL_BYTES);
        expect(kept).toBeLessThan(TOOL_RESULT_MAX_BYTES);
    });
});
