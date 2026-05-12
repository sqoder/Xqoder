// P09 sub-PR 2: stop-hook helpers extracted from conversation-engine.ts.
//
// Pure detectors — they describe *whether* a stop condition fires and produce
// the message + stopReason the caller should raise. They do not emit events
// or throw; the caller (conversation-engine.ts → query-loop.ts in sub-PR 3)
// still owns ConversationEngineStopError wrapping and side effects.
//
// Covered detectors:
//   - duplicate_tool_batch  → detectDuplicateToolBatch
//   - no_progress           → detectNoProgressOnBlocker
//   - permission_denied msg → resolvePermissionDeniedStopMessage
//   - runtime forced stop   → resolveForcedStopDirective
//
// max_turns / max_tool_calls / max_wall_time live in query-config.ts.

import type { ToolCall } from '@xqoder/shared';
import type { ConversationStopReason } from '../../domain/conversation/stop-reason.js';

type StoppableReason = Exclude<ConversationStopReason, 'completed' | 'user_cancelled'>;

export interface StopDirective {
    readonly stopReason: StoppableReason;
    readonly message: string;
    readonly agentEndReason: 'failed' | 'error';
}

export interface RuntimeForcedStopDirective {
    readonly stopReason: Extract<ConversationStopReason, 'max_turns' | 'max_wall_time'>;
    readonly message: string;
}

export interface RuntimeForcedStopSource {
    getForcedStopDirective?(): RuntimeForcedStopDirective | undefined;
    getForcedStopMessage?(): string | undefined;
}

export function createToolCallBatchFingerprint(toolCalls: readonly ToolCall[]): string {
    return toolCalls
        .map((toolCall) => `${toolCall.name}:${normalizeToolArguments(toolCall.arguments)}`)
        .join('|');
}

export function describeToolCallBatch(toolCalls: readonly ToolCall[]): string {
    return toolCalls
        .map((toolCall) => `${toolCall.name}(${normalizeToolArguments(toolCall.arguments)})`)
        .join(', ');
}

export function createBlockedContinuationFingerprint(
    blocker: string,
    assistantContent: string,
): string {
    return `${normalizeContinuationField(blocker)}::${normalizeContinuationField(assistantContent)}`;
}

export function normalizeContinuationField(value: string | undefined): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeToolArguments(argumentsText: string | undefined): string {
    if (!argumentsText?.trim()) {
        return '{}';
    }

    try {
        return stableStringify(JSON.parse(argumentsText) as unknown);
    } catch {
        return argumentsText.trim();
    }
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
            .join(',')}}`;
    }

    return JSON.stringify(value);
}

export function detectDuplicateToolBatch(input: {
    toolCalls: readonly ToolCall[];
    lastFingerprint: string | undefined;
}): StopDirective | undefined {
    const fingerprint = createToolCallBatchFingerprint(input.toolCalls);
    if (fingerprint !== input.lastFingerprint) {
        return undefined;
    }

    return {
        stopReason: 'duplicate_tool_call',
        message: `Duplicate tool call batch detected: ${describeToolCallBatch(input.toolCalls)}`,
        agentEndReason: 'failed',
    };
}

export function detectNoProgressOnBlocker(input: {
    blocker: string;
    assistantContent: string;
    lastFingerprint: string | undefined;
    stopReason: StoppableReason;
}): StopDirective | undefined {
    const fingerprint = createBlockedContinuationFingerprint(
        input.blocker,
        input.assistantContent,
    );
    if (fingerprint !== input.lastFingerprint) {
        return undefined;
    }

    return {
        stopReason: input.stopReason,
        message: `No progress detected while waiting on blocker: ${input.blocker}`,
        agentEndReason: 'failed',
    };
}

export function resolveForcedStopDirective(
    runtime: RuntimeForcedStopSource | undefined,
): RuntimeForcedStopDirective | undefined {
    if (!runtime) {
        return undefined;
    }

    const directive = runtime.getForcedStopDirective?.();
    if (directive) {
        return directive;
    }

    const legacyMessage = runtime.getForcedStopMessage?.();
    if (!legacyMessage) {
        return undefined;
    }

    return {
        stopReason: legacyMessage.includes('timeout') ? 'max_wall_time' : 'max_turns',
        message: legacyMessage,
    };
}

export interface PermissionDeniedExecutionLike {
    name: string;
    stopReason?: ConversationStopReason;
    toolHistoryEntry?: { error?: string };
}

export function resolvePermissionDeniedStopMessage(
    executions: readonly PermissionDeniedExecutionLike[],
): string | undefined {
    const deniedExecution = executions.find((execution) => execution.stopReason === 'permission_denied');
    if (!deniedExecution) {
        return undefined;
    }

    return deniedExecution.toolHistoryEntry?.error
        ?? `Tool "${deniedExecution.name}" was denied by the active permission policy`;
}
