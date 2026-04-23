export type ConversationStopReason =
    | 'completed'
    | 'max_turns'
    | 'max_tool_calls'
    | 'max_wall_time'
    | 'duplicate_tool_call'
    | 'no_progress'
    | 'user_cancelled'
    | 'permission_denied'
    | 'verification_failed'
    | 'provider_error';

export interface ConversationTerminalPayload {
    stopReason: ConversationStopReason;
    message?: string;
}
