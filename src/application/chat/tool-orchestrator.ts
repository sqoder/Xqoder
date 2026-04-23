import type {
    AgentCommandHistoryEntry,
    AgentFileChangeEntry,
    AgentSession,
    AgentToolExecution,
} from '@xqoder/agent';
import type { LLMMessage, ToolCall, ToolResult } from '@xqoder/shared';
import { requiresCheckpointBeforeTool } from '../../domain/permissions/index.js';
import type {
    ToolCallPreparation,
    ToolExecutionPort,
} from '../../domain/conversation/tool-execution-port.js';
import {
    buildConversationTranscript,
    type ConversationTranscriptEntry,
} from '../../domain/conversation/messages.js';
import type { ConversationStopReason } from '../../domain/conversation/stop-reason.js';

export interface ToolExecutionCheckpoint {
    required: boolean;
    delegated: boolean;
    status: 'not_required' | 'captured' | 'missing';
    rollbackPointId?: string;
}

export type ToolExecutionStage =
    | 'pre_tool_use'
    | 'permission'
    | 'checkpoint'
    | 'execute'
    | 'collect'
    | 'post_tool_use'
    | 'write_tool_result'
    | 'emit_event';

export interface ToolExecutionStageRecord {
    stage: ToolExecutionStage;
    detail: string;
    delegated?: boolean;
}

export interface ToolResultEventStoreRecord {
    type: 'tool_result';
    sessionId: string;
    toolCallId: string;
    toolName: string;
    success: boolean;
    content: string;
    timestamp: number;
}

export type ToolResultRendererRecord =
    | {
        type: 'tool.output';
        sessionId: string;
        toolCallId: string;
        toolName: string;
        output: string;
        partial?: boolean;
        stream?: 'stdout' | 'stderr';
        timestamp: number;
    }
    | {
        type: 'tool.completed';
        sessionId: string;
        toolCallId: string;
        toolName: string;
        success: boolean;
        timestamp: number;
    };

export interface ToolExecutionResult {
    id: string;
    name: string;
    args: Record<string, unknown>;
    ok: boolean;
    stopReason?: ConversationStopReason;
    outputForModel: string;
    outputForUser: string;
    stages: ToolExecutionStageRecord[];
    toolHistoryEntry?: AgentToolExecution;
    commandHistory: AgentCommandHistoryEntry[];
    fileChanges: AgentFileChangeEntry[];
    modelMessages: LLMMessage[];
    rendererEvents: ToolResultRendererRecord[];
    transcriptEntries: ConversationTranscriptEntry[];
    eventStoreRecords: ToolResultEventStoreRecord[];
    checkpoint: ToolExecutionCheckpoint;
}

export interface ToolOrchestratorResult {
    results: ToolExecutionResult[];
    toolHistoryDelta: number;
    modelMessages: LLMMessage[];
    rendererEvents: ToolResultRendererRecord[];
    transcriptEntries: ConversationTranscriptEntry[];
    eventStoreRecords: ToolResultEventStoreRecord[];
}

export interface ToolOrchestratorDependencies<TCallbacks = unknown> {
    toolCalls?: ToolCall[];
    callbacks?: TCallbacks;
    streamId: string;
    session: AgentSession;
    toolExecutionPort?: ToolExecutionPort<TCallbacks>;
    executeToolCalls: (
        toolCalls: ToolCall[],
        callbacks: TCallbacks | undefined,
        streamId: string,
    ) => Promise<ToolResult[]>;
}

/**
 * Standardizes tool execution as an application-layer orchestration step.
 * The result includes tool_result projections for model, renderer, transcript, and event-store consumers.
 */
export async function runToolOrchestrator<TCallbacks = unknown>(
    dependencies: ToolOrchestratorDependencies<TCallbacks>,
): Promise<ToolOrchestratorResult> {
    if (!dependencies.toolCalls || dependencies.toolCalls.length === 0) {
        return {
            results: [],
            toolHistoryDelta: 0,
            modelMessages: [],
            rendererEvents: [],
            transcriptEntries: [],
            eventStoreRecords: [],
        };
    }

    const toolHistoryBaseline = dependencies.session.getToolHistory().length;
    const results: ToolExecutionResult[] = [];

    for (const toolCall of dependencies.toolCalls) {
        results.push(await executeSingleToolCall({
            toolCall,
            callbacks: dependencies.callbacks,
            streamId: dependencies.streamId,
            session: dependencies.session,
            toolExecutionPort: dependencies.toolExecutionPort,
            executeToolCalls: dependencies.executeToolCalls,
        }));
    }

    return {
        results,
        toolHistoryDelta: dependencies.session.getToolHistory().length - toolHistoryBaseline,
        modelMessages: results.flatMap((entry) => entry.modelMessages),
        rendererEvents: results.flatMap((entry) => entry.rendererEvents),
        transcriptEntries: results.flatMap((entry) => entry.transcriptEntries),
        eventStoreRecords: results.flatMap((entry) => entry.eventStoreRecords),
    };
}

async function executeSingleToolCall<TCallbacks = unknown>(input: {
    toolCall: ToolCall;
    callbacks?: TCallbacks;
    streamId: string;
    session: AgentSession;
    toolExecutionPort?: ToolExecutionPort<TCallbacks>;
    executeToolCalls: (
        toolCalls: ToolCall[],
        callbacks: TCallbacks | undefined,
        streamId: string,
    ) => Promise<ToolResult[]>;
}): Promise<ToolExecutionResult> {
    const checkpointRequired = requiresCheckpointBeforeTool(input.toolCall.name);
    const toolExecutionPort = input.toolExecutionPort
        ?? createCompatibilityToolExecutionPort({
            executeToolCalls: input.executeToolCalls,
        });
    const rendererProjection = createToolRendererProjection({
        sessionId: input.session.id,
        toolCall: input.toolCall,
        callbacks: input.callbacks,
    });
    const preparation = await toolExecutionPort.prepareToolCall({
        toolCall: input.toolCall,
        callbacks: rendererProjection.callbacks,
        streamId: input.streamId,
    });
    const stages: ToolExecutionStageRecord[] = [
        {
            stage: 'pre_tool_use',
            detail: preparation.preToolUseDetail,
        },
        {
            stage: 'permission',
            detail: preparation.permissionDetail,
        },
        {
            stage: 'checkpoint',
            detail: checkpointRequired
                ? 'Checkpoint required; rollback metadata will be collected from file-change artifacts after raw execution.'
                : 'No checkpoint metadata required for this tool call.',
        },
    ];
    const beforeMessages = input.session.getMessages();
    const beforeToolHistory = input.session.getToolHistory();
    const beforeCommandHistory = input.session.getCommandHistory();
    const beforeFileChanges = input.session.getFileChanges();

    const rawToolResult = preparation.blocked
        ? undefined
        : await toolExecutionPort.invokePreparedToolCall(preparation);
    stages.push({
        stage: 'execute',
        detail: preparation.blocked
            ? 'Skipped raw tool invocation because tool preparation produced a terminal result.'
            : 'Executed the prepared tool call through the raw invocation port.',
    });
    const toolResult = await toolExecutionPort.finalizeToolCall(preparation, rawToolResult);

    const toolHistoryEntry = input.session.getToolHistory()[beforeToolHistory.length];
    const commandHistory = input.session.getCommandHistory().slice(beforeCommandHistory.length);
    const fileChanges = input.session.getFileChanges().slice(beforeFileChanges.length);
    const collectedToolMessages = input.session.getMessages()
        .slice(beforeMessages.length)
        .filter((message) => message.role === 'tool' && message.toolCallId === input.toolCall.id);
    const toolMessages = ensureToolResultMessage({
        session: input.session,
        toolCall: input.toolCall,
        toolMessages: collectedToolMessages,
        toolHistoryEntry,
    });
    const toolResultContent = toolMessages.at(-1)?.content
        ?? buildFallbackToolResultContent(toolHistoryEntry);
    stages.push({
        stage: 'collect',
        detail: `Collected ${toolMessages.length} tool_result message(s), ${commandHistory.length} command delta(s), and ${fileChanges.length} file change delta(s).`,
    });
    const transcriptEntries = buildConversationTranscript({
        messages: toolMessages.map((message) => ({
            role: message.role,
            content: String(message.content ?? ''),
            ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        })),
        toolHistory: toolHistoryEntry
            ? [{
                id: toolHistoryEntry.id,
                name: toolHistoryEntry.name,
                success: toolHistoryEntry.success,
            }]
            : [],
    });
    const fallbackRendererEvents = buildToolResultRendererRecords({
        sessionId: input.session.id,
        toolCall: input.toolCall,
        toolHistoryEntry,
        toolMessages,
        fallbackContent: toolResultContent,
    });
    const rendererEvents = rendererProjection.rendererEvents.length > 0
        ? rendererProjection.rendererEvents
        : fallbackRendererEvents;
    if (rendererProjection.rendererEvents.length === 0) {
        rendererProjection.replayFallback({
            args: parseToolCallArguments(input.toolCall.arguments),
            output: toolResultContent,
            success: toolHistoryEntry?.success ?? false,
        });
    }
    const eventStoreRecords = buildToolResultEventStoreRecords({
        sessionId: input.session.id,
        toolCall: input.toolCall,
        toolHistoryEntry,
        toolMessages,
        fallbackContent: toolResultContent,
    });
    stages.push({
        stage: 'post_tool_use',
        detail: preparation.blocked
            ? 'Finalized the blocked tool call without raw execution.'
            : 'Applied post-tool finalization before projecting tool_result artifacts.',
    });
    stages.push({
        stage: 'write_tool_result',
        detail: `Projected tool_result to model (${toolMessages.length}), renderer (${rendererEvents.length}), transcript (${transcriptEntries.length}), and event-store (${eventStoreRecords.length}) artifacts${rendererProjection.rendererEvents.length > 0 ? ' via the ToolOrchestrator callback proxy' : ' via session fallback synthesis'}.`,
    });
    stages.push({
        stage: 'emit_event',
        detail: `Prepared ${rendererEvents.length} renderer event artifact(s) for envelope-aware surfaces.`,
    });
    const checkpointMetadata = resolveCheckpointMetadata(fileChanges);
    const checkpoint = {
        required: checkpointRequired,
        delegated: false,
        status: checkpointRequired
            ? (checkpointMetadata.rollbackPointId ? 'captured' : 'missing')
            : 'not_required',
        ...checkpointMetadata,
    } satisfies ToolExecutionCheckpoint;

    const stopReason = resolveToolExecutionStopReason(toolResult);

    return {
        id: input.toolCall.id,
        name: input.toolCall.name,
        args: parseToolCallArguments(input.toolCall.arguments),
        ok: toolHistoryEntry?.success ?? false,
        ...(stopReason ? { stopReason } : {}),
        outputForModel: toolResultContent,
        outputForUser: toolResultContent,
        stages,
        ...(toolHistoryEntry ? { toolHistoryEntry } : {}),
        commandHistory,
        fileChanges,
        modelMessages: toolMessages,
        rendererEvents,
        transcriptEntries,
        eventStoreRecords,
        checkpoint,
    };
}

function createCompatibilityToolExecutionPort<TCallbacks = unknown>(input: {
    executeToolCalls: (
        toolCalls: ToolCall[],
        callbacks: TCallbacks | undefined,
        streamId: string,
    ) => Promise<ToolResult[]>;
}): ToolExecutionPort<TCallbacks> {
    return {
        async prepareToolCall(params) {
            return {
                toolCall: params.toolCall,
                args: parseToolCallArguments(params.toolCall.arguments),
                callbacks: params.callbacks,
                streamId: params.streamId,
                permissionMode: 'allow',
                blocked: false,
                preToolUseDetail: 'Prepared the tool call through the application-level compatibility port.',
                permissionDetail: 'Compatibility port will resolve permission and approval during execution.',
                state: undefined,
            } satisfies ToolCallPreparation<TCallbacks>;
        },
        async invokePreparedToolCall(preparation) {
            const results = await input.executeToolCalls(
                [preparation.toolCall],
                preparation.callbacks,
                preparation.streamId,
            );
            return results?.[0];
        },
        async finalizeToolCall(preparation, result) {
            return result ?? {
                toolCallId: preparation.toolCall.id,
                success: false,
                output: '',
                error: `Tool execution produced no result: ${preparation.toolCall.name}`,
            };
        },
    };
}

function resolveToolExecutionStopReason(
    toolResult: ToolResult | undefined,
): ConversationStopReason | undefined {
    const stopReason = toolResult?.metadata?.['stopReason'];
    return stopReason === 'permission_denied'
        ? stopReason
        : undefined;
}

function parseToolCallArguments(argumentsText: string | undefined): Record<string, unknown> {
    if (!argumentsText?.trim()) {
        return {};
    }

    try {
        const parsed = JSON.parse(argumentsText) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

function resolveCheckpointMetadata(
    fileChanges: AgentFileChangeEntry[],
): Partial<ToolExecutionCheckpoint> {
    const rollbackPointId = [...fileChanges]
        .reverse()
        .find((entry) => typeof entry.rollbackPointId === 'string')
        ?.rollbackPointId;

    return rollbackPointId ? { rollbackPointId } : {};
}

function createToolRendererProjection<TCallbacks = unknown>(input: {
    sessionId: string;
    toolCall: ToolCall;
    callbacks?: TCallbacks;
}): {
    callbacks: TCallbacks | undefined;
    rendererEvents: ToolResultRendererRecord[];
    replayFallback: (params: {
        args: Record<string, unknown>;
        output: string;
        success: boolean;
    }) => void;
} {
    if (!input.callbacks || typeof input.callbacks !== 'object') {
        return {
            callbacks: input.callbacks,
            rendererEvents: [],
            replayFallback: () => {},
        };
    }

    const originalCallbacks = input.callbacks as {
        onToolStart?: (name: string, args: Record<string, unknown>) => void;
        onToolStream?: (name: string, chunk: string, stream: 'stdout' | 'stderr') => void;
        onToolEnd?: (name: string, result: string, success: boolean) => void;
    };
    const rendererEvents: ToolResultRendererRecord[] = [];
    let sawToolStart = false;
    let sawToolEnd = false;
    let timestampOffset = 0;
    const nextTimestamp = () => Date.now() + timestampOffset++;

    const wrappedCallbacks = {
        ...originalCallbacks,
        onToolStart: (name: string, args: Record<string, unknown>) => {
            sawToolStart = true;
            try { originalCallbacks.onToolStart?.(name, args); } catch { /* noop */ }
        },
        onToolStream: (name: string, chunk: string, stream: 'stdout' | 'stderr') => {
            rendererEvents.push({
                type: 'tool.output',
                sessionId: input.sessionId,
                toolCallId: input.toolCall.id,
                toolName: name,
                output: chunk,
                partial: true,
                stream,
                timestamp: nextTimestamp(),
            });
            try { originalCallbacks.onToolStream?.(name, chunk, stream); } catch { /* noop */ }
        },
        onToolEnd: (name: string, result: string, success: boolean) => {
            sawToolEnd = true;
            rendererEvents.push({
                type: 'tool.output',
                sessionId: input.sessionId,
                toolCallId: input.toolCall.id,
                toolName: name,
                output: result,
                timestamp: nextTimestamp(),
            });
            rendererEvents.push({
                type: 'tool.completed',
                sessionId: input.sessionId,
                toolCallId: input.toolCall.id,
                toolName: name,
                success,
                timestamp: nextTimestamp(),
            });
            try { originalCallbacks.onToolEnd?.(name, result, success); } catch { /* noop */ }
        },
    } satisfies typeof originalCallbacks;

    return {
        callbacks: wrappedCallbacks as TCallbacks,
        rendererEvents,
        replayFallback: ({ args, output, success }) => {
            if (!sawToolStart) {
                try { originalCallbacks.onToolStart?.(input.toolCall.name, args); } catch { /* noop */ }
            }
            if (!sawToolEnd) {
                try { originalCallbacks.onToolEnd?.(input.toolCall.name, output, success); } catch { /* noop */ }
            }
        },
    };
}

function ensureToolResultMessage(input: {
    session: AgentSession;
    toolCall: ToolCall;
    toolMessages: LLMMessage[];
    toolHistoryEntry?: AgentToolExecution;
}): LLMMessage[] {
    if (input.toolMessages.length > 0) {
        return input.toolMessages;
    }

    const synthesizedContent = buildFallbackToolResultContent(input.toolHistoryEntry);
    if (!synthesizedContent) {
        return input.toolMessages;
    }

    input.session.addToolResult(input.toolCall.id, synthesizedContent);
    return [{
        role: 'tool',
        content: synthesizedContent,
        toolCallId: input.toolCall.id,
    } satisfies LLMMessage];
}

function buildFallbackToolResultContent(
    toolHistoryEntry: AgentToolExecution | undefined,
): string {
    if (!toolHistoryEntry) {
        return '';
    }

    if (toolHistoryEntry.success) {
        return toolHistoryEntry.outputPreview;
    }

    const error = String(toolHistoryEntry.error ?? '').trim();
    if (error.length > 0) {
        return error.startsWith('Error:') ? error : `Error: ${error}`;
    }

    return toolHistoryEntry.outputPreview;
}

function buildToolResultRendererRecords(input: {
    sessionId: string;
    toolCall: ToolCall;
    toolHistoryEntry?: AgentToolExecution;
    toolMessages: LLMMessage[];
    fallbackContent: string;
}): ToolResultRendererRecord[] {
    const toolOutputs = input.toolMessages.length > 0
        ? input.toolMessages
        : [{
            role: 'tool',
            content: input.fallbackContent,
            toolCallId: input.toolCall.id,
        } satisfies LLMMessage];

    return [
        ...toolOutputs.map((message, index) => ({
            type: 'tool.output',
            sessionId: input.sessionId,
            toolCallId: input.toolCall.id,
            toolName: input.toolCall.name,
            output: String(message.content ?? ''),
            timestamp: resolveToolResultTimestamp(input.toolHistoryEntry, index),
        } satisfies ToolResultRendererRecord)),
        {
            type: 'tool.completed',
            sessionId: input.sessionId,
            toolCallId: input.toolCall.id,
            toolName: input.toolCall.name,
            success: input.toolHistoryEntry?.success ?? false,
            timestamp: resolveToolResultTimestamp(input.toolHistoryEntry, toolOutputs.length),
        },
    ];
}

function buildToolResultEventStoreRecords(input: {
    sessionId: string;
    toolCall: ToolCall;
    toolHistoryEntry?: AgentToolExecution;
    toolMessages: LLMMessage[];
    fallbackContent: string;
}): ToolResultEventStoreRecord[] {
    if (input.toolMessages.length > 0) {
        return input.toolMessages.map((message, index) => ({
            type: 'tool_result',
            sessionId: input.sessionId,
            toolCallId: input.toolCall.id,
            toolName: input.toolCall.name,
            success: input.toolHistoryEntry?.success ?? false,
            content: String(message.content ?? ''),
            timestamp: resolveToolResultTimestamp(input.toolHistoryEntry, index),
        }));
    }

    return [{
        type: 'tool_result',
        sessionId: input.sessionId,
        toolCallId: input.toolCall.id,
        toolName: input.toolCall.name,
        success: input.toolHistoryEntry?.success ?? false,
        content: input.fallbackContent,
        timestamp: resolveToolResultTimestamp(input.toolHistoryEntry, 0),
    }];
}

function resolveToolResultTimestamp(
    toolHistoryEntry: AgentToolExecution | undefined,
    offset: number,
): number {
    const baseTime = toolHistoryEntry?.completedAt?.getTime()
        ?? toolHistoryEntry?.startedAt?.getTime()
        ?? Date.now();
    return baseTime + offset;
}
