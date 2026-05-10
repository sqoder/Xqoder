import { logger as defaultLogger } from '@xqoder/shared';
import { emitTelemetry } from '../../shared/telemetry/index.js';
import { executeHookHandler } from './hook-handler-execution.js';
import { parseHookHandlerOutput } from './hook-handler-output.js';
import type {
    HookHandlerExecutionResult,
    HookPayloadBase,
    HookRunnerConfigBase,
} from './hooks.js';

export type LifecycleHookEventName =
    | 'SessionStart'
    | 'SessionEnd'
    | 'Stop'
    | 'SubagentStop'
    | 'PreCompact'
    | 'PostCompact';

export interface SessionStartHookPayload extends HookPayloadBase {
    hook_event_name: 'SessionStart';
    source: 'startup' | 'resume' | 'clear' | 'compact';
}

export interface SessionEndHookPayload extends HookPayloadBase {
    hook_event_name: 'SessionEnd';
    reason: 'clear' | 'logout' | 'prompt_input_exit' | 'other';
}

export interface StopHookPayload extends HookPayloadBase {
    hook_event_name: 'Stop';
    stop_hook_active: boolean;
}

export interface SubagentStopHookPayload extends HookPayloadBase {
    hook_event_name: 'SubagentStop';
    stop_hook_active: boolean;
    subagent?: string;
}

export interface PreCompactHookPayload extends HookPayloadBase {
    hook_event_name: 'PreCompact';
    trigger: 'manual' | 'auto';
    custom_instructions?: string;
}

export interface PostCompactHookPayload extends HookPayloadBase {
    hook_event_name: 'PostCompact';
    trigger: 'manual' | 'auto';
    messages_before: number;
    messages_after: number;
}

export type LifecycleHookPayload =
    | SessionStartHookPayload
    | SessionEndHookPayload
    | StopHookPayload
    | SubagentStopHookPayload
    | PreCompactHookPayload
    | PostCompactHookPayload;

export interface LifecycleHookResult {
    blocked: boolean;
    reason?: string;
    additionalContexts: string[];
    systemMessages: string[];
    handlers: HookHandlerExecutionResult[];
}

const FIRE_AND_FORGET_TIMEOUT_MS = 5_000;

export async function dispatchLifecycleHook(
    eventName: LifecycleHookEventName,
    payload: LifecycleHookPayload,
    config: HookRunnerConfigBase,
): Promise<LifecycleHookResult> {
    const logger = config.logger ?? defaultLogger.child('LifecycleHookRunner');
    const startedAt = Date.now();
    const result: LifecycleHookResult = {
        blocked: false,
        additionalContexts: [],
        systemMessages: [],
        handlers: [],
    };

    if (config.disableAllHooks || !config.hooks || Object.keys(config.hooks).length === 0) {
        return result;
    }

    const matcherGroups = config.hooks[eventName] ?? [];
    for (const matcherGroup of matcherGroups) {
        for (const handler of matcherGroup.hooks) {
            const handlerResult = await executeHookHandler(handler, payload, config, eventName, logger);
            result.handlers.push(handlerResult);

            if (handlerResult.error) {
                logger.warn(`Lifecycle hook handler failed for ${eventName}: ${handlerResult.error}`);
                continue;
            }

            const parsed = parseHookHandlerOutput(handlerResult.output);
            if (!parsed) {
                continue;
            }

            if (parsed.systemMessage?.trim()) {
                result.systemMessages.push(parsed.systemMessage.trim());
            }

            const deny = parsed.continue === false
                || parsed.decision === 'block'
                || parsed.decision === 'deny';
            if (deny && !result.blocked) {
                result.blocked = true;
                const reason = parsed.reason?.trim() || parsed.stopReason?.trim();
                if (reason) {
                    result.reason = reason;
                }
            }

            if (parsed.hookSpecificOutput?.additionalContext?.trim()) {
                result.additionalContexts.push(parsed.hookSpecificOutput.additionalContext.trim());
            }
        }
    }

    result.additionalContexts = Array.from(new Set(result.additionalContexts));
    result.systemMessages = Array.from(new Set(result.systemMessages));

    if (result.handlers.length > 0) {
        emitTelemetry({
            type: 'hook.completed',
            event: eventName,
            decision: result.blocked ? 'block' : 'allow',
            durationMs: Date.now() - startedAt,
            ...(config.sessionId ? { sessionId: config.sessionId } : {}),
        });
    }
    return result;
}

export function dispatchLifecycleHookFireAndForget(
    eventName: LifecycleHookEventName,
    payload: LifecycleHookPayload,
    config: HookRunnerConfigBase,
): void {
    const logger = config.logger ?? defaultLogger.child('LifecycleHookRunner');
    const timer = setTimeout(() => {
        logger.debug(`Lifecycle hook ${eventName} fire-and-forget timeout after ${FIRE_AND_FORGET_TIMEOUT_MS}ms`);
    }, FIRE_AND_FORGET_TIMEOUT_MS);
    timer.unref?.();

    dispatchLifecycleHook(eventName, payload, config).then(
        () => {
            clearTimeout(timer);
        },
        (error: unknown) => {
            clearTimeout(timer);
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`Lifecycle hook ${eventName} failed: ${message}`);
        },
    );
}

export function buildSessionStartPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    source: SessionStartHookPayload['source'];
}): SessionStartHookPayload {
    return {
        hook_event_name: 'SessionStart',
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        cwd: input.cwd,
        project_root: input.projectRoot,
        source: input.source,
    };
}

export function buildSessionEndPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    reason: SessionEndHookPayload['reason'];
}): SessionEndHookPayload {
    return {
        hook_event_name: 'SessionEnd',
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        cwd: input.cwd,
        project_root: input.projectRoot,
        reason: input.reason,
    };
}

export function buildStopPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    stopHookActive: boolean;
}): StopHookPayload {
    return {
        hook_event_name: 'Stop',
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        cwd: input.cwd,
        project_root: input.projectRoot,
        stop_hook_active: input.stopHookActive,
    };
}

export function buildSubagentStopPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    stopHookActive: boolean;
    subagent?: string;
}): SubagentStopHookPayload {
    return {
        hook_event_name: 'SubagentStop',
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        cwd: input.cwd,
        project_root: input.projectRoot,
        stop_hook_active: input.stopHookActive,
        ...(input.subagent ? { subagent: input.subagent } : {}),
    };
}

export function buildPreCompactPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    trigger: PreCompactHookPayload['trigger'];
    customInstructions?: string;
}): PreCompactHookPayload {
    return {
        hook_event_name: 'PreCompact',
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        cwd: input.cwd,
        project_root: input.projectRoot,
        trigger: input.trigger,
        ...(input.customInstructions ? { custom_instructions: input.customInstructions } : {}),
    };
}

export function buildPostCompactPayload(input: {
    sessionId?: string;
    cwd: string;
    projectRoot: string;
    trigger: PostCompactHookPayload['trigger'];
    messagesBefore: number;
    messagesAfter: number;
}): PostCompactHookPayload {
    return {
        hook_event_name: 'PostCompact',
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        cwd: input.cwd,
        project_root: input.projectRoot,
        trigger: input.trigger,
        messages_before: input.messagesBefore,
        messages_after: input.messagesAfter,
    };
}
