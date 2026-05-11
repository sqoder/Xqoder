import {
    buildConversationTranscript,
    type ConversationTranscriptEntry,
    type ConversationTranscriptMessage,
    type ConversationTranscriptToolSignal,
    type ConversationTranscriptVerificationSignal,
} from './messages.js';
import type { ConversationEventEnvelope } from '@xqoder/protocol';

export interface ConversationEventStoreBase {
    seq: number;
    sessionId: string;
    timestamp: number;
}

export interface ConversationUserMessageEventStoreRecord extends ConversationEventStoreBase {
    type: 'user_message';
    content: string;
}

export interface ConversationAssistantMessageEventStoreRecord extends ConversationEventStoreBase {
    type: 'assistant_message';
    content: string;
}

export interface ConversationToolResultEventStoreRecord extends ConversationEventStoreBase {
    type: 'tool_result';
    toolCallId: string;
    toolName: string;
    success: boolean;
    content: string;
}

export interface ConversationVerificationEventStoreRecord extends ConversationEventStoreBase {
    type: 'verification_result';
    verificationId: string;
    ok: boolean;
    blocked: boolean;
    summary: string;
    content: string;
}

export interface ConversationCheckpointEventStoreRecord extends ConversationEventStoreBase {
    type: 'checkpoint';
    checkpointId: string;
    toolCallId: string;
    toolName: string;
    required: boolean;
    status: 'not_required' | 'captured' | 'missing';
    rollbackPointId?: string;
}

export interface ConversationPendingApprovalEventStoreRecord extends ConversationEventStoreBase {
    type: 'pending_approval';
    approvalId: string;
    summary: string;
}

export interface ConversationPausedTurnEventStoreRecord extends ConversationEventStoreBase {
    type: 'paused_turn';
    reason: string;
}

export interface ConversationCompactionBoundaryEventStoreRecord extends ConversationEventStoreBase {
    type: 'compaction_boundary';
    summary: string;
}

export type ConversationEventStoreRecord =
    | ConversationUserMessageEventStoreRecord
    | ConversationAssistantMessageEventStoreRecord
    | ConversationToolResultEventStoreRecord
    | ConversationVerificationEventStoreRecord
    | ConversationCheckpointEventStoreRecord
    | ConversationPendingApprovalEventStoreRecord
    | ConversationPausedTurnEventStoreRecord
    | ConversationCompactionBoundaryEventStoreRecord;

export class TranscriptProjector {
    static projectFromEventStore(
        records: ConversationEventStoreRecord[],
    ): ConversationTranscriptEntry[] {
        return sortConversationEventStoreRecords(records).flatMap(projectConversationEventRecord);
    }
}

export function selectConversationTranscriptProjectionSources(input: {
    conversationEvents?: ConversationEventStoreRecord[];
    conversationEventEnvelopes?: ConversationEventEnvelope[];
}): {
    conversationEvents?: ConversationEventStoreRecord[];
    conversationEventEnvelopes?: ConversationEventEnvelope[];
} {
    if (shouldProjectFromEnvelopeStore(input.conversationEventEnvelopes)) {
        return {
            conversationEventEnvelopes: input.conversationEventEnvelopes,
        };
    }

    if (shouldProjectFromEventStore(input.conversationEvents)) {
        return {
            conversationEvents: input.conversationEvents,
        };
    }

    return {};
}

export function buildProjectedConversationTranscript(input: {
    messages: ConversationTranscriptMessage[];
    toolHistory?: ConversationTranscriptToolSignal[];
    verificationHistory?: ConversationTranscriptVerificationSignal[];
    conversationEvents?: ConversationEventStoreRecord[];
    conversationEventEnvelopes?: ConversationEventEnvelope[];
}): ConversationTranscriptEntry[] {
    const projectionSources = selectConversationTranscriptProjectionSources({
        ...(input.conversationEvents ? { conversationEvents: input.conversationEvents } : {}),
        ...(input.conversationEventEnvelopes ? { conversationEventEnvelopes: input.conversationEventEnvelopes } : {}),
    });
    if (projectionSources.conversationEventEnvelopes) {
        return projectTranscriptFromEnvelopeStore(projectionSources.conversationEventEnvelopes);
    }

    if (projectionSources.conversationEvents) {
        return TranscriptProjector.projectFromEventStore(projectionSources.conversationEvents);
    }

    return buildConversationTranscript({
        messages: input.messages,
        ...(input.toolHistory ? { toolHistory: input.toolHistory } : {}),
        ...(input.verificationHistory ? { verificationHistory: input.verificationHistory } : {}),
    });
}

function shouldProjectFromEnvelopeStore(
    records: ConversationEventEnvelope[] | undefined,
): records is ConversationEventEnvelope[] {
    if (!Array.isArray(records) || records.length === 0) {
        return false;
    }

    return records.some((record) =>
        record.type === 'message.completed'
        || record.type === 'tool.output'
        || record.type === 'verification.completed',
    );
}

function shouldProjectFromEventStore(
    records: ConversationEventStoreRecord[] | undefined,
): records is ConversationEventStoreRecord[] {
    if (!Array.isArray(records) || records.length === 0) {
        return false;
    }

    return records.some((record) =>
        record.type === 'user_message' || record.type === 'assistant_message',
    );
}

function sortConversationEventStoreRecords(
    records: ConversationEventStoreRecord[],
): ConversationEventStoreRecord[] {
    return [...records].sort((left, right) => {
        if (left.seq !== right.seq) {
        return left.seq - right.seq;
        }

        return left.timestamp - right.timestamp;
    });
}

function projectConversationEventRecord(
    record: ConversationEventStoreRecord,
): ConversationTranscriptEntry[] {
    switch (record.type) {
        case 'user_message':
            return [{
                type: 'user',
                content: record.content,
            }];
        case 'assistant_message':
            return [{
                type: 'assistant',
                content: record.content,
                response: record.content,
            }];
        case 'tool_result':
            return [{
                type: 'tool',
                content: record.content,
                toolCallId: record.toolCallId,
                toolName: record.toolName,
                success: record.success,
            }];
        case 'verification_result':
            return [{
                type: 'verification',
                content: record.content,
                ok: record.ok,
                blocked: record.blocked,
                summary: record.summary,
            }];
        case 'checkpoint':
        case 'pending_approval':
        case 'paused_turn':
        case 'compaction_boundary':
            return [];
    }
}

function projectTranscriptFromEnvelopeStore(
    records: ConversationEventEnvelope[],
): ConversationTranscriptEntry[] {
    const transcript: ConversationTranscriptEntry[] = [];
    const pendingToolOutputIndexes = new Map<string, number[]>();

    for (const record of sortConversationEventEnvelopes(records)) {
        switch (record.type) {
            case 'message.completed': {
                if (record.payload.message.role !== 'user' && record.payload.message.role !== 'assistant') {
                    continue;
                }

                const text = String(record.payload.message.content ?? '');
                transcript.push({
                    type: record.payload.message.role === 'user' ? 'user' : 'assistant',
                    content: text,
                    ...(record.payload.message.role === 'assistant' ? { response: text } : {}),
                } as ConversationTranscriptEntry);
                continue;
            }
            case 'tool.output': {
                if (record.payload.partial === true) {
                    continue;
                }

                const nextIndex = transcript.push({
                    type: 'tool',
                    content: record.payload.output,
                    toolName: record.payload.tool,
                }) - 1;
                const key = createEnvelopeToolKey(record);
                const queue = pendingToolOutputIndexes.get(key) ?? [];
                queue.push(nextIndex);
                pendingToolOutputIndexes.set(key, queue);
                continue;
            }
            case 'tool.completed': {
                const key = createEnvelopeToolKey(record);
                const queue = pendingToolOutputIndexes.get(key);
                const transcriptIndex = queue?.shift();
                if (queue && queue.length === 0) {
                    pendingToolOutputIndexes.delete(key);
                }

                if (transcriptIndex === undefined) {
                    continue;
                }

                const entry = transcript[transcriptIndex];
                if (entry?.type === 'tool') {
                    transcript[transcriptIndex] = {
                        ...entry,
                        success: record.payload.success,
                    };
                }
                continue;
            }
            case 'verification.completed':
                transcript.push({
                    type: 'verification',
                    content: record.payload.summary,
                    ok: record.payload.ok,
                    blocked: record.payload.blocked,
                    summary: record.payload.summary,
                });
                continue;
            default:
                continue;
        }
    }

    return transcript;
}

function sortConversationEventEnvelopes(
    records: ConversationEventEnvelope[],
): ConversationEventEnvelope[] {
    return [...records].sort((left, right) => {
        const leftTimestamp = Date.parse(left.timestamp);
        const rightTimestamp = Date.parse(right.timestamp);
        if (leftTimestamp !== rightTimestamp) {
            return leftTimestamp - rightTimestamp;
        }

        return left.eventId.localeCompare(right.eventId);
    });
}

function createEnvelopeToolKey(
    record: ConversationEventEnvelope<'tool.output' | 'tool.completed'>,
): string {
    return `${record.sessionId}:${record.payload.provider}:${record.payload.tool}`;
}
