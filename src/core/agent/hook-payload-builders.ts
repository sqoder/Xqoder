import type { AgentPermissionMode, ToolResult } from '@xqoder/shared';
import type {
    PostToolUseFailureHookPayload,
    PostToolUseHookPayload,
    PreToolUseHookPayload,
} from './hooks.js';

export function buildPreToolUseHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
}): PreToolUseHookPayload {
    return {
        hook_event_name: 'PreToolUse',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        tool_name: input.toolName,
        tool_input: input.toolInput,
        tool_use_id: input.toolUseId,
    };
}

export function buildPostToolUseHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
    toolResult: ToolResult;
}): PostToolUseHookPayload {
    return {
        hook_event_name: 'PostToolUse',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        tool_name: input.toolName,
        tool_input: input.toolInput,
        tool_use_id: input.toolUseId,
        tool_response: {
            success: input.toolResult.success,
            output: input.toolResult.output,
            ...(input.toolResult.error ? { error: input.toolResult.error } : {}),
            ...(input.toolResult.metadata ? { metadata: input.toolResult.metadata } : {}),
        },
    };
}

export function buildPostToolUseFailureHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
    toolResult: ToolResult;
}): PostToolUseFailureHookPayload {
    return {
        hook_event_name: 'PostToolUseFailure',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        tool_name: input.toolName,
        tool_input: input.toolInput,
        tool_use_id: input.toolUseId,
        error: input.toolResult.error ?? 'Unknown tool failure',
    };
}

export function formatHookFeedbackSection(label: string, values: string[]): string | undefined {
    const normalized = values
        .map((value) => value.trim())
        .filter(Boolean);
    if (normalized.length === 0) {
        return undefined;
    }

    return [
        `${label}:`,
        ...normalized,
    ].join('\n');
}
