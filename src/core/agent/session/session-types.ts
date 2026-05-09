import type { LLMMessage } from '@xqoder/shared';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type { ConversationEventStoreRecord } from '../../../domain/conversation/transcript-projector.js';

export interface AgentSessionUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    cost?: number;
}

export interface AgentToolExecution {
    id: string;
    name: string;
    args: Record<string, unknown>;
    success: boolean;
    outputPreview: string;
    error?: string;
    metadata?: Record<string, unknown>;
    startedAt: Date;
    completedAt: Date;
}

export interface AgentCommandHistoryEntry {
    id: string;
    command: string;
    cwd: string;
    success: boolean;
    outputPreview: string;
    error?: string;
    startedAt: Date;
    completedAt: Date;
}

export interface AgentFileChangeEntry {
    id: string;
    path: string;
    changeType: 'write' | 'patch' | 'restore';
    bytes: number;
    existedBefore?: boolean;
    rollbackPointId?: string;
    success: boolean;
    timestamp: Date;
}

export interface AgentSessionCompaction {
    id: string;
    createdAt: Date;
    messageCountBefore: number;
    messageCountAfter: number;
    summary: string;
}

export interface AgentVerificationSignal {
    id: string;
    ok: boolean;
    blocked: boolean;
    summary: string;
    messages: string[];
    createdAt: Date;
}

export interface AgentCheckpointRecord {
    id: string;
    toolCallId: string;
    toolName: string;
    required: boolean;
    status: 'not_required' | 'captured' | 'missing';
    rollbackPointId?: string;
    timestamp: Date;
}

export type AgentApprovalDecision = 'allow' | 'ask' | 'deny';
export type AgentApprovalRisk = 'low' | 'medium' | 'high';

export interface AgentPendingApprovalRecord {
    requestId: string;
    toolCallId?: string;
    toolName?: string;
    kind: string;
    summary: string;
    reason?: string;
    preview?: string;
    risk?: AgentApprovalRisk;
    requestedAt: Date;
    source?: string;
    streamId?: string;
}

export interface AgentApprovalRecord extends AgentPendingApprovalRecord {
    decision: AgentApprovalDecision;
    resolvedAt: Date;
}

export interface AgentWorkflowState {
    kind: 'plan';
    rawGoal: string;
    normalizedGoal: string;
    completedAt: Date;
    sourceTurnId: string;
}

export type AgentToolResultRendererEvent =
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

export interface AgentToolResultTranscriptEntry {
    type: 'tool';
    content: string;
    toolCallId?: string;
    toolName?: string;
    success?: boolean;
}

export interface AgentToolResultEventStoreRecord {
    type: 'tool_result';
    sessionId: string;
    toolCallId: string;
    toolName: string;
    success: boolean;
    content: string;
    timestamp: number;
}

export type AgentConversationEventStoreRecord = ConversationEventStoreRecord;
export type AgentConversationEventEnvelope = ConversationEventEnvelope;

export interface AgentSessionMetadataSnapshot {
    compactSummary?: string;
    compactions: AgentSessionCompaction[];
    toolHistory: AgentToolExecution[];
    verificationHistory: AgentVerificationSignal[];
    checkpointHistory: AgentCheckpointRecord[];
    approvalHistory: AgentApprovalRecord[];
    pendingApprovals: AgentPendingApprovalRecord[];
    commandHistory: AgentCommandHistoryEntry[];
    fileChanges: AgentFileChangeEntry[];
    toolResultRendererEvents: AgentToolResultRendererEvent[];
    toolResultTranscriptEntries: AgentToolResultTranscriptEntry[];
    toolResultEventStoreRecords: AgentToolResultEventStoreRecord[];
    conversationEvents: AgentConversationEventStoreRecord[];
    conversationEventEnvelopes: AgentConversationEventEnvelope[];
    workflowState?: AgentWorkflowState;
}

export interface AgentSessionSnapshot {
    id: string;
    title?: string;
    createdAt: Date;
    maxMessages: number;
    messages: LLMMessage[];
    usage: AgentSessionUsage;
    metadata: AgentSessionMetadataSnapshot;
}

export interface AgentSessionOptions {
    id?: string;
    title?: string;
    createdAt?: Date;
    maxMessages?: number;
    systemPrompt?: string;
    messages?: LLMMessage[];
    usage?: Partial<AgentSessionUsage>;
    metadata?: Partial<AgentSessionMetadataSnapshot>;
}

export interface RecordToolExecutionInput {
    id: string;
    name: string;
    args: Record<string, unknown>;
    success: boolean;
    output: string;
    error?: string;
    startedAt?: Date;
    completedAt?: Date;
    metadata?: Record<string, unknown>;
}

export interface DerivedToolExecutionArtifacts {
    toolEvent: AgentToolExecution;
    commandEntry?: AgentCommandHistoryEntry;
    fileChanges: AgentFileChangeEntry[];
}

export interface RecordVerificationSignalInput {
    id?: string;
    ok: boolean;
    blocked: boolean;
    summary: string;
    messages?: string[];
    createdAt?: Date;
}

export interface SessionCompactionResult {
    summary: string;
    messages: LLMMessage[];
    compaction: AgentSessionCompaction;
}
