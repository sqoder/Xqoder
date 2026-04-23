import { describe, expect, it } from 'bun:test';
import {
    createConversationEventEnvelopeEmitter,
} from '../../../src/infra/protocol/events.js';
import { toConversationEvent } from '../../../src/application/chat/conversation-events.js';

describe('conversation event mapping', () => {
    it('maps user / assistant / tool / verification / terminal events into standard conversation events', () => {
        const sessionId = 'session-conversation-events';
        const timestamp = Date.now();
        const eventEmitter = createConversationEventEnvelopeEmitter(sessionId, `${sessionId}:turn:test`);

        expect(toConversationEvent(eventEmitter.emit({
            type: 'message.started',
            sessionId,
            timestamp,
            source: 'agent',
            message: {
                id: 'user-1',
                sessionId,
                role: 'user',
                content: 'fix the bug',
                createdAt: timestamp,
            },
        }))).toEqual({
            type: 'user_message_accepted',
            sessionId,
            timestamp: expect.any(Number),
            messageId: 'user-1',
            content: 'fix the bug',
        });

        expect(toConversationEvent(eventEmitter.emit({
            type: 'message.delta',
            sessionId,
            timestamp,
            source: 'agent',
            messageId: 'assistant-1',
            role: 'assistant',
            text: 'partial',
        }))).toEqual({
            type: 'assistant_text_delta',
            sessionId,
            timestamp: expect.any(Number),
            messageId: 'assistant-1',
            text: 'partial',
        });

        expect(toConversationEvent(eventEmitter.emit({
            type: 'tool.called',
            sessionId,
            timestamp,
            source: 'agent',
            provider: 'xqoder',
            tool: 'write_file',
            args: { path: 'src/index.ts' },
        }))).toEqual({
            type: 'tool_call_requested',
            sessionId,
            timestamp: expect.any(Number),
            provider: 'xqoder',
            tool: 'write_file',
            args: { path: 'src/index.ts' },
        });

        expect(toConversationEvent(eventEmitter.emit({
            type: 'verification.completed',
            sessionId,
            timestamp,
            source: 'agent',
            ok: false,
            blocked: true,
            summary: 'Verification failed',
        }))).toEqual({
            type: 'verification_completed',
            sessionId,
            timestamp: expect.any(Number),
            ok: false,
            blocked: true,
            summary: 'Verification failed',
        });

        expect(toConversationEvent(eventEmitter.emit({
            type: 'status.changed',
            sessionId,
            timestamp,
            source: 'agent',
            status: 'done',
            stopReason: 'completed',
        }))).toEqual({
            type: 'turn_completed',
            sessionId,
            timestamp: expect.any(Number),
            reason: 'completed',
        });
        expect(toConversationEvent(eventEmitter.emit({
            type: 'error',
            sessionId,
            timestamp,
            source: 'agent',
            message: 'boom',
            stopReason: 'verification_failed',
        }))).toEqual({
            type: 'turn_failed',
            sessionId,
            timestamp: expect.any(Number),
            message: 'boom',
            reason: 'verification_failed',
        });
    });

    it('ignores app events that do not have a standard conversation mapping', () => {
        const sessionId = 'session-conversation-events';
        const event = createConversationEventEnvelopeEmitter(sessionId, `${sessionId}:turn:usage`).emit({
            type: 'usage',
            sessionId,
            timestamp: Date.now(),
            source: 'agent',
            model: 'gpt-4.1',
            promptTokens: 10,
            completionTokens: 2,
            totalTokens: 12,
        });
        expect(toConversationEvent(event)).toBeUndefined();
    });

    it('maps stable conversation envelopes through the same projector adapter', () => {
        const sessionId = 'session-envelope-events';
        const event = createConversationEventEnvelopeEmitter(sessionId, `${sessionId}:turn:test`).emit({
            type: 'tool.completed',
            sessionId,
            timestamp: Date.now(),
            source: 'agent',
            provider: 'xqoder',
            tool: 'write_file',
            success: true,
        });

        expect(toConversationEvent(event)).toEqual({
            type: 'tool_call_resolved',
            sessionId,
            timestamp: Date.parse(event.timestamp),
            provider: 'xqoder',
            tool: 'write_file',
            success: true,
        });
    });
});
