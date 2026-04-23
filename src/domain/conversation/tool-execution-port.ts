import type {
    AgentPermissionMode,
    ToolCall,
    ToolResult,
} from '@xqoder/shared';

export interface ToolCallPreparation<TCallbacks = unknown, TState = unknown> {
    toolCall: ToolCall;
    args: Record<string, unknown>;
    callbacks?: TCallbacks;
    streamId: string;
    permissionMode: AgentPermissionMode;
    blocked: boolean;
    preToolUseDetail: string;
    permissionDetail: string;
    state: TState;
}

export interface ToolExecutionPort<TCallbacks = unknown, TState = unknown> {
    prepareToolCall(input: {
        toolCall: ToolCall;
        callbacks?: TCallbacks;
        streamId: string;
    }): Promise<ToolCallPreparation<TCallbacks, TState>>;
    invokePreparedToolCall(
        preparation: ToolCallPreparation<TCallbacks, TState>,
    ): Promise<ToolResult | undefined>;
    finalizeToolCall(
        preparation: ToolCallPreparation<TCallbacks, TState>,
        result: ToolResult | undefined,
    ): Promise<ToolResult>;
}
