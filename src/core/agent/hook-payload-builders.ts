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

import type {
    PreCompactHookPayload,
    SessionStartHookPayload,
    StopHookPayload,
    SubagentStopHookPayload,
    UserPromptSubmitHookPayload,
} from './hooks.js';

export function buildSessionStartHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    source: 'startup' | 'resume';
    messageCount: number;
}): SessionStartHookPayload {
    return {
        hook_event_name: 'SessionStart',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        source: input.source,
        message_count: input.messageCount,
    };
}

export function buildUserPromptSubmitHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    prompt: string;
    slashCommand?: string;
    attachmentsCount: number;
}): UserPromptSubmitHookPayload {
    return {
        hook_event_name: 'UserPromptSubmit',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        prompt: input.prompt,
        ...(input.slashCommand ? { slash_command: input.slashCommand } : {}),
        attachments_count: input.attachmentsCount,
    };
}

export function buildStopHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    reason: 'completed' | 'failed' | 'cancelled';
    stopReason?: string;
}): StopHookPayload {
    return {
        hook_event_name: 'Stop',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        reason: input.reason,
        ...(input.stopReason ? { stop_reason: input.stopReason } : {}),
    };
}

export function buildSubagentStopHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    subagentName: string;
    subagentGoal: string;
    success: boolean;
}): SubagentStopHookPayload {
    return {
        hook_event_name: 'SubagentStop',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        subagent_name: input.subagentName,
        subagent_goal: input.subagentGoal,
        success: input.success,
    };
}

export function buildPreCompactHookPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    permissionMode: AgentPermissionMode;
    trigger: 'auto' | 'manual';
    messageCountBefore: number;
}): PreCompactHookPayload {
    return {
        hook_event_name: 'PreCompact',
        session_id: input.sessionId,
        cwd: input.cwd,
        project_root: input.projectRoot,
        permission_mode: input.permissionMode,
        trigger: input.trigger,
        message_count_before: input.messageCountBefore,
    };
}
