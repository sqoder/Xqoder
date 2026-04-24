import type { LLMMessage } from '@xqoder/shared';

import { sanitizeToolArgs } from './session-metadata.js';
import type {
    AgentApprovalRecord,
    AgentConversationEventEnvelope,
    AgentCheckpointRecord,
    AgentPendingApprovalRecord,
    AgentConversationEventStoreRecord,
    AgentCommandHistoryEntry,
    AgentFileChangeEntry,
    AgentSessionCompaction,
    AgentToolResultEventStoreRecord,
    AgentToolResultRendererEvent,
    AgentToolResultTranscriptEntry,
    AgentToolExecution,
    AgentVerificationSignal,
    AgentWorkflowState,
} from './session-types.js';

export function cloneMessages(messages: LLMMessage[]): LLMMessage[] {
    return messages.map(cloneMessage);
}

export function cloneMessage(message: LLMMessage): LLMMessage {
    return {
        ...message,
        ...(message.attachments
            ? {
                attachments: message.attachments.map((attachment) => ({ ...attachment })),
            }
            : {}),
        ...(message.toolCalls
            ? {
                toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })),
            }
            : {}),
    };
}

export function cloneCompaction(compaction: AgentSessionCompaction): AgentSessionCompaction {
    return {
        ...compaction,
        createdAt: new Date(compaction.createdAt),
    };
}

export function cloneToolExecution(entry: AgentToolExecution): AgentToolExecution {
    return {
        ...entry,
        args: sanitizeToolArgs(entry.args),
        startedAt: new Date(entry.startedAt),
        completedAt: new Date(entry.completedAt),
    };
}

export function cloneVerificationSignal(entry: AgentVerificationSignal): AgentVerificationSignal {
    return {
        ...entry,
        messages: [...entry.messages],
        createdAt: new Date(entry.createdAt),
    };
}

export function cloneCheckpointRecord(entry: AgentCheckpointRecord): AgentCheckpointRecord {
    return {
        ...entry,
        timestamp: new Date(entry.timestamp),
    };
}

export function clonePendingApprovalRecord(entry: AgentPendingApprovalRecord): AgentPendingApprovalRecord {
    return {
        ...entry,
        requestedAt: new Date(entry.requestedAt),
    };
}

export function cloneApprovalRecord(entry: AgentApprovalRecord): AgentApprovalRecord {
    return {
        ...entry,
        requestedAt: new Date(entry.requestedAt),
        resolvedAt: new Date(entry.resolvedAt),
    };
}

export function cloneWorkflowState(entry: AgentWorkflowState): AgentWorkflowState {
    return {
        ...entry,
        completedAt: new Date(entry.completedAt),
    };
}

export function cloneCommandHistoryEntry(entry: AgentCommandHistoryEntry): AgentCommandHistoryEntry {
    return {
        ...entry,
        startedAt: new Date(entry.startedAt),
        completedAt: new Date(entry.completedAt),
    };
}

export function cloneFileChangeEntry(entry: AgentFileChangeEntry): AgentFileChangeEntry {
    return {
        ...entry,
        timestamp: new Date(entry.timestamp),
    };
}

export function cloneToolResultRendererEvent(
    entry: AgentToolResultRendererEvent,
): AgentToolResultRendererEvent {
    return { ...entry };
}

export function cloneToolResultTranscriptEntry(
    entry: AgentToolResultTranscriptEntry,
): AgentToolResultTranscriptEntry {
    return { ...entry };
}

export function cloneToolResultEventStoreRecord(
    entry: AgentToolResultEventStoreRecord,
): AgentToolResultEventStoreRecord {
    return { ...entry };
}

export function cloneConversationEventStoreRecord(
    entry: AgentConversationEventStoreRecord,
): AgentConversationEventStoreRecord {
    return { ...entry };
}

export function cloneConversationEventEnvelope(
    entry: AgentConversationEventEnvelope,
): AgentConversationEventEnvelope {
    return JSON.parse(JSON.stringify(entry)) as AgentConversationEventEnvelope;
}
