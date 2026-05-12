import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type { ConversationStopReason } from '../../domain/conversation/stop-reason.js';

interface ConversationEventBase {
    sessionId: string;
    timestamp: number;
}

export interface UserMessageAcceptedEvent extends ConversationEventBase {
    type: 'user_message_accepted';
    messageId: string;
    content: string;
}

export interface AssistantTextDeltaEvent extends ConversationEventBase {
    type: 'assistant_text_delta';
    messageId: string;
    text: string;
}

export interface AssistantMessageCompletedEvent extends ConversationEventBase {
    type: 'assistant_message_completed';
    messageId: string;
    content: string;
}

export interface ToolCallRequestedEvent extends ConversationEventBase {
    type: 'tool_call_requested';
    provider: string;
    tool: string;
    args: unknown;
}

export interface ToolCallResolvedEvent extends ConversationEventBase {
    type: 'tool_call_resolved';
    provider: string;
    tool: string;
    success: boolean;
}

export interface VerificationCompletedEvent extends ConversationEventBase {
    type: 'verification_completed';
    ok: boolean;
    blocked: boolean;
    summary: string;
}

export interface TurnCompletedEvent extends ConversationEventBase {
    type: 'turn_completed';
    reason?: ConversationStopReason;
}

export interface TurnFailedEvent extends ConversationEventBase {
    type: 'turn_failed';
    message: string;
    reason?: ConversationStopReason;
}

export type ConversationEvent =
    | UserMessageAcceptedEvent
    | AssistantTextDeltaEvent
    | AssistantMessageCompletedEvent
    | ToolCallRequestedEvent
    | ToolCallResolvedEvent
    | VerificationCompletedEvent
    | TurnCompletedEvent
    | TurnFailedEvent;

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
