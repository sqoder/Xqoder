import type { ConfigManager, HookEventName } from '@xqoder/shared';
import { SUPPORTED_HOOK_EVENTS, isHookEventName } from '@xqoder/shared';
import {
    buildSessionStartPayload,
    buildSessionEndPayload,
    buildStopPayload,
    buildSubagentStopPayload,
    buildPreCompactPayload,
    buildPostCompactPayload,
    buildPreToolUseHookPayload,
    buildPostToolUseHookPayload,
    dispatchLifecycleHook,
    runToolHooks,
    type LifecycleHookEventName,
    type LifecycleHookPayload,
} from '@xqoder/agent';
import {
    createLayeredConfigSnapshot,
} from '../system/config-targets.js';
import type {
    HookTestOptions,
    HookTestResult,
    HooksCommandDependencies,
} from '../system/hooks.js';

const LIFECYCLE_HOOK_EVENTS: ReadonlySet<LifecycleHookEventName> = new Set<LifecycleHookEventName>([
    'SessionStart',
    'SessionEnd',
    'Stop',
    'SubagentStop',
    'PreCompact',
    'PostCompact',
]);

function isLifecycleHookEvent(value: HookEventName): value is LifecycleHookEventName {
    return LIFECYCLE_HOOK_EVENTS.has(value as LifecycleHookEventName);
}

function writeOutput(output: string, dependencies: HooksCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}

function resolveRequiredEventName(value: string | undefined): HookEventName {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error('hook --event is required');
    }
    if (!isHookEventName(normalized)) {
        throw new Error(`Unsupported hook event: ${normalized}. Supported events: ${SUPPORTED_HOOK_EVENTS.join(', ')}`);
    }
    return normalized;
}

function resolveHooksSnapshotOptions(options: HookTestOptions): { cwd?: string } {
    const cwd = options.dir?.trim() || options.cwd?.trim();
    return cwd ? { cwd } : {};
}

function resolveOverrideEnum<T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T {
    if (typeof value !== 'string') return fallback;
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function parsePayloadOverride(raw: string | undefined): Record<string, unknown> | undefined {
    if (!raw?.trim()) return undefined;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        throw new Error('hook test --payload must be valid JSON object');
    }
    throw new Error('hook test --payload must be JSON object');
}

function buildLifecycleTestPayload(
    eventName: LifecycleHookEventName,
    cwd: string,
    override: Record<string, unknown> | undefined,
): LifecycleHookPayload {
    switch (eventName) {
        case 'SessionStart':
            return buildSessionStartPayload({
                cwd,
                projectRoot: cwd,
                source: resolveOverrideEnum<'startup' | 'resume' | 'clear' | 'compact'>(
                    override?.['source'],
                    'startup',
                    ['startup', 'resume', 'clear', 'compact'],
                ),
            });
        case 'SessionEnd':
            return buildSessionEndPayload({
                cwd,
                projectRoot: cwd,
                reason: resolveOverrideEnum<'clear' | 'logout' | 'prompt_input_exit' | 'other'>(
                    override?.['reason'],
                    'other',
                    ['clear', 'logout', 'prompt_input_exit', 'other'],
                ),
            });
        case 'Stop':
            return buildStopPayload({ cwd, projectRoot: cwd, stopHookActive: false });
        case 'SubagentStop':
            return buildSubagentStopPayload({
                cwd,
                projectRoot: cwd,
                stopHookActive: false,
                ...(typeof override?.['subagent'] === 'string' ? { subagent: override['subagent'] } : {}),
            });
        case 'PreCompact':
            return buildPreCompactPayload({
                cwd,
                projectRoot: cwd,
                trigger: resolveOverrideEnum<'manual' | 'auto'>(override?.['trigger'], 'manual', ['manual', 'auto']),
                ...(typeof override?.['custom_instructions'] === 'string' ? { customInstructions: override['custom_instructions'] } : {}),
            });
        case 'PostCompact':
            return buildPostCompactPayload({
                cwd,
                projectRoot: cwd,
                trigger: resolveOverrideEnum<'manual' | 'auto'>(override?.['trigger'], 'manual', ['manual', 'auto']),
                messagesBefore: typeof override?.['messages_before'] === 'number' ? override['messages_before'] as number : 10,
                messagesAfter: typeof override?.['messages_after'] === 'number' ? override['messages_after'] as number : 3,
            });
    }
}

export async function runTestHookCommand(
    options: HookTestOptions,
    dependencies: HooksCommandDependencies,
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'>,
): Promise<HookTestResult> {
    const eventName = resolveRequiredEventName(options.event);
    const snapshot = createLayeredConfigSnapshot(resolveHooksSnapshotOptions(options), manager);
    const hooks = snapshot.config.hooks;
    const disableAllHooks = snapshot.config.disableAllHooks ?? false;
    const cwd = snapshot.cwd;
    const payloadOverride = parsePayloadOverride(options.payloadJson);

    const runnerConfig = {
        cwd,
        projectRoot: cwd,
        sessionId: `hooks-test-${Date.now()}`,
        ...(hooks ? { hooks } : {}),
        ...(disableAllHooks ? { disableAllHooks: true } : {}),
    };

    let blocked = false;
    let reason: string | undefined;
    let additionalContexts: string[] = [];
    let systemMessages: string[] = [];
    let handlers: HookTestResult['handlers'] = [];

    if (isLifecycleHookEvent(eventName)) {
        const payload = buildLifecycleTestPayload(eventName, cwd, payloadOverride);
        const result = await dispatchLifecycleHook(eventName, payload, runnerConfig);
        blocked = result.blocked;
        reason = result.reason;
        additionalContexts = result.additionalContexts;
        systemMessages = result.systemMessages;
        handlers = result.handlers.map((handler) => ({
            type: handler.type,
            ...(handler.error ? { error: handler.error } : {}),
            ...(handler.output ? { output: handler.output } : {}),
        }));
    } else if (eventName === 'PreToolUse' || eventName === 'PostToolUse') {
        const toolName = options.toolName?.trim() || 'run_command';
        const payload = eventName === 'PreToolUse'
            ? buildPreToolUseHookPayload({
                cwd,
                projectRoot: cwd,
                permissionMode: 'allow',
                toolName,
                toolInput: payloadOverride ?? {},
                toolUseId: 'hooks-test-tool',
            })
            : buildPostToolUseHookPayload({
                cwd,
                projectRoot: cwd,
                permissionMode: 'allow',
                toolName,
                toolInput: payloadOverride ?? {},
                toolUseId: 'hooks-test-tool',
                toolResult: { toolCallId: 'hooks-test-tool', success: true, output: 'test output' },
            });
        const toolResult = await runToolHooks(eventName, payload, {
            ...runnerConfig,
            permissionMode: 'allow',
        });
        blocked = toolResult.decision === 'block'
            || !toolResult.continue
            || toolResult.permissionDecision === 'deny';
        reason = toolResult.reason
            ?? toolResult.stopReason
            ?? (toolResult.permissionDecision === 'deny' ? toolResult.permissionDecisionReason : undefined);
        additionalContexts = toolResult.additionalContexts;
        systemMessages = toolResult.systemMessages;
        handlers = toolResult.handlers.map((handler) => ({
            type: handler.type,
            ...(handler.error ? { error: handler.error } : {}),
            ...(handler.output ? { output: handler.output } : {}),
        }));
    } else {
        throw new Error(`hook test not supported yet for ${eventName} (use show/add/remove to configure; runtime dispatch happens inline)`);
    }

    const result: HookTestResult = {
        event: eventName,
        executedHandlers: handlers.length,
        blocked,
        ...(reason ? { reason } : {}),
        additionalContexts,
        systemMessages,
        handlers,
    };

    if (options.json) {
        writeOutput(JSON.stringify(result, null, 2), dependencies);
    } else {
        const lines = [
            `event=${result.event}`,
            `executedHandlers=${result.executedHandlers}`,
            `blocked=${result.blocked ? 'yes' : 'no'}`,
            ...(result.reason ? [`reason=${result.reason}`] : []),
        ];
        if (result.systemMessages.length > 0) {
            lines.push('systemMessages:', ...result.systemMessages.map((entry) => `  - ${entry}`));
        }
        if (result.additionalContexts.length > 0) {
            lines.push('additionalContexts:', ...result.additionalContexts.map((entry) => `  - ${entry}`));
        }
        for (const [index, handler] of result.handlers.entries()) {
            lines.push(`handler[${index}] type=${handler.type}${handler.error ? ` error=${handler.error}` : ''}`);
        }
        writeOutput(lines.join('\n'), dependencies);
    }

    return result;
}
