import { describe, expect, it } from 'bun:test';
import {
    createTuiRuntimeDescriptor,
    createTuiRuntimeEventRelay,
} from '../../../src/infrastructure/agent/tui-agent-runtime-support.js';

describe('tui agent runtime support', () => {
    it('relays events to callbacks and mirrors tool lifecycle into the event bus', () => {
        const receivedEvents: string[] = [];
        const eventBusEvents: Array<{ name: string; payload: unknown }> = [];
        const relay = createTuiRuntimeEventRelay({
            onEvent: (event) => {
                receivedEvents.push(event.type);
            },
        }, {
            eventBus: {
                emit(name, payload) {
                    eventBusEvents.push({ name, payload });
                },
            },
        });

        relay.emit({
            type: 'tool.called',
            sessionId: 'session-1',
            timestamp: 1,
            source: 'tool',
            provider: 'local',
            tool: 'read_file',
            args: { path: 'README.md' },
        });
        relay.emit({
            type: 'message.completed',
            sessionId: 'session-1',
            timestamp: 2,
            source: 'agent',
            message: {
                id: 'assistant-1',
                sessionId: 'session-1',
                role: 'assistant',
                content: 'hello',
                createdAt: 2,
            },
        });
        relay.emit({
            type: 'tool.completed',
            sessionId: 'session-1',
            timestamp: 3,
            source: 'tool',
            provider: 'local',
            tool: 'read_file',
            success: true,
        });
        relay.emit({
            type: 'error',
            sessionId: 'session-1',
            timestamp: 4,
            source: 'runtime',
            message: 'boom',
            recoverable: false,
        });

        expect(receivedEvents).toEqual([
            'tool.called',
            'message.completed',
            'tool.completed',
            'error',
        ]);
        expect(eventBusEvents).toEqual([
            {
                name: 'tool:start',
                payload: {
                    toolName: 'read_file',
                    args: { path: 'README.md' },
                },
            },
            {
                name: 'tool:end',
                payload: {
                    toolName: 'read_file',
                    success: true,
                },
            },
        ]);
        expect(relay.getState()).toEqual({
            lastAssistantResponse: 'hello',
            errorEmitted: true,
        });
    });

    it('builds permission and question fallbacks for the local runtime descriptor', async () => {
        const descriptor = createTuiRuntimeDescriptor({
            sessionId: 'session-1',
            cwd: '/workspace/demo',
            permissions: {
                tools: {
                    shell: 'ask',
                },
            },
            callbacks: {
                onEvent() {},
            },
        });

        await expect(descriptor.permissionPolicy.evaluate({ target: 'shell' })).resolves.toBe('deny');
        await expect(descriptor.requestQuestion({
            requestId: 'question-1',
            question: 'Continue?',
            options: [{ label: 'Allow' }, { label: 'Deny' }],
        })).resolves.toEqual({
            requestId: 'question-1',
            selected: ['Allow'],
        });
    });
});
