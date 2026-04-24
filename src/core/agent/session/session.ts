// ============================================================
// Agent Session Management
// ============================================================

import type { LLMMessage, MessageAttachment } from '@xqoder/shared';
import type { ConversationEventEnvelope } from '@xqoder/protocol';

import {
    cloneApprovalRecord,
    cloneCheckpointRecord,
    cloneConversationEventEnvelope,
    cloneConversationEventStoreRecord,
    cloneCommandHistoryEntry,
    cloneCompaction,
    cloneFileChangeEntry,
    cloneMessage,
    cloneMessages,
    clonePendingApprovalRecord,
    cloneToolResultEventStoreRecord,
    cloneToolResultRendererEvent,
    cloneToolResultTranscriptEntry,
    cloneToolExecution,
    cloneVerificationSignal,
    cloneWorkflowState,
} from './session-cloners.js';
import {
    createAutoCompactionResult,
    createManualCompactionResult,
    findBaseSystemMessage,
} from './session-compaction.js';
import {
    deriveToolExecutionArtifacts,
    normalizeSessionMetadataSnapshot as normalizeMetadataSnapshot,
} from './session-metadata.js';
import type {
    AgentApprovalRecord,
    AgentCheckpointRecord,
    AgentConversationEventEnvelope,
    AgentConversationEventStoreRecord,
    AgentCommandHistoryEntry,
    AgentFileChangeEntry,
    AgentSessionCompaction,
    AgentSessionMetadataSnapshot,
    AgentSessionOptions,
    AgentSessionSnapshot,
    AgentPendingApprovalRecord,
    AgentToolResultEventStoreRecord,
    AgentToolResultRendererEvent,
    AgentToolResultTranscriptEntry,
    AgentSessionUsage,
    AgentToolExecution,
    AgentVerificationSignal,
    AgentWorkflowState,
    RecordVerificationSignalInput,
    RecordToolExecutionInput,
} from './session-types.js';
import { generateSessionId, normalizeDate, readString } from './session-utils.js';

export { normalizeSessionMetadataSnapshot } from './session-metadata.js';
export type {
    AgentApprovalRecord,
    AgentCheckpointRecord,
    AgentConversationEventStoreRecord,
    AgentCommandHistoryEntry,
    AgentFileChangeEntry,
    AgentPendingApprovalRecord,
    AgentSessionCompaction,
    AgentSessionMetadataSnapshot,
    AgentSessionSnapshot,
    AgentSessionUsage,
    AgentToolResultEventStoreRecord,
    AgentToolResultRendererEvent,
    AgentToolResultTranscriptEntry,
    AgentToolExecution,
    AgentVerificationSignal,
} from './session-types.js';

const EMPTY_USAGE: AgentSessionUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
};

function normalizeApprovalStreamId(streamId: string | undefined): string | undefined {
    const trimmed = streamId?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function hasSameApprovalIdentity(
    left: Pick<AgentPendingApprovalRecord, 'requestId' | 'streamId'>,
    right: Pick<AgentPendingApprovalRecord, 'requestId' | 'streamId'>,
): boolean {
    return left.requestId === right.requestId
        && normalizeApprovalStreamId(left.streamId) === normalizeApprovalStreamId(right.streamId);
}

function findApprovalIndexForResolution(
    approvals: AgentPendingApprovalRecord[],
    identity: Pick<AgentPendingApprovalRecord, 'requestId' | 'streamId'>,
): number {
    const streamId = normalizeApprovalStreamId(identity.streamId);
    if (streamId) {
        return approvals.findIndex((entry) =>
            entry.requestId === identity.requestId
            && normalizeApprovalStreamId(entry.streamId) === streamId
        );
    }

    const legacyIndex = approvals.findIndex((entry) =>
        entry.requestId === identity.requestId
        && normalizeApprovalStreamId(entry.streamId) === undefined
    );
    if (legacyIndex >= 0) {
        return legacyIndex;
    }

    const matchingIndexes = approvals
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.requestId === identity.requestId)
        .map(({ index }) => index);
    return matchingIndexes.length === 1 ? matchingIndexes[0]! : -1;
}

function findApprovalForResolution(
    approvals: AgentPendingApprovalRecord[],
    identity: Pick<AgentPendingApprovalRecord, 'requestId' | 'streamId'>,
): AgentPendingApprovalRecord | undefined {
    const index = findApprovalIndexForResolution(approvals, identity);
    return index >= 0 ? approvals[index] : undefined;
}

/**
 * AgentSession
 * Manages message history and context for a single Agent session
 */
export class AgentSession {
    readonly id: string;
    private title?: string;
    private messages: LLMMessage[] = [];
    private readonly maxMessages: number;
    readonly createdAt: Date;
    private usage: AgentSessionUsage;
    private compactSummary?: string;
    private compactions: AgentSessionCompaction[];
    private toolHistory: AgentToolExecution[];
    private verificationHistory: AgentVerificationSignal[];
    private checkpointHistory: AgentCheckpointRecord[];
    private approvalHistory: AgentApprovalRecord[];
    private pendingApprovals: AgentPendingApprovalRecord[];
    private commandHistory: AgentCommandHistoryEntry[];
    private fileChanges: AgentFileChangeEntry[];
    private toolResultRendererEvents: AgentToolResultRendererEvent[];
    private toolResultTranscriptEntries: AgentToolResultTranscriptEntry[];
    private toolResultEventStoreRecords: AgentToolResultEventStoreRecord[];
    private conversationEvents: AgentConversationEventStoreRecord[];
    private conversationEventEnvelopes: AgentConversationEventEnvelope[];
    private workflowState?: AgentWorkflowState;

    constructor(systemPrompt?: string, maxMessages?: number);
    constructor(options: AgentSessionOptions);
    constructor(
        systemPromptOrOptions?: string | AgentSessionOptions,
        maxMessages: number = 100,
    ) {
        const options: AgentSessionOptions = typeof systemPromptOrOptions === 'object' && systemPromptOrOptions !== null
            ? systemPromptOrOptions
            : {
                systemPrompt: typeof systemPromptOrOptions === 'string' ? systemPromptOrOptions : undefined,
                maxMessages,
            };
        const metadata = normalizeMetadataSnapshot(options.metadata);

        this.id = options.id ?? generateSessionId();
        this.title = readString(options.title);
        this.maxMessages = options.maxMessages ?? 100;
        this.createdAt = normalizeDate(options.createdAt) ?? new Date();
        this.usage = {
            ...EMPTY_USAGE,
            ...(options.usage ?? {}),
        };
        this.compactSummary = metadata.compactSummary;
        this.compactions = metadata.compactions;
        this.toolHistory = metadata.toolHistory;
        this.verificationHistory = metadata.verificationHistory;
        this.checkpointHistory = metadata.checkpointHistory;
        this.approvalHistory = metadata.approvalHistory;
        this.pendingApprovals = metadata.pendingApprovals;
        this.commandHistory = metadata.commandHistory;
        this.fileChanges = metadata.fileChanges;
        this.toolResultRendererEvents = metadata.toolResultRendererEvents;
        this.toolResultTranscriptEntries = metadata.toolResultTranscriptEntries;
        this.toolResultEventStoreRecords = metadata.toolResultEventStoreRecords;
        this.conversationEvents = metadata.conversationEvents;
        this.conversationEventEnvelopes = metadata.conversationEventEnvelopes;
        this.workflowState = metadata.workflowState;

        if (options.messages && options.messages.length > 0) {
            this.messages = cloneMessages(options.messages);
        } else if (options.systemPrompt) {
            this.messages.push({ role: 'system', content: options.systemPrompt as string });
        }

        this.compactIfNeeded();
    }

    /** Add message */
    addMessage(message: LLMMessage): void {
        const clonedMessage = cloneMessage(message);
        this.messages.push(clonedMessage);
        this.recordConversationEventForMessage(clonedMessage);
        this.compactIfNeeded();
    }

    /** Add user message */
    addUserMessage(content: string, attachments?: MessageAttachment[]): void {
        this.addMessage({
            role: 'user',
            content,
            ...(attachments && attachments.length > 0
                ? {
                    attachments: attachments.map((attachment) => ({ ...attachment })),
                }
                : {}),
        });
    }

    /** Add assistant message */
    addAssistantMessage(message: LLMMessage): void {
        this.addMessage(message);
    }

    /** Add tool result message */
    addToolResult(toolCallId: string, content: string): void {
        this.addMessage({ role: 'tool', content, toolCallId });
        const toolExecution = [...this.toolHistory]
            .reverse()
            .find((entry) => entry.id === toolCallId);
        if (this.shouldAppendLegacyConversationEvents()) {
            this.appendConversationEvent({
                seq: this.getNextConversationEventSeq(),
                type: 'tool_result',
                sessionId: this.id,
                timestamp: toolExecution?.completedAt.getTime() ?? Date.now(),
                toolCallId,
                toolName: toolExecution?.name ?? 'unknown_tool',
                success: toolExecution?.success ?? false,
                content,
            });
        }
    }

    /** Record cumulative Token usage */
    recordUsage(usage: Partial<AgentSessionUsage>): void {
        this.usage = {
            promptTokens: this.usage.promptTokens + (usage.promptTokens ?? 0),
            completionTokens: this.usage.completionTokens + (usage.completionTokens ?? 0),
            totalTokens: this.usage.totalTokens + (usage.totalTokens ?? 0),
            cacheReadTokens: (this.usage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
            cacheCreationTokens: (this.usage.cacheCreationTokens ?? 0) + (usage.cacheCreationTokens ?? 0),
            cost: (this.usage.cost ?? 0) + (usage.cost ?? 0),
        };
    }

    /** Record a tool execution and derive command/file history */
    recordToolExecution(input: RecordToolExecutionInput): void {
        const { toolEvent, commandEntry, fileChanges } = deriveToolExecutionArtifacts(input);
        this.toolHistory.push(toolEvent);

        if (commandEntry) {
            this.commandHistory.push(commandEntry);
        }

        if (fileChanges.length > 0) {
            this.fileChanges.push(...fileChanges);
        }
    }

    /** Record a structured verification signal without mutating the message transcript */
    recordVerification(input: RecordVerificationSignalInput): void {
        const summary = readString(input.summary);
        if (!summary) {
            return;
        }

        const messages = Array.isArray(input.messages)
            ? input.messages
                .map((message) => readString(message))
                .filter((message): message is string => Boolean(message))
            : [];

        this.verificationHistory.push({
            id: input.id?.trim() || `verification_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            ok: Boolean(input.ok),
            blocked: Boolean(input.blocked),
            summary,
            messages,
            createdAt: normalizeDate(input.createdAt) ?? new Date(),
        });
        const verification = this.verificationHistory[this.verificationHistory.length - 1]!;
        const verificationMessages = verification.messages.length > 0
            ? verification.messages
            : [verification.summary];
        if (this.shouldAppendLegacyConversationEvents()) {
            for (const content of verificationMessages) {
                this.appendConversationEvent({
                    seq: this.getNextConversationEventSeq(),
                    type: 'verification_result',
                    sessionId: this.id,
                    timestamp: verification.createdAt.getTime(),
                    verificationId: verification.id,
                    ok: verification.ok,
                    blocked: verification.blocked,
                    summary: verification.summary,
                    content,
                });
            }
        }
    }

    recordCheckpoint(input: {
        toolCallId: string;
        toolName: string;
        required: boolean;
        status: 'not_required' | 'captured' | 'missing';
        rollbackPointId?: string;
        timestamp?: Date;
    }): void {
        const timestamp = normalizeDate(input.timestamp) ?? new Date();
        const record: AgentCheckpointRecord = {
            id: `checkpoint_${input.toolCallId}`,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            required: Boolean(input.required),
            status: input.status,
            ...(readString(input.rollbackPointId) ? { rollbackPointId: readString(input.rollbackPointId) } : {}),
            timestamp,
        };

        this.checkpointHistory.push(record);
        if (this.shouldAppendLegacyConversationEvents()) {
            this.appendConversationEvent({
                seq: this.getNextConversationEventSeq(),
                type: 'checkpoint',
                sessionId: this.id,
                timestamp: timestamp.getTime(),
                checkpointId: record.id,
                toolCallId: record.toolCallId,
                toolName: record.toolName,
                required: record.required,
                status: record.status,
                ...(record.rollbackPointId ? { rollbackPointId: record.rollbackPointId } : {}),
            });
        }
    }

    recordConversationEnvelopeEvent(
        event: ConversationEventEnvelope,
    ): void {
        if (this.conversationEventEnvelopes.some((entry) => entry.eventId === event.eventId)) {
            return;
        }

        this.conversationEventEnvelopes.push(cloneConversationEventEnvelope(event));
        this.recordApprovalFromEnvelopeEvent(event);
    }

    recordApprovalRequested(input: AgentPendingApprovalRecord): void {
        const record = clonePendingApprovalRecord(input);
        const existingIndex = this.pendingApprovals.findIndex((entry) => hasSameApprovalIdentity(entry, record));
        if (existingIndex >= 0) {
            this.pendingApprovals.splice(existingIndex, 1, record);
            return;
        }

        this.pendingApprovals.push(record);
    }

    recordApprovalResolved(input: AgentApprovalRecord): void {
        const record = cloneApprovalRecord(input);
        const pendingIndex = findApprovalIndexForResolution(this.pendingApprovals, record);
        if (pendingIndex >= 0) {
            this.pendingApprovals.splice(pendingIndex, 1);
        }

        const existingIndex = this.approvalHistory.findIndex((entry) =>
            hasSameApprovalIdentity(entry, record)
            && entry.resolvedAt.getTime() === record.resolvedAt.getTime()
        );
        if (existingIndex >= 0) {
            this.approvalHistory.splice(existingIndex, 1, record);
            return;
        }

        this.approvalHistory.push(record);
    }

    recordToolResultArtifacts(input: {
        rendererEvents?: AgentToolResultRendererEvent[];
        transcriptEntries?: AgentToolResultTranscriptEntry[];
        eventStoreRecords?: AgentToolResultEventStoreRecord[];
    }): void {
        if (Array.isArray(input.rendererEvents) && input.rendererEvents.length > 0) {
            this.toolResultRendererEvents.push(...input.rendererEvents.map(cloneToolResultRendererEvent));
        }
        if (Array.isArray(input.transcriptEntries) && input.transcriptEntries.length > 0) {
            this.toolResultTranscriptEntries.push(...input.transcriptEntries.map(cloneToolResultTranscriptEntry));
        }
        if (Array.isArray(input.eventStoreRecords) && input.eventStoreRecords.length > 0) {
            const clonedRecords = input.eventStoreRecords.map(cloneToolResultEventStoreRecord);
            this.toolResultEventStoreRecords.push(...clonedRecords);
            if (this.shouldAppendLegacyConversationEvents()) {
                for (const record of clonedRecords) {
                    this.appendConversationEvent({
                        seq: this.getNextConversationEventSeq(),
                        type: 'tool_result',
                        sessionId: record.sessionId,
                        timestamp: record.timestamp,
                        toolCallId: record.toolCallId,
                        toolName: record.toolName,
                        success: record.success,
                        content: record.content,
                    });
                }
            }
        }
    }

    /** Get all messages */
    getMessages(): LLMMessage[] {
        return cloneMessages(this.messages);
    }

    /** Get message count */
    get messageCount(): number {
        return this.messages.length;
    }

    /** Get cumulative Token usage */
    getUsage(): AgentSessionUsage {
        return { ...this.usage };
    }

    /** Get current session title */
    getTitle(): string | undefined {
        return this.title;
    }

    /** Replace or insert the base system prompt while preserving other history */
    setSystemPrompt(systemPrompt: string | undefined): void {
        const normalizedPrompt = readString(systemPrompt);
        const systemIndex = this.messages.findIndex((message) => message.role === 'system' && !message.content.startsWith('[XQoder auto-compact summary]'));

        if (!normalizedPrompt) {
            if (systemIndex >= 0) {
                this.messages.splice(systemIndex, 1);
            }
            return;
        }

        const nextSystemMessage = { role: 'system', content: normalizedPrompt } as const;
        if (systemIndex >= 0) {
            this.messages.splice(systemIndex, 1, nextSystemMessage);
            return;
        }

        this.messages.unshift(nextSystemMessage);
    }

    /** Update session title */
    setTitle(title: string | undefined): void {
        this.title = readString(title);
    }

    /** Get auto-compaction summary */
    getCompactSummary(): string | undefined {
        return this.compactSummary;
    }

    /** Get compaction history */
    getCompactions(): AgentSessionCompaction[] {
        return this.compactions.map(cloneCompaction);
    }

    /** Get tool execution history */
    getToolHistory(): AgentToolExecution[] {
        return this.toolHistory.map(cloneToolExecution);
    }

    /** Get verification signal history */
    getVerificationHistory(): AgentVerificationSignal[] {
        return this.verificationHistory.map(cloneVerificationSignal);
    }

    /** Get checkpoint metadata history */
    getCheckpointHistory(): AgentCheckpointRecord[] {
        return this.checkpointHistory.map(cloneCheckpointRecord);
    }

    getApprovalHistory(): AgentApprovalRecord[] {
        return this.approvalHistory.map(cloneApprovalRecord);
    }

    getPendingApprovals(): AgentPendingApprovalRecord[] {
        return this.pendingApprovals.map(clonePendingApprovalRecord);
    }

    /** Get command execution history */
    getCommandHistory(): AgentCommandHistoryEntry[] {
        return this.commandHistory.map(cloneCommandHistoryEntry);
    }

    /** Get file change history */
    getFileChanges(): AgentFileChangeEntry[] {
        return this.fileChanges.map(cloneFileChangeEntry);
    }

    getToolResultRendererEvents(): AgentToolResultRendererEvent[] {
        return this.toolResultRendererEvents.map(cloneToolResultRendererEvent);
    }

    getToolResultTranscriptEntries(): AgentToolResultTranscriptEntry[] {
        return this.toolResultTranscriptEntries.map(cloneToolResultTranscriptEntry);
    }

    getToolResultEventStoreRecords(): AgentToolResultEventStoreRecord[] {
        return this.toolResultEventStoreRecords.map(cloneToolResultEventStoreRecord);
    }

    getConversationEvents(): AgentConversationEventStoreRecord[] {
        return this.conversationEvents.map(cloneConversationEventStoreRecord);
    }

    getConversationEventEnvelopes(): AgentConversationEventEnvelope[] {
        return this.conversationEventEnvelopes.map(cloneConversationEventEnvelope);
    }

    getWorkflowState(): AgentWorkflowState | undefined {
        return this.workflowState ? cloneWorkflowState(this.workflowState) : undefined;
    }

    recordWorkflowState(input: AgentWorkflowState): void {
        this.workflowState = cloneWorkflowState(input);
    }

    clearWorkflowState(): void {
        this.workflowState = undefined;
    }

    /** Get session metadata snapshot */
    getMetadata(): AgentSessionMetadataSnapshot {
        return {
            ...(this.compactSummary ? { compactSummary: this.compactSummary } : {}),
            compactions: this.getCompactions(),
            toolHistory: this.getToolHistory(),
            verificationHistory: this.getVerificationHistory(),
            checkpointHistory: this.getCheckpointHistory(),
            approvalHistory: this.getApprovalHistory(),
            pendingApprovals: this.getPendingApprovals(),
            commandHistory: this.getCommandHistory(),
            fileChanges: this.getFileChanges(),
            toolResultRendererEvents: this.getToolResultRendererEvents(),
            toolResultTranscriptEntries: this.getToolResultTranscriptEntries(),
            toolResultEventStoreRecords: this.getToolResultEventStoreRecords(),
            conversationEvents: this.getConversationEvents(),
            conversationEventEnvelopes: this.getConversationEventEnvelopes(),
            ...(this.workflowState ? { workflowState: this.getWorkflowState() } : {}),
        };
    }

    /** Export persistable snapshot */
    toSnapshot(): AgentSessionSnapshot {
        return {
            id: this.id,
            ...(this.title ? { title: this.title } : {}),
            createdAt: this.createdAt,
            maxMessages: this.maxMessages,
            messages: this.getMessages(),
            usage: this.getUsage(),
            metadata: this.getMetadata(),
        };
    }

    /** Recover a session from a snapshot */
    static fromSnapshot(snapshot: AgentSessionSnapshot): AgentSession {
        return new AgentSession({
            id: snapshot.id,
            title: snapshot.title,
            createdAt: snapshot.createdAt,
            maxMessages: snapshot.maxMessages,
            messages: snapshot.messages,
            usage: snapshot.usage,
            metadata: snapshot.metadata,
        });
    }

    /** Clear messages (retain system prompt) */
    clear(): void {
        const systemMessage = findBaseSystemMessage(this.messages);
        this.messages = systemMessage ? [cloneMessage(systemMessage)] : [];
        this.compactSummary = undefined;
        this.compactions = [];
        this.toolHistory = [];
        this.verificationHistory = [];
        this.checkpointHistory = [];
        this.approvalHistory = [];
        this.pendingApprovals = [];
        this.commandHistory = [];
        this.fileChanges = [];
        this.toolResultRendererEvents = [];
        this.toolResultTranscriptEntries = [];
        this.toolResultEventStoreRecords = [];
        this.conversationEvents = [];
        this.conversationEventEnvelopes = [];
        this.workflowState = undefined;
    }

    /** Force session compaction using externally provided summary */
    performCompaction(summary: string): void {
        const result = createManualCompactionResult({
            messages: this.messages,
            summary,
        });

        this.compactSummary = result.summary;
        this.compactions.push(result.compaction);
        this.messages = result.messages;
    }

    private recordConversationEventForMessage(message: LLMMessage): void {
        if (message.role !== 'user' && message.role !== 'assistant') {
            return;
        }

        if (!this.shouldAppendLegacyConversationEvents()) {
            return;
        }

        this.appendConversationEvent({
            seq: this.getNextConversationEventSeq(),
            type: message.role === 'user' ? 'user_message' : 'assistant_message',
            sessionId: this.id,
            timestamp: Date.now(),
            content: String(message.content ?? ''),
        });
    }

    private shouldAppendLegacyConversationEvents(): boolean {
        return this.conversationEventEnvelopes.length === 0;
    }

    private recordApprovalFromEnvelopeEvent(event: ConversationEventEnvelope): void {
        if (event.type !== 'approval.requested' && event.type !== 'approval.resolved') {
            return;
        }

        const payload = event.payload as unknown as Record<string, unknown>;
        const requestId = readString(payload.requestId);
        if (!requestId) {
            return;
        }
        const metadata = typeof payload.metadata === 'object' && payload.metadata !== null
            ? payload.metadata as Record<string, unknown>
            : {};
        const streamId = readString(payload.streamId) ?? readString(metadata.streamId);

        if (event.type === 'approval.requested') {
            const rawPayload = typeof payload.payload === 'object' && payload.payload !== null
                ? payload.payload as Record<string, unknown>
                : {};
            const summary = readString(rawPayload.summary) ?? readString(payload.summary);
            if (!summary) {
                return;
            }

            this.recordApprovalRequested({
                requestId,
                ...(readString(rawPayload.toolCallId) ? { toolCallId: readString(rawPayload.toolCallId) } : {}),
                ...(readString(rawPayload.toolName) ? { toolName: readString(rawPayload.toolName) } : {}),
                kind: readString(payload.kind) ?? 'tool',
                summary,
                ...(readString(rawPayload.reason) ? { reason: readString(rawPayload.reason) } : {}),
                ...(readString(rawPayload.preview) ? { preview: readString(rawPayload.preview) } : {}),
                ...(rawPayload.risk === 'low' || rawPayload.risk === 'medium' || rawPayload.risk === 'high'
                    ? { risk: rawPayload.risk }
                    : {}),
                requestedAt: new Date(event.timestamp),
                ...(readString(payload.source) ? { source: readString(payload.source) } : {}),
                ...(streamId ? { streamId } : {}),
            });
            return;
        }

        const decision = payload.decision;
        if (decision !== 'allow' && decision !== 'ask' && decision !== 'deny') {
            return;
        }

        const pending = findApprovalForResolution(this.pendingApprovals, { requestId, streamId });
        const source = pending?.source ?? readString(payload.source);
        const resolvedStreamId = streamId ?? pending?.streamId;
        this.recordApprovalResolved({
            requestId,
            ...(pending?.toolCallId ? { toolCallId: pending.toolCallId } : {}),
            ...(pending?.toolName ? { toolName: pending.toolName } : {}),
            kind: pending?.kind ?? 'tool',
            summary: pending?.summary ?? `Approval ${requestId}`,
            ...(pending?.reason ? { reason: pending.reason } : {}),
            ...(pending?.preview ? { preview: pending.preview } : {}),
            ...(pending?.risk ? { risk: pending.risk } : {}),
            decision,
            requestedAt: pending?.requestedAt ?? new Date(event.timestamp),
            resolvedAt: new Date(event.timestamp),
            ...(source ? { source } : {}),
            ...(resolvedStreamId ? { streamId: resolvedStreamId } : {}),
        });
    }

    private appendConversationEvent(
        event: AgentConversationEventStoreRecord,
    ): void {
        if (event.type === 'tool_result') {
            const duplicateToolResult = this.conversationEvents.find((entry) =>
                entry.type === 'tool_result'
                && entry.toolCallId === event.toolCallId
                && entry.toolName === event.toolName
                && entry.success === event.success
                && entry.content === event.content,
            );
            if (duplicateToolResult) {
                return;
            }
        }

        this.conversationEvents.push({ ...event });
    }

    private getNextConversationEventSeq(): number {
        return this.conversationEvents.reduce(
            (maxSeq, event) => Math.max(maxSeq, event.seq),
            -1,
        ) + 1;
    }

    /** Automatically compact old context when message limit is exceeded */
    private compactIfNeeded(): void {
        const result = createAutoCompactionResult({
            messages: this.messages,
            maxMessages: this.maxMessages,
            compactSummary: this.compactSummary,
            commandHistory: this.commandHistory,
            fileChanges: this.fileChanges,
        });

        if (!result) {
            return;
        }

        this.compactSummary = result.summary;
        this.compactions.push(result.compaction);
        this.messages = result.messages;
    }
}
