import type {
    AgentApprovalRecord,
    AgentConversationEventEnvelope,
    AgentCheckpointRecord,
    AgentConversationEventStoreRecord,
    AgentCommandHistoryEntry,
    AgentFileChangeEntry,
    AgentSessionCompaction,
    AgentSessionMetadataSnapshot,
    AgentPendingApprovalRecord,
    AgentToolResultEventStoreRecord,
    AgentToolResultRendererEvent,
    AgentToolResultTranscriptEntry,
    AgentToolExecution,
    AgentVerificationSignal,
    AgentWorkflowState,
    DerivedToolExecutionArtifacts,
    RecordToolExecutionInput,
} from './session-types.js';
import {
    MAX_ARG_PREVIEW_LENGTH,
    MAX_TEXT_PREVIEW_LENGTH,
    createTextPreview,
    isFileChangeType,
    normalizeDate,
    readNumber,
    readString,
    truncateText,
} from './session-utils.js';

export function normalizeSessionMetadataSnapshot(
    metadata: Partial<AgentSessionMetadataSnapshot> | undefined | unknown,
): AgentSessionMetadataSnapshot {
    const source = typeof metadata === 'object' && metadata !== null
        ? metadata as Partial<AgentSessionMetadataSnapshot>
        : undefined;

    return {
        ...(readString(source?.compactSummary)
            ? { compactSummary: readString(source?.compactSummary) }
            : {}),
        compactions: Array.isArray(source?.compactions)
            ? source.compactions
                .map(normalizeCompaction)
                .filter((entry): entry is AgentSessionCompaction => entry !== null)
            : [],
        toolHistory: Array.isArray(source?.toolHistory)
            ? source.toolHistory
                .map(normalizeToolExecution)
                .filter((entry): entry is AgentToolExecution => entry !== null)
            : [],
        verificationHistory: Array.isArray(source?.verificationHistory)
            ? source.verificationHistory
                .map(normalizeVerificationSignal)
                .filter((entry): entry is AgentVerificationSignal => entry !== null)
            : [],
        checkpointHistory: Array.isArray(source?.checkpointHistory)
            ? source.checkpointHistory
                .map(normalizeCheckpointRecord)
                .filter((entry): entry is AgentCheckpointRecord => entry !== null)
            : [],
        approvalHistory: Array.isArray(source?.approvalHistory)
            ? source.approvalHistory
                .map(normalizeApprovalRecord)
                .filter((entry): entry is AgentApprovalRecord => entry !== null)
            : [],
        pendingApprovals: Array.isArray(source?.pendingApprovals)
            ? source.pendingApprovals
                .map(normalizePendingApprovalRecord)
                .filter((entry): entry is AgentPendingApprovalRecord => entry !== null)
            : [],
        commandHistory: Array.isArray(source?.commandHistory)
            ? source.commandHistory
                .map(normalizeCommandHistoryEntry)
                .filter((entry): entry is AgentCommandHistoryEntry => entry !== null)
            : [],
        fileChanges: Array.isArray(source?.fileChanges)
            ? source.fileChanges
                .map(normalizeFileChangeEntry)
                .filter((entry): entry is AgentFileChangeEntry => entry !== null)
            : [],
        toolResultRendererEvents: Array.isArray(source?.toolResultRendererEvents)
            ? source.toolResultRendererEvents
                .map(normalizeToolResultRendererEvent)
                .filter((entry): entry is AgentToolResultRendererEvent => entry !== null)
            : [],
        toolResultTranscriptEntries: Array.isArray(source?.toolResultTranscriptEntries)
            ? source.toolResultTranscriptEntries
                .map(normalizeToolResultTranscriptEntry)
                .filter((entry): entry is AgentToolResultTranscriptEntry => entry !== null)
            : [],
        toolResultEventStoreRecords: Array.isArray(source?.toolResultEventStoreRecords)
            ? source.toolResultEventStoreRecords
                .map(normalizeToolResultEventStoreRecord)
                .filter((entry): entry is AgentToolResultEventStoreRecord => entry !== null)
            : [],
        conversationEvents: Array.isArray(source?.conversationEvents)
            ? source.conversationEvents
                .map(normalizeConversationEventStoreRecord)
                .filter((entry): entry is AgentConversationEventStoreRecord => entry !== null)
            : [],
        conversationEventEnvelopes: Array.isArray(source?.conversationEventEnvelopes)
            ? source.conversationEventEnvelopes
                .map(normalizeConversationEventEnvelope)
                .filter((entry): entry is AgentConversationEventEnvelope => entry !== null)
            : [],
        ...(normalizeWorkflowState(source?.workflowState)
            ? { workflowState: normalizeWorkflowState(source?.workflowState)! }
            : {}),
    };
}

export function deriveToolExecutionArtifacts(
    input: RecordToolExecutionInput,
): DerivedToolExecutionArtifacts {
    const startedAt = normalizeDate(input.startedAt) ?? new Date();
    const completedAt = normalizeDate(input.completedAt) ?? startedAt;
    const outputPreview = createTextPreview(input.output);
    const errorPreview = input.error
        ? truncateText(input.error, MAX_TEXT_PREVIEW_LENGTH)
        : undefined;

    const toolEvent: AgentToolExecution = {
        id: input.id,
        name: input.name,
        args: sanitizeToolArgs(input.args),
        success: input.success,
        outputPreview,
        ...(errorPreview ? { error: errorPreview } : {}),
        ...createToolExecutionPublicMetadata(input.metadata),
        startedAt,
        completedAt,
    };

    const metadata = input.metadata ?? {};
    const command = readString(metadata['command']);
    const cwd = readString(metadata['cwd']);
    const commandEntry = command && cwd
        ? {
            id: input.id,
            command,
            cwd,
            success: input.success,
            outputPreview,
            ...(errorPreview ? { error: errorPreview } : {}),
            startedAt,
            completedAt,
        }
        : undefined;

    const filePath = readString(metadata['path']);
    const changeType = readString(metadata['changeType']);
    const bytes = readNumber(metadata['bytes']) ?? 0;
    const fileChanges: AgentFileChangeEntry[] = [];

    if (filePath && isFileChangeType(changeType)) {
        fileChanges.push({
            id: input.id,
            path: filePath,
            changeType,
            bytes,
            success: input.success,
            ...(typeof metadata['existedBefore'] === 'boolean'
                ? { existedBefore: metadata['existedBefore'] }
                : {}),
            ...(readString(metadata['rollbackPointId'])
                ? { rollbackPointId: readString(metadata['rollbackPointId']) }
                : {}),
            timestamp: completedAt,
        });
    }

    const filePaths = Array.isArray(metadata['filePaths'])
        ? metadata['filePaths'].filter((value): value is string => typeof value === 'string')
        : [];
    if (!filePath && filePaths.length > 0 && isFileChangeType(changeType)) {
        for (const changedPath of filePaths) {
            fileChanges.push({
                id: input.id,
                path: changedPath,
                changeType,
                bytes,
                success: input.success,
                ...(readString(metadata['rollbackPointId'])
                    ? { rollbackPointId: readString(metadata['rollbackPointId']) }
                    : {}),
                timestamp: completedAt,
            });
        }
    }

    return {
        toolEvent,
        ...(commandEntry ? { commandEntry } : {}),
        fileChanges,
    };
}

function createToolExecutionPublicMetadata(
    metadata: Record<string, unknown> | undefined,
): { metadata: Record<string, unknown> } | {} {
    const publicMetadata: Record<string, unknown> = {};
    for (const key of ['persistedOutputPath', 'originalOutputChars', 'previewedOutputChars']) {
        if (metadata?.[key] !== undefined) {
            publicMetadata[key] = metadata[key];
        }
    }

    return Object.keys(publicMetadata).length > 0
        ? { metadata: publicMetadata }
        : {};
}

export function sanitizeToolArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!args) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(args).map(([key, value]) => [key, sanitizeToolArgValue(key, value)]),
    );
}

function normalizeToolExecution(value: unknown): AgentToolExecution | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentToolExecution>;
    const id = readString(entry.id);
    const name = readString(entry.name);
    const startedAt = normalizeDate(entry.startedAt);
    const completedAt = normalizeDate(entry.completedAt);

    if (!id || !name || !startedAt || !completedAt) {
        return null;
    }

    return {
        id,
        name,
        args: sanitizeToolArgs(entry.args as Record<string, unknown> | undefined),
        success: Boolean(entry.success),
        outputPreview: createTextPreview(readString(entry.outputPreview) ?? ''),
        ...(readString(entry.error) ? { error: readString(entry.error) } : {}),
        ...createToolExecutionPublicMetadata(
            typeof entry.metadata === 'object' && entry.metadata !== null
                ? entry.metadata as Record<string, unknown>
                : undefined,
        ),
        startedAt,
        completedAt,
    };
}

function normalizeCommandHistoryEntry(value: unknown): AgentCommandHistoryEntry | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentCommandHistoryEntry>;
    const id = readString(entry.id);
    const command = readString(entry.command);
    const cwd = readString(entry.cwd);
    const startedAt = normalizeDate(entry.startedAt);
    const completedAt = normalizeDate(entry.completedAt);

    if (!id || !command || !cwd || !startedAt || !completedAt) {
        return null;
    }

    return {
        id,
        command,
        cwd,
        success: Boolean(entry.success),
        outputPreview: createTextPreview(readString(entry.outputPreview) ?? ''),
        ...(readString(entry.error) ? { error: readString(entry.error) } : {}),
        startedAt,
        completedAt,
    };
}

function normalizeVerificationSignal(value: unknown): AgentVerificationSignal | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentVerificationSignal>;
    const id = readString(entry.id);
    const summary = readString(entry.summary);
    const createdAt = normalizeDate(entry.createdAt);

    if (!id || !summary || !createdAt) {
        return null;
    }

    return {
        id,
        ok: Boolean(entry.ok),
        blocked: Boolean(entry.blocked),
        summary,
        messages: Array.isArray(entry.messages)
            ? entry.messages
                .map((message) => readString(message))
                .filter((message): message is string => Boolean(message))
            : [],
        createdAt,
    };
}

function normalizeFileChangeEntry(value: unknown): AgentFileChangeEntry | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentFileChangeEntry>;
    const id = readString(entry.id);
    const filePath = readString(entry.path);
    const timestamp = normalizeDate(entry.timestamp);
    const bytes = readNumber(entry.bytes);

    if (!id || !filePath || !timestamp || bytes === undefined) {
        return null;
    }

    return {
        id,
        path: filePath,
        changeType: isFileChangeType(entry.changeType) ? entry.changeType : 'write',
        bytes,
        success: Boolean(entry.success),
        ...(typeof entry.existedBefore === 'boolean' ? { existedBefore: entry.existedBefore } : {}),
        ...(readString(entry.rollbackPointId) ? { rollbackPointId: readString(entry.rollbackPointId) } : {}),
        timestamp,
    };
}

function normalizeCheckpointRecord(value: unknown): AgentCheckpointRecord | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentCheckpointRecord>;
    const id = readString(entry.id);
    const toolCallId = readString(entry.toolCallId);
    const toolName = readString(entry.toolName);
    const timestamp = normalizeDate(entry.timestamp);
    const status = readString(entry.status);

    if (!id || !toolCallId || !toolName || !timestamp || !status) {
        return null;
    }

    return {
        id,
        toolCallId,
        toolName,
        required: Boolean(entry.required),
        status: status === 'captured' || status === 'missing' || status === 'not_required'
            ? status
            : 'missing',
        ...(readString(entry.rollbackPointId) ? { rollbackPointId: readString(entry.rollbackPointId) } : {}),
        timestamp,
    };
}

function normalizePendingApprovalRecord(value: unknown): AgentPendingApprovalRecord | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentPendingApprovalRecord>;
    const requestId = readString(entry.requestId);
    const kind = readString(entry.kind);
    const summary = readString(entry.summary);
    const requestedAt = normalizeDate(entry.requestedAt);

    if (!requestId || !kind || !summary || !requestedAt) {
        return null;
    }

    return {
        requestId,
        ...(readString(entry.toolCallId) ? { toolCallId: readString(entry.toolCallId) } : {}),
        ...(readString(entry.toolName) ? { toolName: readString(entry.toolName) } : {}),
        kind,
        summary: createTextPreview(summary),
        ...(readString(entry.reason) ? { reason: createTextPreview(readString(entry.reason)!) } : {}),
        ...(readString(entry.preview) ? { preview: createTextPreview(readString(entry.preview)!) } : {}),
        ...(entry.risk === 'low' || entry.risk === 'medium' || entry.risk === 'high'
            ? { risk: entry.risk }
            : {}),
        requestedAt,
        ...(readString(entry.source) ? { source: readString(entry.source) } : {}),
        ...(readString(entry.streamId) ? { streamId: readString(entry.streamId) } : {}),
    };
}

function normalizeApprovalRecord(value: unknown): AgentApprovalRecord | null {
    const pending = normalizePendingApprovalRecord(value);
    if (!pending || typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentApprovalRecord>;
    const resolvedAt = normalizeDate(entry.resolvedAt);
    if (!resolvedAt || (entry.decision !== 'allow' && entry.decision !== 'ask' && entry.decision !== 'deny')) {
        return null;
    }

    return {
        ...pending,
        decision: entry.decision,
        resolvedAt,
    };
}

function normalizeWorkflowState(value: unknown): AgentWorkflowState | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentWorkflowState>;
    const rawGoal = readString(entry.rawGoal);
    const normalizedGoal = readString(entry.normalizedGoal);
    const completedAt = normalizeDate(entry.completedAt);
    const sourceTurnId = readString(entry.sourceTurnId);

    if (entry.kind !== 'plan' || !rawGoal || !normalizedGoal || !completedAt || !sourceTurnId) {
        return null;
    }

    return {
        kind: 'plan',
        rawGoal,
        normalizedGoal,
        completedAt,
        sourceTurnId,
    };
}

function normalizeCompaction(value: unknown): AgentSessionCompaction | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentSessionCompaction>;
    const id = readString(entry.id);
    const summary = readString(entry.summary);
    const createdAt = normalizeDate(entry.createdAt);
    const messageCountBefore = readNumber(entry.messageCountBefore);
    const messageCountAfter = readNumber(entry.messageCountAfter);

    if (!id || !summary || !createdAt || messageCountBefore === undefined || messageCountAfter === undefined) {
        return null;
    }

    return {
        id,
        createdAt,
        messageCountBefore,
        messageCountAfter,
        summary,
    };
}

function normalizeToolResultRendererEvent(
    value: unknown,
): AgentToolResultRendererEvent | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentToolResultRendererEvent>;
    const type = readString(entry.type);
    const sessionId = readString(entry.sessionId);
    const toolCallId = readString(entry.toolCallId);
    const toolName = readString(entry.toolName);
    const timestamp = readNumber(entry.timestamp);

    if (!type || !sessionId || !toolCallId || !toolName || timestamp === undefined) {
        return null;
    }

    if (type === 'tool.output') {
        return {
            type,
            sessionId,
            toolCallId,
            toolName,
            output: createTextPreview(readString((entry as { output?: string }).output) ?? ''),
            ...(typeof (entry as { partial?: boolean }).partial === 'boolean'
                ? { partial: (entry as { partial: boolean }).partial }
                : {}),
            ...(readString((entry as { stream?: string }).stream) === 'stdout' || readString((entry as { stream?: string }).stream) === 'stderr'
                ? { stream: readString((entry as { stream: 'stdout' | 'stderr' }).stream) as 'stdout' | 'stderr' }
                : {}),
            timestamp,
        };
    }

    if (type === 'tool.completed') {
        return {
            type,
            sessionId,
            toolCallId,
            toolName,
            success: Boolean((entry as { success?: boolean }).success),
            timestamp,
        };
    }

    return null;
}

function normalizeToolResultTranscriptEntry(
    value: unknown,
): AgentToolResultTranscriptEntry | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentToolResultTranscriptEntry>;
    const type = readString(entry.type);
    const content = readString(entry.content);
    if (type !== 'tool' || !content) {
        return null;
    }

    return {
        type,
        content: createTextPreview(content),
        ...(readString(entry.toolCallId) ? { toolCallId: readString(entry.toolCallId) } : {}),
        ...(readString(entry.toolName) ? { toolName: readString(entry.toolName) } : {}),
        ...(typeof entry.success === 'boolean' ? { success: entry.success } : {}),
    };
}

function normalizeToolResultEventStoreRecord(
    value: unknown,
): AgentToolResultEventStoreRecord | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentToolResultEventStoreRecord>;
    const type = readString(entry.type);
    const sessionId = readString(entry.sessionId);
    const toolCallId = readString(entry.toolCallId);
    const toolName = readString(entry.toolName);
    const content = readString(entry.content);
    const timestamp = readNumber(entry.timestamp);

    if (type !== 'tool_result' || !sessionId || !toolCallId || !toolName || !content || timestamp === undefined) {
        return null;
    }

    return {
        type,
        sessionId,
        toolCallId,
        toolName,
        success: Boolean(entry.success),
        content: createTextPreview(content),
        timestamp,
    };
}

function normalizeConversationEventStoreRecord(
    value: unknown,
): AgentConversationEventStoreRecord | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentConversationEventStoreRecord>;
    const type = readString(entry.type);
    const sessionId = readString(entry.sessionId);
    const seq = readNumber(entry.seq);
    const timestamp = readNumber(entry.timestamp);

    if (!type || !sessionId || seq === undefined || timestamp === undefined) {
        return null;
    }

    switch (type) {
        case 'user_message':
        case 'assistant_message': {
            const content = readString((entry as { content?: unknown }).content);
            if (!content) {
                return null;
            }

            return {
                type,
                sessionId,
                seq,
                timestamp,
                content: createTextPreview(content),
            };
        }
        case 'tool_result': {
            const toolCallId = readString((entry as { toolCallId?: unknown }).toolCallId);
            const toolName = readString((entry as { toolName?: unknown }).toolName);
            const content = readString((entry as { content?: unknown }).content);
            if (!toolCallId || !toolName || !content) {
                return null;
            }

            return {
                type,
                sessionId,
                seq,
                timestamp,
                toolCallId,
                toolName,
                success: Boolean((entry as { success?: unknown }).success),
                content: createTextPreview(content),
            };
        }
        case 'verification_result': {
            const verificationId = readString((entry as { verificationId?: unknown }).verificationId);
            const summary = readString((entry as { summary?: unknown }).summary);
            const content = readString((entry as { content?: unknown }).content);
            if (!verificationId || !summary || !content) {
                return null;
            }

            return {
                type,
                sessionId,
                seq,
                timestamp,
                verificationId,
                ok: Boolean((entry as { ok?: unknown }).ok),
                blocked: Boolean((entry as { blocked?: unknown }).blocked),
                summary: createTextPreview(summary),
                content: createTextPreview(content),
            };
        }
        case 'checkpoint': {
            const checkpointId = readString((entry as { checkpointId?: unknown }).checkpointId);
            const toolCallId = readString((entry as { toolCallId?: unknown }).toolCallId);
            const toolName = readString((entry as { toolName?: unknown }).toolName);
            const status = readString((entry as { status?: unknown }).status);
            if (!checkpointId || !toolCallId || !toolName || !status) {
                return null;
            }

            return {
                type,
                sessionId,
                seq,
                timestamp,
                checkpointId,
                toolCallId,
                toolName,
                required: Boolean((entry as { required?: unknown }).required),
                status: status === 'captured' || status === 'missing' || status === 'not_required'
                    ? status
                    : 'missing',
                ...(readString((entry as { rollbackPointId?: unknown }).rollbackPointId)
                    ? { rollbackPointId: readString((entry as { rollbackPointId?: unknown }).rollbackPointId) }
                    : {}),
            };
        }
        case 'pending_approval': {
            const approvalId = readString((entry as { approvalId?: unknown }).approvalId);
            const summary = readString((entry as { summary?: unknown }).summary);
            if (!approvalId || !summary) {
                return null;
            }

            return {
                type,
                sessionId,
                seq,
                timestamp,
                approvalId,
                summary: createTextPreview(summary),
            };
        }
        case 'paused_turn': {
            const reason = readString((entry as { reason?: unknown }).reason);
            if (!reason) {
                return null;
            }

            return {
                type,
                sessionId,
                seq,
                timestamp,
                reason: createTextPreview(reason),
            };
        }
        case 'compaction_boundary': {
            const summary = readString((entry as { summary?: unknown }).summary);
            if (!summary) {
                return null;
            }

            return {
                type,
                sessionId,
                seq,
                timestamp,
                summary: createTextPreview(summary),
            };
        }
        default:
            return null;
    }
}

function normalizeConversationEventEnvelope(
    value: unknown,
): AgentConversationEventEnvelope | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentConversationEventEnvelope>;
    const schemaVersion = readNumber(entry.schemaVersion);
    const eventId = readString(entry.eventId);
    const sessionId = readString(entry.sessionId);
    const turnId = readString(entry.turnId);
    const timestamp = readString(entry.timestamp);
    const type = readString(entry.type);
    const payload = typeof entry.payload === 'object' && entry.payload !== null
        ? entry.payload
        : undefined;

    if (
        schemaVersion !== 1
        || !eventId
        || !sessionId
        || !turnId
        || !timestamp
        || !type
        || !payload
    ) {
        return null;
    }

    return JSON.parse(JSON.stringify({
        schemaVersion,
        eventId,
        sessionId,
        turnId,
        timestamp,
        type,
        payload,
    })) as AgentConversationEventEnvelope;
}

function sanitizeToolArgValue(key: string, value: unknown): unknown {
    if (typeof value === 'string') {
        if (key === 'content') {
            return `[content omitted, ${value.length} chars]`;
        }
        return truncateText(value, MAX_ARG_PREVIEW_LENGTH);
    }

    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.slice(0, 10).map((entry) => sanitizeToolArgValue(key, entry));
    }

    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.entries(value).slice(0, 10).map(([entryKey, entryValue]) => [
                entryKey,
                sanitizeToolArgValue(entryKey, entryValue),
            ]),
        );
    }

    return String(value);
}
