import type { TaskMode, ToolCall, ToolResult } from '@xqoder/shared';
import type { AgentSession } from '@xqoder/agent';
import {
    runToolOrchestrator,
    type ToolResultEventStoreRecord,
    type ToolExecutionResult,
    type ToolResultRendererRecord,
} from './tool-orchestrator.js';
import {
    createNoopVerificationGateResult,
    runVerificationGate,
    type VerificationGateResult,
    type VerificationGateRuntime,
} from './verification-gate.js';
import type { ConversationTranscriptEntry } from '../../domain/conversation/messages.js';
import type { ToolExecutionPort } from '../../domain/conversation/tool-execution-port.js';
import type { LLMMessage } from '@xqoder/shared';

export interface ToolFollowUpResult {
    handled: boolean;
    toolCallCount: number;
    toolHistoryDelta: number;
    executions: ToolExecutionResult[];
    modelMessages: LLMMessage[];
    rendererEvents: ToolResultRendererRecord[];
    transcriptEntries: ConversationTranscriptEntry[];
    eventStoreRecords: ToolResultEventStoreRecord[];
    verification: VerificationGateResult;
}

export interface ToolFollowUpDependencies<TCallbacks = unknown> {
    toolCalls?: ToolCall[];
    callbacks?: TCallbacks;
    streamId: string;
    session: AgentSession;
    runtime?: VerificationGateRuntime;
    taskMode?: TaskMode;
    toolExecutionPort?: ToolExecutionPort<TCallbacks>;
    executeToolCalls: (
        toolCalls: ToolCall[],
        callbacks: TCallbacks | undefined,
        streamId: string,
    ) => Promise<ToolResult[]>;
}

/**
 * Unifies tool execution plus verifier/recovery follow-up as the turn's post-provider phase.
 * The low-level tool executor and MVP runtime controller stay behind this application seam.
 */
export async function handleToolFollowUp<TCallbacks = unknown>(
    dependencies: ToolFollowUpDependencies<TCallbacks>,
): Promise<ToolFollowUpResult> {
    if (!dependencies.toolCalls || dependencies.toolCalls.length === 0) {
        return {
            handled: false,
            toolCallCount: 0,
            toolHistoryDelta: 0,
            executions: [],
            modelMessages: [],
            rendererEvents: [],
            transcriptEntries: [],
            eventStoreRecords: [],
            verification: createNoopVerificationGateResult(),
        };
    }

    const execution = await runToolOrchestrator({
        toolCalls: dependencies.toolCalls,
        callbacks: dependencies.callbacks,
        streamId: dependencies.streamId,
        session: dependencies.session,
        toolExecutionPort: dependencies.toolExecutionPort,
        executeToolCalls: dependencies.executeToolCalls,
    });
    const verification = await runVerificationGate({
        session: dependencies.session,
        runtime: dependencies.runtime,
        executions: execution.results,
        taskMode: dependencies.taskMode,
    });

    return {
        handled: true,
        toolCallCount: dependencies.toolCalls.length,
        toolHistoryDelta: execution.toolHistoryDelta,
        executions: execution.results,
        modelMessages: execution.modelMessages,
        rendererEvents: execution.rendererEvents,
        transcriptEntries: execution.transcriptEntries,
        eventStoreRecords: execution.eventStoreRecords,
        verification,
    };
}
