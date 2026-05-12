import { describe, expect, it } from 'bun:test';
import {
    renderAgentMemorySnapshot,
    snapshotSubagentMemory,
    type AgentMemorySnapshot,
    type ForkableSessionView,
} from '../../../../src/core/agent/subagents/memory.js';

function stubSession(overrides: Partial<ForkableSessionView> = {}): ForkableSessionView {
    return {
        getMessages: () => [],
        getUsage: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
        ...overrides,
    };
}

describe('snapshotSubagentMemory (P16b)', () => {
    it('captures the last assistant message as finalResponse', () => {
        const session = stubSession({
            getMessages: () => [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: '  final answer  ' },
            ],
        });
        const snap = snapshotSubagentMemory(session);
        expect(snap.finalResponse).toBe('final answer');
    });

    it('omits finalResponse when the last assistant message is empty', () => {
        const session = stubSession({
            getMessages: () => [
                { role: 'assistant', content: '   ' },
            ],
        });
        const snap = snapshotSubagentMemory(session);
        expect(snap.finalResponse).toBeUndefined();
    });

    it('omits finalResponse when there are no assistant messages', () => {
        const session = stubSession({
            getMessages: () => [
                { role: 'user', content: 'hi' },
            ],
        });
        expect(snapshotSubagentMemory(session).finalResponse).toBeUndefined();
    });

    it('dedupes read files preserving first-seen order', () => {
        const session = stubSession({
            getReadFiles: () => ['a.ts', 'b.ts', 'a.ts', 'c.ts', 'b.ts'],
        });
        expect(snapshotSubagentMemory(session).readFiles).toEqual(['a.ts', 'b.ts', 'c.ts']);
    });

    it('returns an empty readFiles list when session does not implement getReadFiles', () => {
        const session = stubSession({});
        expect(snapshotSubagentMemory(session).readFiles).toEqual([]);
    });

    it('propagates written notes unchanged', () => {
        const notes = [{ key: 'plan', body: 'Step 1. Step 2.' }];
        const session = stubSession({
            getWrittenNotes: () => notes,
        });
        expect(snapshotSubagentMemory(session).writtenNotes).toEqual(notes);
    });

    it('copies usage fields verbatim', () => {
        const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150, cacheReadTokens: 20 };
        const session = stubSession({ getUsage: () => usage });
        expect(snapshotSubagentMemory(session).usage).toEqual(usage);
    });
});

describe('renderAgentMemorySnapshot (P16b)', () => {
    it('formats a full snapshot into a deterministic string', () => {
        const snapshot: AgentMemorySnapshot = {
            readFiles: ['src/foo.ts', 'src/bar.ts'],
            writtenNotes: [{ key: 'plan', body: '3 steps' }],
            finalResponse: 'done',
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        };
        const body = renderAgentMemorySnapshot(snapshot);
        expect(body).toContain('done');
        expect(body).toContain('Files read: src/foo.ts, src/bar.ts');
        expect(body).toContain('Notes:\n- plan: 3 steps');
        expect(body).toContain('Usage: prompt=10 completion=5 total=15');
    });

    it('falls back to a placeholder when finalResponse missing', () => {
        const snapshot: AgentMemorySnapshot = {
            readFiles: [],
            writtenNotes: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
        expect(renderAgentMemorySnapshot(snapshot)).toContain('[subagent produced no final response]');
    });

    it('omits Files/Notes sections when empty', () => {
        const snapshot: AgentMemorySnapshot = {
            readFiles: [],
            writtenNotes: [],
            finalResponse: 'only answer',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
        const body = renderAgentMemorySnapshot(snapshot);
        expect(body).not.toContain('Files read');
        expect(body).not.toContain('Notes:');
    });
});
