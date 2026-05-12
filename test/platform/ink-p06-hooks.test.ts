// P06 tests — useHistoryPersistence (loadHistory/saveHistory) + conversationReducer.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { loadHistory, saveHistory } from '../../src/platform/terminal/ink/hooks/useHistoryPersistence.js';
import { conversationReducer, conversationInitialState } from '../../src/platform/terminal/ink/hooks/useConversationStream.js';
import type { ConversationAction } from '../../src/platform/terminal/ink/hooks/useConversationStream.js';

// ---------------------------------------------------------------------------
// loadHistory / saveHistory
// ---------------------------------------------------------------------------

describe('loadHistory', () => {
    let tmpDir: string;
    let historyFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-history-test-'));
        historyFile = path.join(tmpDir, 'history.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty array when file does not exist', () => {
        expect(loadHistory(historyFile)).toEqual([]);
    });

    it('returns empty array for invalid JSON', () => {
        fs.writeFileSync(historyFile, 'not json', 'utf-8');
        expect(loadHistory(historyFile)).toEqual([]);
    });

    it('returns empty array for non-array JSON', () => {
        fs.writeFileSync(historyFile, '{"key": "value"}', 'utf-8');
        expect(loadHistory(historyFile)).toEqual([]);
    });

    it('loads valid history array', () => {
        const items = ['git status', 'bun test', 'ls -la'];
        fs.writeFileSync(historyFile, JSON.stringify(items), 'utf-8');
        expect(loadHistory(historyFile)).toEqual(items);
    });

    it('filters out non-string entries', () => {
        fs.writeFileSync(historyFile, JSON.stringify(['valid', 42, null, 'also valid']), 'utf-8');
        expect(loadHistory(historyFile)).toEqual(['valid', 'also valid']);
    });

    it('caps at 500 entries', () => {
        const items = Array.from({ length: 600 }, (_, i) => `cmd-${i}`);
        fs.writeFileSync(historyFile, JSON.stringify(items), 'utf-8');
        const loaded = loadHistory(historyFile);
        expect(loaded.length).toBe(500);
        // Should keep the last 500
        expect(loaded[0]).toBe('cmd-100');
        expect(loaded[499]).toBe('cmd-599');
    });
});

describe('saveHistory', () => {
    let tmpDir: string;
    let historyFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-history-save-'));
        historyFile = path.join(tmpDir, 'history.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('saves history to file', () => {
        const items = ['git commit', 'bun run build'];
        saveHistory(items, historyFile);
        const loaded = loadHistory(historyFile);
        expect(loaded).toEqual(items);
    });

    it('deduplicates entries', () => {
        const items = ['git status', 'bun test', 'git status', 'ls'];
        saveHistory(items, historyFile);
        const loaded = loadHistory(historyFile);
        expect(loaded).toEqual(['bun test', 'git status', 'ls']);
    });

    it('caps at 500 entries', () => {
        const items = Array.from({ length: 600 }, (_, i) => `cmd-${i}`);
        saveHistory(items, historyFile);
        const loaded = loadHistory(historyFile);
        expect(loaded.length).toBe(500);
    });

    it('creates parent directory if missing', () => {
        const nestedFile = path.join(tmpDir, 'nested', 'deep', 'history.json');
        saveHistory(['hello'], nestedFile);
        expect(fs.existsSync(nestedFile)).toBe(true);
    });

    it('round-trips correctly', () => {
        const items = ['cmd1', 'cmd2', 'cmd3'];
        saveHistory(items, historyFile);
        expect(loadHistory(historyFile)).toEqual(items);
    });
});

// ---------------------------------------------------------------------------
// conversationReducer
// ---------------------------------------------------------------------------

describe('conversationReducer', () => {
    const initial = conversationInitialState;

    it('starts with empty state', () => {
        expect(initial.messages).toEqual([]);
        expect(initial.isBusy).toBe(false);
        expect(initial.thinking).toBe(false);
        expect(initial.error).toBeNull();
    });

    it('send.start adds user message and sets isBusy', () => {
        const action: ConversationAction = { type: 'send.start', userText: 'hello world' };
        const next = conversationReducer(initial, action);
        expect(next.isBusy).toBe(true);
        expect(next.messages).toHaveLength(1);
        expect(next.messages[0]?.role).toBe('user');
        expect(next.messages[0]?.content).toBe('hello world');
        expect(next.error).toBeNull();
    });

    it('message.delta creates new assistant message', () => {
        const action: ConversationAction = { type: 'message.delta', id: 'msg-1', text: 'Hello' };
        const next = conversationReducer(initial, action);
        expect(next.messages).toHaveLength(1);
        expect(next.messages[0]?.role).toBe('assistant');
        expect(next.messages[0]?.content).toBe('Hello');
    });

    it('message.delta appends to existing message', () => {
        const s1 = conversationReducer(initial, { type: 'message.delta', id: 'msg-1', text: 'Hello' });
        const s2 = conversationReducer(s1, { type: 'message.delta', id: 'msg-1', text: ' world' });
        expect(s2.messages[0]?.content).toBe('Hello world');
    });

    it('message.completed finalizes message content', () => {
        const s1 = conversationReducer(initial, { type: 'message.delta', id: 'msg-1', text: 'partial' });
        const s2 = conversationReducer(s1, { type: 'message.completed', id: 'msg-1', content: 'final content' });
        expect(s2.messages[0]?.content).toBe('final content');
        expect(s2.messages[0]?.streaming).toBe(false);
    });

    it('thought sets thinking=true and thinkingText', () => {
        const action: ConversationAction = { type: 'thought', text: 'reasoning...' };
        const next = conversationReducer(initial, action);
        expect(next.thinking).toBe(true);
        expect(next.thinkingText).toBe('reasoning...');
    });

    it('tool.called adds tool message', () => {
        const action: ConversationAction = { type: 'tool.called', id: 'tc-1', tool: 'read_file', args: { path: 'foo.ts' } };
        const next = conversationReducer(initial, action);
        expect(next.messages).toHaveLength(1);
        expect(next.messages[0]?.content).toContain('read_file');
    });

    it('tool.completed clears thinking', () => {
        const s1 = conversationReducer(initial, { type: 'thought', text: 'thinking' });
        const s2 = conversationReducer(s1, { type: 'tool.completed', id: 'tc-1', tool: 'read_file', success: true });
        expect(s2.thinking).toBe(false);
    });

    it('status.changed sets thinking when status is thinking', () => {
        const next = conversationReducer(initial, { type: 'status.changed', status: 'thinking' });
        expect(next.thinking).toBe(true);
    });

    it('status.changed clears thinking for other statuses', () => {
        const s1 = conversationReducer(initial, { type: 'status.changed', status: 'thinking' });
        const s2 = conversationReducer(s1, { type: 'status.changed', status: 'idle' });
        expect(s2.thinking).toBe(false);
    });

    it('usage accumulates tokens and cost', () => {
        const s1 = conversationReducer(initial, { type: 'usage', promptTokens: 100, completionTokens: 50, cost: 0.001 });
        const s2 = conversationReducer(s1, { type: 'usage', promptTokens: 200, completionTokens: 100, cost: 0.002 });
        expect(s2.promptTokens).toBe(300);
        expect(s2.completionTokens).toBe(150);
        expect(s2.cost).toBeCloseTo(0.003);
    });

    it('error sets error message and clears isBusy', () => {
        const s1 = conversationReducer(initial, { type: 'send.start', userText: 'test' });
        const s2 = conversationReducer(s1, { type: 'error', message: 'network error' });
        expect(s2.error).toBe('network error');
        expect(s2.isBusy).toBe(false);
        expect(s2.thinking).toBe(false);
    });

    it('session.started captures sessionId', () => {
        const next = conversationReducer(initial, { type: 'session.started', sessionId: 'sess-abc' });
        expect(next.sessionId).toBe('sess-abc');
    });

    it('send.done clears isBusy and updates sessionId', () => {
        const s1 = conversationReducer(initial, { type: 'send.start', userText: 'hi' });
        const s2 = conversationReducer(s1, { type: 'send.done', sessionId: 'sess-xyz' });
        expect(s2.isBusy).toBe(false);
        expect(s2.sessionId).toBe('sess-xyz');
        expect(s2.thinking).toBe(false);
    });

    it('approval.pending sets pendingApproval', () => {
        const fakeApproval = {
            request: { toolCallId: 'tc-1', toolName: 'run_shell', summary: 'run ls', reason: 'test', risk: 'low' as const },
            resolve: () => {},
        };
        const next = conversationReducer(initial, { type: 'approval.pending', approval: fakeApproval });
        expect(next.pendingApproval).toBe(fakeApproval);
    });

    it('approval.resolved clears pendingApproval', () => {
        const fakeApproval = {
            request: { toolCallId: 'tc-1', toolName: 'run_shell', summary: 'run ls', reason: 'test', risk: 'low' as const },
            resolve: () => {},
        };
        const s1 = conversationReducer(initial, { type: 'approval.pending', approval: fakeApproval });
        const s2 = conversationReducer(s1, { type: 'approval.resolved' });
        expect(s2.pendingApproval).toBeNull();
    });

    it('question.pending sets pendingQuestion', () => {
        const fakeQuestion = {
            request: { requestId: 'q-1', question: 'Which option?', options: [{ label: 'A' }, { label: 'B' }] },
            resolve: () => {},
        };
        const next = conversationReducer(initial, { type: 'question.pending', question: fakeQuestion });
        expect(next.pendingQuestion).toBe(fakeQuestion);
    });

    it('question.resolved clears pendingQuestion', () => {
        const fakeQuestion = {
            request: { requestId: 'q-1', question: 'Which option?', options: [{ label: 'A' }] },
            resolve: () => {},
        };
        const s1 = conversationReducer(initial, { type: 'question.pending', question: fakeQuestion });
        const s2 = conversationReducer(s1, { type: 'question.resolved' });
        expect(s2.pendingQuestion).toBeNull();
    });

    it('unknown action returns state unchanged', () => {
        const next = conversationReducer(initial, { type: 'unknown' } as unknown as ConversationAction);
        expect(next).toBe(initial);
    });
});
