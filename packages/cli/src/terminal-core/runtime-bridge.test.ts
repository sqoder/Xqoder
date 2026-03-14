import { describe, expect, it } from 'vitest';
import { createInitialTerminalAppState } from './app-state.js';
import { reduceProtocolEventToTerminalState, restoreTerminalHistory } from './runtime-bridge.js';

describe('runtime bridge', () => {
    it('applies protocol streaming events to terminal app state', () => {
        let state = createInitialTerminalAppState({ width: 80, height: 24 }, { cwd: '/repo', model: 'gpt-4.1', agent: 'general' });

        state = reduceProtocolEventToTerminalState(state, {
            type: 'message.started',
            sessionId: 'session-1',
            timestamp: 1,
            source: 'agent',
            message: {
                id: 'assistant-1',
                sessionId: 'session-1',
                role: 'assistant',
                content: '',
                createdAt: 1,
            },
        });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'message.delta',
            sessionId: 'session-1',
            timestamp: 2,
            source: 'agent',
            messageId: 'assistant-1',
            role: 'assistant',
            text: 'Hello',
        });

        expect(state.transcriptEntries[0]?.content).toBe('Hello');
        expect(state.transcriptLines.join('\n')).toContain('Hello');
        expect(state.sidebar[1]?.lines[0]).toBe('session-1');
    });

    it('restores persisted history and surfaces approval/tool feedback', () => {
        let state = restoreTerminalHistory(
            createInitialTerminalAppState({ width: 80, height: 24 }, { cwd: '/repo' }),
            {
                sessionId: 'session-1',
                title: 'hello',
                cwd: '/repo',
                messages: [
                    { role: 'user', content: 'hello' },
                    { role: 'assistant', content: 'world' },
                ],
            },
        );

        expect(state.transcriptLines.join('\n')).toContain('hello');
        expect(state.transcriptLines.join('\n')).toContain('world');

        state = reduceProtocolEventToTerminalState(state, {
            type: 'tool.called',
            sessionId: 'session-1',
            timestamp: 3,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'read_file',
            args: { path: 'README.md' },
        });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'tool.output',
            sessionId: 'session-1',
            timestamp: 4,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'read_file',
            output: 'README content',
            partial: false,
        });
        state = reduceProtocolEventToTerminalState(state, {
            type: 'approval.requested',
            sessionId: 'session-1',
            timestamp: 5,
            source: 'agent',
            requestId: 'approval-1',
            kind: 'tool.use',
            summary: 'Need permission',
            payload: 'preview text',
        });

        expect(state.transcriptLines.join('\n')).toContain('输出已折叠');
        expect(state.pendingApproval?.summary).toBe('Need permission');
        expect(state.sidebar.some((section) => section.title === 'Approval')).toBe(true);
    });
});
