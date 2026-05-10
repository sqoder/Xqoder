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
    formatHookFeedbackSection,
} from './hook-payload-builders.js';

export type ToolHookEventName = HookEventName;
export type PreToolPermissionDecision = 'allow' | 'ask' | 'deny';

export interface HookRunnerConfigBase {
    disableAllHooks?: boolean;
    hooks?: HooksSettings;
    llmConfig?: LLMProviderConfig;
    cwd: string;
    projectRoot: string;
    sessionId?: string;
    logger?: Logger;
}

export interface ToolHookRunnerConfig extends HookRunnerConfigBase {
    permissionMode: AgentPermissionMode;
}

export interface HookPayloadBase {
    hook_event_name: HookEventName;
    session_id?: string;
    cwd: string;
    project_root: string;
}

export interface PreToolUseHookPayload extends HookPayloadBase {
    hook_event_name: 'PreToolUse';
    permission_mode: AgentPermissionMode;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
}

export interface PostToolUseHookPayload extends HookPayloadBase {
    hook_event_name: 'PostToolUse';
    permission_mode: AgentPermissionMode;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
    tool_response: Record<string, unknown>;
}

export interface PostToolUseFailureHookPayload extends HookPayloadBase {
    hook_event_name: 'PostToolUseFailure';
    permission_mode: AgentPermissionMode;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
    error: string;
    is_interrupt?: boolean;
}

export type ToolHookPayload =
    | PreToolUseHookPayload
    | PostToolUseHookPayload
    | PostToolUseFailureHookPayload;

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
    payload: ToolHookPayload,
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

    const matcherGroups = config.hooks[eventName] ?? [];
    for (const matcherGroup of matcherGroups) {
        if (!matchesToolHook(matcherGroup, payload.tool_name)) {
            continue;
        }

        for (const handler of matcherGroup.hooks) {
            const handlerResult = await executeHookHandler(handler, payload, config, eventName, logger);
            result.handlers.push(handlerResult);

            if (handlerResult.error) {
                logger.warn(`Hook handler failed for ${eventName}/${payload.tool_name}: ${handlerResult.error}`);
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
