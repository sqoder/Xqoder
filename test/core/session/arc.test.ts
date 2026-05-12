// P24b — ConversationArc unit tests.

import { describe, expect, it } from 'bun:test';
import { computeArc, formatArc, type ArcMessage } from '../../../src/core/agent/session/arc.js';

function msg(role: 'user' | 'assistant', content: string): ArcMessage {
    return { role, content };
}

describe('computeArc', () => {
    it('returns empty segments for empty message list', () => {
        const arc = computeArc([]);
        expect(arc.segments).toHaveLength(0);
        expect(arc.totalMessages).toBe(0);
    });

    it('returns a single segment for a short conversation', () => {
        const messages = [
            msg('user', 'Hello'),
            msg('assistant', 'Hi there'),
            msg('user', 'How are you?'),
        ];
        const arc = computeArc(messages);
        expect(arc.segments).toHaveLength(1);
        expect(arc.segments[0]?.startIndex).toBe(0);
        expect(arc.segments[0]?.endIndex).toBe(2);
        expect(arc.totalMessages).toBe(3);
    });

    it('detects a topic shift on "now let\'s"', () => {
        const messages = [
            msg('user', 'Fix the bug in auth.ts'),
            msg('assistant', 'Done'),
            msg('user', 'Looks good'),
            msg('assistant', 'Great'),
            msg('user', 'Now let\'s work on the tests'),
            msg('assistant', 'Sure'),
        ];
        const arc = computeArc(messages);
        expect(arc.segments.length).toBeGreaterThanOrEqual(2);
        // Second segment should start at index 4
        const secondSeg = arc.segments.find((s) => s.startIndex === 4);
        expect(secondSeg).toBeDefined();
    });

    it('does not split if gap is too small', () => {
        // Only 2 messages before the shift — below MIN_SEGMENT_MESSAGES
        const messages = [
            msg('user', 'Hello'),
            msg('assistant', 'Hi'),
            msg('user', 'Now let\'s do something else'),
        ];
        const arc = computeArc(messages);
        // Gap is 2 messages, below MIN_SEGMENT_MESSAGES=3, so no split
        expect(arc.segments).toHaveLength(1);
    });

    it('segment titles are truncated at 60 chars', () => {
        const longContent = 'A'.repeat(80);
        const messages = [msg('user', longContent), msg('assistant', 'ok')];
        const arc = computeArc(messages);
        expect(arc.segments[0]?.title.length).toBeLessThanOrEqual(63); // 60 + ellipsis
    });

    it('segment title falls back to range when no user message', () => {
        const messages = [
            msg('assistant', 'Hello'),
            msg('assistant', 'World'),
        ];
        const arc = computeArc(messages);
        expect(arc.segments[0]?.title).toMatch(/Messages/);
    });

    it('totalMessages matches input length', () => {
        const messages = Array.from({ length: 20 }, (_, i) =>
            msg(i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`),
        );
        const arc = computeArc(messages);
        expect(arc.totalMessages).toBe(20);
    });
});

describe('formatArc', () => {
    it('returns "(no messages)" for empty arc', () => {
        expect(formatArc({ segments: [], totalMessages: 0 })).toBe('(no messages)');
    });

    it('formats segments with index ranges', () => {
        const arc = computeArc([
            msg('user', 'Fix the bug'),
            msg('assistant', 'Done'),
        ]);
        const formatted = formatArc(arc);
        expect(formatted).toContain('1.');
        expect(formatted).toContain('msg');
    });
});
