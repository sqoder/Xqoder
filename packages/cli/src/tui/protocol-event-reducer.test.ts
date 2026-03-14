import { describe, expect, it } from 'vitest';
import { INITIAL_PROTOCOL_UI_STATE, reduceProtocolEvent } from './protocol-event-reducer.js';

describe('protocol event reducer', () => {
    const sanitizeAssistantText = (text: string) => text;

    it('creates and updates assistant messages from protocol events', () => {
        const started = reduceProtocolEvent(INITIAL_PROTOCOL_UI_STATE, {
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
        }, { sanitizeAssistantText });

        const withDelta = reduceProtocolEvent(started, {
            type: 'message.delta',
            sessionId: 'session-1',
            timestamp: 2,
            source: 'agent',
            messageId: 'assistant-1',
            role: 'assistant',
            text: 'Hello',
        }, { sanitizeAssistantText });

        const completed = reduceProtocolEvent(withDelta, {
            type: 'message.completed',
            sessionId: 'session-1',
            timestamp: 3,
            source: 'agent',
            message: {
                id: 'assistant-1',
                sessionId: 'session-1',
                role: 'assistant',
                content: 'Hello',
                createdAt: 3,
            },
        }, { sanitizeAssistantText });

        expect(started.messages[0]?.content).toBe('Thinking...');
        expect(withDelta.messages[0]?.content).toBe('Hello');
        expect(completed.messages[0]?.isStreaming).toBe(false);
    });

    it('tracks tool execution lifecycle', () => {
        const called = reduceProtocolEvent(INITIAL_PROTOCOL_UI_STATE, {
            type: 'tool.called',
            sessionId: 'session-1',
            timestamp: 10,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'read_file',
            args: { path: 'README.md' },
        }, { sanitizeAssistantText });

        const output = reduceProtocolEvent(called, {
            type: 'tool.output',
            sessionId: 'session-1',
            timestamp: 11,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'read_file',
            output: 'README content',
        }, { sanitizeAssistantText });

        const completed = reduceProtocolEvent(output, {
            type: 'tool.completed',
            sessionId: 'session-1',
            timestamp: 12,
            source: 'tool',
            provider: 'xqoder-agent',
            tool: 'read_file',
            success: true,
        }, { sanitizeAssistantText });

        expect(called.toolExecutions).toHaveLength(1);
        expect(output.toolExecutions[0]?.output).toBe('README content');
        expect(completed.toolExecutions[0]?.success).toBe(true);
    });

    it('reflects question request and resolution info messages', () => {
        const requested = reduceProtocolEvent(INITIAL_PROTOCOL_UI_STATE, {
            type: 'question.requested',
            sessionId: 'session-1',
            timestamp: 20,
            source: 'agent',
            requestId: 'q-1',
            header: 'Choose mode',
            question: 'Which mode should we use?',
            options: [{ label: 'Parity first' }, { label: 'Feature first' }],
        }, { sanitizeAssistantText });

        const resolved = reduceProtocolEvent(requested, {
            type: 'question.resolved',
            sessionId: 'session-1',
            timestamp: 21,
            source: 'agent',
            requestId: 'q-1',
            selected: ['Parity first'],
            answerSource: 'ui',
        }, { sanitizeAssistantText });

        expect(requested.infoMessage).toContain('Choose mode');
        expect(resolved.infoMessage).toContain('Parity first');
    });
});
