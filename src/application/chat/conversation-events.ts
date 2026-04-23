import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type { ConversationEvent } from '../../domain/conversation/events.js';

export function toConversationEvent(event: ConversationEventEnvelope): ConversationEvent | undefined {
    const timestamp = Date.parse(event.timestamp);

    switch (event.type) {
        case 'message.started': {
            const message = event.payload.message;
            if (message.role !== 'user') {
                return undefined;
            }
            return {
                type: 'user_message_accepted',
                sessionId: event.sessionId,
                timestamp,
                messageId: message.id,
                content: message.content,
            };
        }
        case 'message.delta': {
            const role = event.payload.role;
            if (role !== 'assistant') {
                return undefined;
            }
            return {
                type: 'assistant_text_delta',
                sessionId: event.sessionId,
                timestamp,
                messageId: event.payload.messageId,
                text: event.payload.text,
            };
        }
        case 'message.completed': {
            const message = event.payload.message;
            if (message.role !== 'assistant') {
                return undefined;
            }
            return {
                type: 'assistant_message_completed',
                sessionId: event.sessionId,
                timestamp,
                messageId: message.id,
                content: message.content,
            };
        }
        case 'tool.called':
            return {
                type: 'tool_call_requested',
                sessionId: event.sessionId,
                timestamp,
                provider: event.payload.provider,
                tool: event.payload.tool,
                args: event.payload.args,
            };
        case 'tool.completed':
            return {
                type: 'tool_call_resolved',
                sessionId: event.sessionId,
                timestamp,
                provider: event.payload.provider,
                tool: event.payload.tool,
                success: event.payload.success,
            };
        case 'verification.completed':
            return {
                type: 'verification_completed',
                sessionId: event.sessionId,
                timestamp,
                ok: event.payload.ok,
                blocked: event.payload.blocked,
                summary: event.payload.summary,
            };
        case 'status.changed':
            if (event.payload.status === 'done') {
                return {
                    type: 'turn_completed',
                    sessionId: event.sessionId,
                    timestamp,
                    ...(event.payload.stopReason
                        ? { reason: event.payload.stopReason }
                        : {}),
                };
            }
            if (event.payload.status === 'error') {
                return {
                    type: 'turn_failed',
                    sessionId: event.sessionId,
                    timestamp,
                    message: event.payload.message ?? 'Turn failed',
                    ...(event.payload.stopReason
                        ? { reason: event.payload.stopReason }
                        : {}),
                };
            }
            return undefined;
        case 'error':
            return {
                type: 'turn_failed',
                sessionId: event.sessionId,
                timestamp,
                message: event.payload.message,
                ...(event.payload.stopReason
                    ? { reason: event.payload.stopReason }
                    : {}),
            };
        default:
            return undefined;
    }
}
