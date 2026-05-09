import type {
    AgentPermissionMode,
    HooksSettings,
    LLMProviderConfig,
    Logger,
    ToolResult,
} from '@xqoder/shared';
import {
    buildPostToolUseFailureHookPayload,
    buildPostToolUseHookPayload,
    formatHookFeedbackSection,
    runToolHooks,
} from './hooks.js';
import type { ToolApprovalRequest } from './tools/tool.js';

export interface ToolHookRuntime {
    disableAllHooks: boolean;
    hooks?: HooksSettings;
    llmConfig: LLMProviderConfig;
    cwd: string;
    projectRoot: string;
    sessionId: string;
    logger: Logger;
}

export interface PostToolHookFeedbackInput extends ToolHookRuntime {
    toolName: string;
    toolArgs: Record<string, unknown>;
    toolCallId: string;
    permissionMode: AgentPermissionMode;
}

export async function applyPostToolHookFeedback(
    result: ToolResult,
    input: PostToolHookFeedbackInput,
): Promise<ToolResult> {
    const eventName = result.success ? 'PostToolUse' : 'PostToolUseFailure';
    const hookResult = await runToolHooks(
        eventName,
        result.success
            ? buildPostToolUseHookPayload({
                sessionId: input.sessionId,
                cwd: input.cwd,
                projectRoot: input.projectRoot,
                permissionMode: input.permissionMode,
                toolName: input.toolName,
                toolInput: input.toolArgs,
                toolUseId: input.toolCallId,
                toolResult: result,
            })
            : buildPostToolUseFailureHookPayload({
                sessionId: input.sessionId,
                cwd: input.cwd,
                projectRoot: input.projectRoot,
                permissionMode: input.permissionMode,
                toolName: input.toolName,
                toolInput: input.toolArgs,
                toolUseId: input.toolCallId,
                toolResult: result,
            }),
        {
            disableAllHooks: input.disableAllHooks,
            hooks: input.hooks,
            llmConfig: input.llmConfig,
            cwd: input.cwd,
            projectRoot: input.projectRoot,
            sessionId: input.sessionId,
            permissionMode: input.permissionMode,
            logger: input.logger,
        },
    );
    for (const message of hookResult.systemMessages) {
        input.logger.warn(`${eventName} hook message: ${message}`);
    }

    const feedback = [
        ...(hookResult.decision === 'block' && hookResult.reason
            ? [`${eventName} blocked continuation: ${hookResult.reason}`]
            : []),
        ...hookResult.additionalContexts,
    ];
    return appendHookFeedback(result, eventName, feedback);
}

export function buildHookBlockedResult(
    toolCallId: string,
    toolName: string,
    hookResult: Awaited<ReturnType<typeof runToolHooks>>,
    args: Record<string, unknown>,
): ToolResult {
    const section = formatHookFeedbackSection('PreToolUse', [
        ...(hookResult.permissionDecisionReason ? [hookResult.permissionDecisionReason] : []),
        ...hookResult.additionalContexts,
        ...(hookResult.stopReason ? [hookResult.stopReason] : []),
    ]);
    const error = hookResult.permissionDecisionReason
        ?? hookResult.stopReason
        ?? `Tool "${toolName}" was denied by PreToolUse hook`;
    return {
        toolCallId,
        success: false,
        output: section ?? '',
        error,
        metadata: {
            stopReason: 'permission_denied',
            hookFeedback: {
                event: 'PreToolUse',
                decision: hookResult.permissionDecision,
                reason: hookResult.permissionDecisionReason,
                additionalContexts: hookResult.additionalContexts,
                args,
            },
        },
    };
}

export function buildPermissionDeniedResult(
    toolCallId: string,
    toolName: string,
    additionalContexts: string[],
): ToolResult {
    const error = `Tool "${toolName}" was denied by permission settings (permission: deny)`;
    const section = formatHookFeedbackSection('PreToolUse', additionalContexts);
    return {
        toolCallId,
        success: false,
        output: section ?? '',
        error,
        metadata: {
            stopReason: 'permission_denied',
            ...(additionalContexts.length > 0
                ? {
                hookFeedback: {
                    event: 'PreToolUse',
                    additionalContexts,
                },
            }
                : {}),
        },
    };
}

export function createPreToolApprovalPatch(
    toolName: string,
    args: Record<string, unknown>,
    hookResult: Awaited<ReturnType<typeof runToolHooks>>,
): (Partial<ToolApprovalRequest> & { force?: boolean }) | undefined {
    if (hookResult.permissionDecision !== 'ask' && hookResult.additionalContexts.length === 0 && !hookResult.permissionDecisionReason) {
        return undefined;
    }

    return {
        force: hookResult.permissionDecision === 'ask',
        summary: hookResult.permissionDecision === 'ask'
            ? `PreToolUse hook requires approval before running ${toolName}`
            : undefined,
        reason: formatHookFeedbackSection('PreToolUse', [
            ...(hookResult.permissionDecisionReason ? [hookResult.permissionDecisionReason] : []),
            ...hookResult.additionalContexts,
        ]),
        preview: hookResult.permissionDecision === 'ask'
            ? safeStringifyHookArgs(args)
            : undefined,
        risk: hookResult.permissionDecision === 'ask' ? 'high' : undefined,
    };
}

export function appendHookFeedback(result: ToolResult, label: string, feedback: string[]): ToolResult {
    const section = formatHookFeedbackSection(label, feedback);
    if (!section) {
        return result;
    }
    return {
        ...result,
        output: result.output ? `${result.output}\n\n${section}` : section,
        ...(result.error ? { error: `${result.error}\n\n${section}` } : {}),
        metadata: {
            ...(result.metadata ?? {}),
            hookFeedback: {
                ...(typeof result.metadata?.['hookFeedback'] === 'object' && result.metadata['hookFeedback'] !== null
                    ? result.metadata['hookFeedback'] as Record<string, unknown>
                    : {}),
                event: label,
                additionalContexts: feedback,
            },
        },
    };
}

function safeStringifyHookArgs(args: Record<string, unknown>): string {
    try {
        return JSON.stringify(args, null, 2);
    } catch {
        return '[unserializable tool arguments]';
    }
}


/**
 * Result of firing a lifecycle hook (SessionStart / UserPromptSubmit / Stop /
 * SubagentStop / PreCompact). The conversation engine uses this to decide
 * whether to abort, skip the relevant action, or inject additional context.
 */
export interface LifecycleHookOutcome {
    continue: boolean;
    stopReason?: string;
    decision?: 'block';
    reason?: string;
    systemMessages: string[];
    additionalContexts: string[];
}

async function runLifecycleHook(
    eventName: 'SessionStart' | 'UserPromptSubmit' | 'Stop' | 'SubagentStop' | 'PreCompact',
    payload: Parameters<typeof runToolHooks>[1],
    input: ToolHookRuntime & { permissionMode: AgentPermissionMode },
): Promise<LifecycleHookOutcome> {
    const hookResult = await runToolHooks(
        eventName,
        payload,
        {
            disableAllHooks: input.disableAllHooks,
            hooks: input.hooks,
            llmConfig: input.llmConfig,
            cwd: input.cwd,
            projectRoot: input.projectRoot,
            sessionId: input.sessionId,
            permissionMode: input.permissionMode,
            logger: input.logger,
        },
    );
    for (const message of hookResult.systemMessages) {
        input.logger.warn(`${eventName} hook message: ${message}`);
    }
    return {
        continue: hookResult.continue,
        ...(hookResult.stopReason ? { stopReason: hookResult.stopReason } : {}),
        ...(hookResult.decision ? { decision: hookResult.decision } : {}),
        ...(hookResult.reason ? { reason: hookResult.reason } : {}),
        systemMessages: hookResult.systemMessages,
        additionalContexts: hookResult.additionalContexts,
    };
}

export async function runSessionStartHook(
    input: ToolHookRuntime & {
        permissionMode: AgentPermissionMode;
        source: 'startup' | 'resume';
        messageCount: number;
    },
): Promise<LifecycleHookOutcome> {
    const { buildSessionStartHookPayload } = await import('./hook-payload-builders.js');
    return runLifecycleHook('SessionStart', buildSessionStartHookPayload({
        sessionId: input.sessionId,
        cwd: input.cwd,
        projectRoot: input.projectRoot,
        permissionMode: input.permissionMode,
        source: input.source,
        messageCount: input.messageCount,
    }), input);
}

export async function runUserPromptSubmitHook(
    input: ToolHookRuntime & {
        permissionMode: AgentPermissionMode;
        prompt: string;
        slashCommand?: string;
        attachmentsCount: number;
    },
): Promise<LifecycleHookOutcome> {
    const { buildUserPromptSubmitHookPayload } = await import('./hook-payload-builders.js');
    return runLifecycleHook('UserPromptSubmit', buildUserPromptSubmitHookPayload({
        sessionId: input.sessionId,
        cwd: input.cwd,
        projectRoot: input.projectRoot,
        permissionMode: input.permissionMode,
        prompt: input.prompt,
        ...(input.slashCommand ? { slashCommand: input.slashCommand } : {}),
        attachmentsCount: input.attachmentsCount,
    }), input);
}

export async function runStopHook(
    input: ToolHookRuntime & {
        permissionMode: AgentPermissionMode;
        reason: 'completed' | 'failed' | 'cancelled';
        stopReason?: string;
    },
): Promise<LifecycleHookOutcome> {
    const { buildStopHookPayload } = await import('./hook-payload-builders.js');
    return runLifecycleHook('Stop', buildStopHookPayload({
        sessionId: input.sessionId,
        cwd: input.cwd,
        projectRoot: input.projectRoot,
        permissionMode: input.permissionMode,
        reason: input.reason,
        ...(input.stopReason ? { stopReason: input.stopReason } : {}),
    }), input);
}

export async function runSubagentStopHook(
    input: ToolHookRuntime & {
        permissionMode: AgentPermissionMode;
        subagentName: string;
        subagentGoal: string;
        success: boolean;
    },
): Promise<LifecycleHookOutcome> {
    const { buildSubagentStopHookPayload } = await import('./hook-payload-builders.js');
    return runLifecycleHook('SubagentStop', buildSubagentStopHookPayload({
        sessionId: input.sessionId,
        cwd: input.cwd,
        projectRoot: input.projectRoot,
        permissionMode: input.permissionMode,
        subagentName: input.subagentName,
        subagentGoal: input.subagentGoal,
        success: input.success,
    }), input);
}

export async function runPreCompactHook(
    input: ToolHookRuntime & {
        permissionMode: AgentPermissionMode;
        trigger: 'auto' | 'manual';
        messageCountBefore: number;
    },
): Promise<LifecycleHookOutcome> {
    const { buildPreCompactHookPayload } = await import('./hook-payload-builders.js');
    return runLifecycleHook('PreCompact', buildPreCompactHookPayload({
        sessionId: input.sessionId,
        cwd: input.cwd,
        projectRoot: input.projectRoot,
        permissionMode: input.permissionMode,
        trigger: input.trigger,
        messageCountBefore: input.messageCountBefore,
    }), input);
}
