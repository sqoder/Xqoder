import { describe, expect, it } from 'vitest';
import type {
    AppEvent,
    ApprovalRequestedEvent,
    ErrorEvent,
    EventEnvelope,
    EventSource,
    MessageDeltaEvent,
    RunStatus,
    StatusChangedEvent,
    ToolCalledEvent,
} from './events.js';

describe('protocol events', () => {
    it('EventEnvelope has required fields', () => {
        const e: EventEnvelope = {
            type: 'session.started',
            sessionId: 's1',
            timestamp: Date.now(),
            source: 'runtime' as EventSource,
        };
        expect(e.type).toBe('session.started');
        expect(e.sessionId).toBe('s1');
        expect(typeof e.timestamp).toBe('number');
        expect(['runtime', 'ui', 'model', 'agent', 'tool', 'plugin', 'sync']).toContain(e.source);
    });

    it('MessageDeltaEvent shape is valid', () => {
        const e: MessageDeltaEvent = {
            type: 'message.delta',
            sessionId: 's1',
            timestamp: Date.now(),
            source: 'model',
            messageId: 'm1',
            role: 'assistant',
            text: 'hello',
        };
        expect(e.type).toBe('message.delta');
        expect(e.role).toBe('assistant');
        expect(e.text).toBe('hello');
    });

    it('ToolCalledEvent and ApprovalRequestedEvent shapes are valid', () => {
        const tool: ToolCalledEvent = {
            type: 'tool.called',
            sessionId: 's1',
            timestamp: Date.now(),
            source: 'agent',
            provider: 'p1',
            tool: 'run_command',
            args: { command: 'ls' },
        };
        expect(tool.type).toBe('tool.called');
        expect(tool.provider).toBe('p1');
        expect(tool.args).toEqual({ command: 'ls' });

        const approval: ApprovalRequestedEvent = {
            type: 'approval.requested',
            sessionId: 's1',
            timestamp: Date.now(),
            source: 'runtime',
            requestId: 'req-1',
            kind: 'tool.use',
            summary: 'Run command: ls',
        };
        expect(approval.type).toBe('approval.requested');
        expect(approval.requestId).toBe('req-1');
        expect(approval.summary).toBe('Run command: ls');
    });

    it('StatusChangedEvent and ErrorEvent shapes are valid', () => {
        const status: StatusChangedEvent = {
            type: 'status.changed',
            sessionId: 's1',
            timestamp: Date.now(),
            source: 'runtime',
            status: 'thinking' as RunStatus,
        };
        expect(status.type).toBe('status.changed');
        expect(['idle', 'thinking', 'running-tool', 'awaiting-approval', 'done', 'error']).toContain(status.status);

        const err: ErrorEvent = {
            type: 'error',
            sessionId: 's1',
            timestamp: Date.now(),
            source: 'runtime',
            message: 'Something failed',
            recoverable: true,
        };
        expect(err.type).toBe('error');
        expect(err.message).toBe('Something failed');
        expect(err.recoverable).toBe(true);
    });

    it('AppEvent union accepts all event types', () => {
        const events: AppEvent[] = [
            { type: 'session.started', sessionId: 's1', timestamp: 1, source: 'runtime', cwd: '/tmp' },
            { type: 'message.delta', sessionId: 's1', timestamp: 2, source: 'model', messageId: 'm1', role: 'assistant', text: 'x' },
            { type: 'tool.called', sessionId: 's1', timestamp: 3, source: 'agent', provider: 'p', tool: 't', args: {} },
            { type: 'status.changed', sessionId: 's1', timestamp: 4, source: 'runtime', status: 'done' },
            { type: 'error', sessionId: 's1', timestamp: 5, source: 'runtime', message: 'err' },
        ];
        expect(events).toHaveLength(5);
        expect(events.map((e) => e.type)).toEqual(['session.started', 'message.delta', 'tool.called', 'status.changed', 'error']);
    });
});
