import type { LLMMessage } from '@xqoder/shared';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type { ConversationEventStoreRecord } from '../../domain/conversation/transcript-projector.js';

export interface SerializedSessionUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    cost?: number;
}

export interface SessionStatsReport {
    scope: {
        allProjects: boolean;
        projectRoot?: string;
    };
    sessionCount: number;
    messageCount: number;
    usage: SerializedSessionUsage;
    commandCount: number;
    fileChangeCount: number;
    compactionCount: number;
    topModels: Array<{
        model: string;
        count: number;
        totalTokens: number;
        cost?: number;
    }>;
    topProjects: Array<{
        projectRoot: string;
        count: number;
        totalTokens: number;
        cost?: number;
    }>;
    oldestCreatedAt?: string;
    newestUpdatedAt?: string;
}

export interface SessionExportDocument {
    schemaVersion: 1;
    exportedAt: string;
    source: {
        product: 'xqoder';
        version: string;
    };
    summary: SerializedSessionSummary;
    snapshot: SerializedSessionSnapshot;
}

export interface SerializedSessionSummary {
    id: string;
    projectRoot: string;
    cwd: string;
    model: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    maxMessages: number;
    messageCount: number;
    usage: SerializedSessionUsage;
    lastUserMessage?: string;
    compactionCount: number;
    commandCount: number;
    fileChangeCount: number;
}

export interface SerializedSessionSnapshot {
    id: string;
    createdAt: string;
    maxMessages: number;
    messages: LLMMessage[];
    usage: SerializedSessionUsage;
    transcript?: Array<
        | {
            type: 'user' | 'assistant';
            content: string;
        }
        | {
            type: 'tool';
            content: string;
            toolCallId?: string;
            toolName?: string;
            success?: boolean;
        }
        | {
            type: 'verification';
            content: string;
            ok?: boolean;
            blocked?: boolean;
            summary?: string;
        }
    >;
    metadata: {
        compactSummary?: string;
        compactions: Array<{
            id: string;
            createdAt: string;
            messageCountBefore: number;
            messageCountAfter: number;
            summary: string;
        }>;
        toolHistory: Array<{
            id: string;
            name: string;
            args: Record<string, unknown>;
            success: boolean;
            outputPreview: string;
            error?: string;
            startedAt: string;
            completedAt: string;
        }>;
        verificationHistory?: Array<{
            id: string;
            ok: boolean;
            blocked: boolean;
            summary: string;
            messages: string[];
            createdAt: string;
        }>;
        checkpointHistory?: Array<{
            id: string;
            toolCallId: string;
            toolName: string;
            required: boolean;
            status: 'not_required' | 'captured' | 'missing';
            rollbackPointId?: string;
            timestamp: string;
        }>;
        commandHistory: Array<{
            id: string;
            command: string;
            cwd: string;
            success: boolean;
            outputPreview: string;
            error?: string;
            startedAt: string;
            completedAt: string;
        }>;
        fileChanges: Array<{
            id: string;
            path: string;
            changeType: 'write' | 'patch' | 'restore';
            bytes: number;
            existedBefore?: boolean;
            success: boolean;
            timestamp: string;
        }>;
        conversationEvents?: ConversationEventStoreRecord[];
        conversationEventEnvelopes?: ConversationEventEnvelope[];
    };
}

export interface SessionShareRecord {
    id: string;
    sessionId: string;
    projectRoot: string;
    title: string;
    format: 'json' | 'markdown';
    createdAt: Date;
    artifactPath: string;
    usage?: SerializedSessionUsage;
}

export interface SessionShareDetails extends SessionShareRecord {
    content: string;
}

export interface SessionShareStore {
    createShare(input: {
        sessionId: string;
        projectRoot: string;
        title: string;
        format: 'json' | 'markdown';
        content: string;
        usage?: SerializedSessionUsage;
    }): SessionShareRecord;
    listShares(projectRoot?: string, limit?: number): SessionShareRecord[];
    getShare(id: string): SessionShareDetails | null;
    removeShare(id: string): SessionShareRecord | null;
}
