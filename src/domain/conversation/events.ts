import type { ConversationStopReason } from './stop-reason.js';

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
