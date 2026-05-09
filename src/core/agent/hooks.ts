import type {
    AgentPermissionMode,
    HookEventName,
    HookHandlerConfig,
    HooksSettings,
    LLMProviderConfig,
} from '@xqoder/shared';
import { type Logger, logger as defaultLogger } from '@xqoder/shared';
import { executeHookHandler } from './hook-handler-execution.js';
import {
    mergePermissionDecision,
    normalizePermissionDecision,
    parseHookHandlerOutput,
} from './hook-handler-output.js';
import { matchesToolHook } from './hook-matcher.js';

export {
    buildPostToolUseFailureHookPayload,
    buildPostToolUseHookPayload,
    buildPreToolUseHookPayload,
    buildSessionStartHookPayload,
    buildUserPromptSubmitHookPayload,
    buildStopHookPayload,
    buildSubagentStopHookPayload,
    buildPreCompactHookPayload,
    formatHookFeedbackSection,
} from './hook-payload-builders.js';

export type ToolHookEventName = HookEventName;
export type PreToolPermissionDecision = 'allow' | 'ask' | 'deny';

export interface ToolHookRunnerConfig {
    disableAllHooks?: boolean;
    hooks?: HooksSettings;
    llmConfig?: LLMProviderConfig;
    cwd: string;
    projectRoot: string;
    sessionId?: string;
    permissionMode: AgentPermissionMode;
    logger?: Logger;
}

export interface PreToolUseHookPayload {
    hook_event_name: 'PreToolUse';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
}

export interface PostToolUseHookPayload {
    hook_event_name: 'PostToolUse';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
    tool_response: Record<string, unknown>;
}

export interface PostToolUseFailureHookPayload {
    hook_event_name: 'PostToolUseFailure';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
    error: string;
    is_interrupt?: boolean;
}

export interface SessionStartHookPayload {
    hook_event_name: 'SessionStart';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    source: 'startup' | 'resume';
    message_count: number;
}

export interface UserPromptSubmitHookPayload {
    hook_event_name: 'UserPromptSubmit';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    prompt: string;
    slash_command?: string;
    attachments_count: number;
}

export interface StopHookPayload {
    hook_event_name: 'Stop';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    reason: 'completed' | 'failed' | 'cancelled';
    stop_reason?: string;
}

export interface SubagentStopHookPayload {
    hook_event_name: 'SubagentStop';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    subagent_name: string;
    subagent_goal: string;
    success: boolean;
}

export interface PreCompactHookPayload {
    hook_event_name: 'PreCompact';
    session_id?: string;
    cwd: string;
    project_root: string;
    permission_mode: AgentPermissionMode;
    trigger: 'auto' | 'manual';
    message_count_before: number;
}

export type LifecycleHookPayload =
    | SessionStartHookPayload
    | UserPromptSubmitHookPayload
    | StopHookPayload
    | SubagentStopHookPayload
    | PreCompactHookPayload;

export type ToolHookPayload =
    | PreToolUseHookPayload
    | PostToolUseHookPayload
    | PostToolUseFailureHookPayload;

export type HookPayload = ToolHookPayload | LifecycleHookPayload;

export interface HookHandlerExecutionResult {
    type: HookHandlerConfig['type'];
    matched: boolean;
    skipped?: boolean;
    asynchronous?: boolean;
    output?: string;
    error?: string;
}

export interface ToolHookExecutionResult {
    continue: boolean;
    stopReason?: string;
    systemMessages: string[];
    permissionDecision?: PreToolPermissionDecision;
    permissionDecisionReason?: string;
    decision?: 'block';
    reason?: string;
    additionalContexts: string[];
    handlers: HookHandlerExecutionResult[];
}

export async function runToolHooks(
    eventName: ToolHookEventName,
    payload: HookPayload,
    config: ToolHookRunnerConfig,
): Promise<ToolHookExecutionResult> {
    const logger = config.logger ?? defaultLogger.child('HookRunner');
    const result: ToolHookExecutionResult = {
        continue: true,
        systemMessages: [],
        additionalContexts: [],
        handlers: [],
    };

    if (config.disableAllHooks || !config.hooks || Object.keys(config.hooks).length === 0) {
        return result;
    }

    const matcherTarget = resolveHookMatcherTarget(payload);
    const matcherGroups = config.hooks[eventName] ?? [];
    for (const matcherGroup of matcherGroups) {
        if (!matchesToolHook(matcherGroup, matcherTarget)) {
            continue;
        }

        for (const handler of matcherGroup.hooks) {
            const handlerResult = await executeHookHandler(handler, payload, config, eventName, logger);
            result.handlers.push(handlerResult);

            if (handlerResult.error) {
                logger.warn(`Hook handler failed for ${eventName}/${matcherTarget || '<lifecycle>'}: ${handlerResult.error}`);
                continue;
            }

            const parsed = parseHookHandlerOutput(handlerResult.output);
            if (!parsed) {
                continue;
            }

            if (parsed.systemMessage?.trim()) {
                result.systemMessages.push(parsed.systemMessage.trim());
            }
            if (parsed.continue === false) {
                result.continue = false;
                if (!result.stopReason && parsed.stopReason?.trim()) {
                    result.stopReason = parsed.stopReason.trim();
                }
            }
            if (parsed.decision === 'block' && !result.decision) {
                result.decision = 'block';
                if (parsed.reason?.trim()) {
                    result.reason = parsed.reason.trim();
                }
            }

            const hookEventName = parsed.hookSpecificOutput?.hookEventName;
            if (!hookEventName || hookEventName === eventName) {
                const permissionDecision = normalizePermissionDecision(parsed.hookSpecificOutput?.permissionDecision);
                if (permissionDecision) {
                    result.permissionDecision = mergePermissionDecision(result.permissionDecision, permissionDecision);
                    if (!result.permissionDecisionReason && parsed.hookSpecificOutput?.permissionDecisionReason?.trim()) {
                        result.permissionDecisionReason = parsed.hookSpecificOutput.permissionDecisionReason.trim();
                    }
                }

                if (parsed.hookSpecificOutput?.additionalContext?.trim()) {
                    result.additionalContexts.push(parsed.hookSpecificOutput.additionalContext.trim());
                }
            }
        }
    }

    result.additionalContexts = Array.from(new Set(result.additionalContexts));
    result.systemMessages = Array.from(new Set(result.systemMessages));
    return result;
}

function resolveHookMatcherTarget(payload: HookPayload): string {
    switch (payload.hook_event_name) {
        case 'PreToolUse':
        case 'PostToolUse':
        case 'PostToolUseFailure':
            return payload.tool_name;
        case 'UserPromptSubmit':
            return payload.slash_command ?? '';
        case 'SubagentStop':
            return payload.subagent_name;
        case 'SessionStart':
        case 'Stop':
        case 'PreCompact':
        default:
            return '';
    }
}
