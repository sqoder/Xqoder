import {
    AgentSession,
    type PersistedSessionSummary,
} from '@xqoder/storage-sqlite';
import { getXQoderVersion } from '../../cli/version.js';
import {
    formatSessionUsageSummary,
    readOptionalSessionUsage,
    serializeOptionalSessionUsage,
} from '../../core/agent/session/session-usage.js';
import {
    buildProjectedConversationTranscript,
    selectConversationTranscriptProjectionSources,
    type ConversationEventStoreRecord,
} from '../../domain/conversation/index.js';
import type { ConversationEventEnvelope } from '@xqoder/protocol';
import type {
    SerializedSessionSnapshot,
    SessionExportDocument,
} from './assets-types.js';
import {
    asObject,
    formatDateTime,
    isObject,
    readArray,
    readIsoString,
    readMessages,
    readNumber,
    readString,
    singleLine,
    truncateText,
} from './assets-utils.js';

export function createSessionExportDocument(
    summary: PersistedSessionSummary,
    session: AgentSession,
): SessionExportDocument {
    const snapshot = session.toSnapshot();
    const transcript = buildProjectedConversationTranscript({
        messages: snapshot.messages,
        toolHistory: snapshot.metadata.toolHistory.map((entry) => ({
            id: entry.id,
            name: entry.name,
            success: entry.success,
        })),
        verificationHistory: snapshot.metadata.verificationHistory.map((entry) => ({
            id: entry.id,
            ok: entry.ok,
            blocked: entry.blocked,
            summary: entry.summary,
            messages: entry.messages,
        })),
        ...selectConversationTranscriptProjectionSources({
            conversationEventEnvelopes: snapshot.metadata.conversationEventEnvelopes,
            conversationEvents: snapshot.metadata.conversationEvents,
        }),
    });

    return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        source: {
            product: 'xqoder',
            version: getXQoderVersion(),
        },
        summary: {
            id: summary.id,
            projectRoot: summary.projectRoot,
            cwd: summary.cwd,
            model: summary.model,
            title: summary.title,
            createdAt: summary.createdAt.toISOString(),
            updatedAt: summary.updatedAt.toISOString(),
            maxMessages: summary.maxMessages,
            messageCount: summary.messageCount,
            usage: {
                promptTokens: summary.usage.promptTokens,
                completionTokens: summary.usage.completionTokens,
                totalTokens: summary.usage.totalTokens,
                ...serializeOptionalSessionUsage(summary.usage),
            },
            ...(summary.lastUserMessage ? { lastUserMessage: summary.lastUserMessage } : {}),
            compactionCount: summary.compactionCount,
            commandCount: summary.commandCount,
            fileChangeCount: summary.fileChangeCount,
        },
        snapshot: {
            id: snapshot.id,
            createdAt: snapshot.createdAt.toISOString(),
            maxMessages: snapshot.maxMessages,
            messages: snapshot.messages,
            usage: {
                promptTokens: snapshot.usage.promptTokens,
                completionTokens: snapshot.usage.completionTokens,
                totalTokens: snapshot.usage.totalTokens,
                ...serializeOptionalSessionUsage(snapshot.usage),
            },
            transcript,
            metadata: {
                ...(snapshot.metadata.compactSummary
                    ? { compactSummary: snapshot.metadata.compactSummary }
                    : {}),
                compactions: snapshot.metadata.compactions.map((entry) => ({
                    id: entry.id,
                    createdAt: entry.createdAt.toISOString(),
                    messageCountBefore: entry.messageCountBefore,
                    messageCountAfter: entry.messageCountAfter,
                    summary: entry.summary,
                })),
                toolHistory: snapshot.metadata.toolHistory.map((entry) => ({
                    id: entry.id,
                    name: entry.name,
                    args: entry.args,
                    success: entry.success,
                    outputPreview: entry.outputPreview,
                    ...(entry.error ? { error: entry.error } : {}),
                    startedAt: entry.startedAt.toISOString(),
                    completedAt: entry.completedAt.toISOString(),
                })),
                verificationHistory: snapshot.metadata.verificationHistory.map((entry) => ({
                    id: entry.id,
                    ok: entry.ok,
                    blocked: entry.blocked,
                    summary: entry.summary,
                    messages: [...entry.messages],
                    createdAt: entry.createdAt.toISOString(),
                })),
                checkpointHistory: snapshot.metadata.checkpointHistory.map((entry) => ({
                    id: entry.id,
                    toolCallId: entry.toolCallId,
                    toolName: entry.toolName,
                    required: entry.required,
                    status: entry.status,
                    ...(entry.rollbackPointId ? { rollbackPointId: entry.rollbackPointId } : {}),
                    timestamp: entry.timestamp.toISOString(),
                })),
                commandHistory: snapshot.metadata.commandHistory.map((entry) => ({
                    id: entry.id,
                    command: entry.command,
                    cwd: entry.cwd,
                    success: entry.success,
                    outputPreview: entry.outputPreview,
                    ...(entry.error ? { error: entry.error } : {}),
                    startedAt: entry.startedAt.toISOString(),
                    completedAt: entry.completedAt.toISOString(),
                })),
                fileChanges: snapshot.metadata.fileChanges.map((entry) => ({
                    id: entry.id,
                    path: entry.path,
                    changeType: entry.changeType,
                    bytes: entry.bytes,
                    ...(typeof entry.existedBefore === 'boolean'
                        ? { existedBefore: entry.existedBefore }
                        : {}),
                    success: entry.success,
                    timestamp: entry.timestamp.toISOString(),
                })),
                conversationEvents: snapshot.metadata.conversationEvents.map((entry) => ({ ...entry })),
                conversationEventEnvelopes: snapshot.metadata.conversationEventEnvelopes.map((entry) => JSON.parse(JSON.stringify(entry))),
            },
        },
    };
}

export function renderSessionMarkdown(
    summary: PersistedSessionSummary,
    session: AgentSession,
): string {
    const conversationSignals = buildProjectedConversationTranscript({
        messages: session.getMessages(),
        toolHistory: session.getToolHistory().map((entry) => ({
            id: entry.id,
            name: entry.name,
            success: entry.success,
        })),
        verificationHistory: session.getVerificationHistory().map((entry) => ({
            id: entry.id,
            ok: entry.ok,
            blocked: entry.blocked,
            summary: entry.summary,
            messages: entry.messages,
        })),
        ...selectConversationTranscriptProjectionSources({
            conversationEventEnvelopes: session.getConversationEventEnvelopes(),
            conversationEvents: session.getConversationEvents(),
        }),
    })
        .slice(-16)
        .map(formatConversationSignalMarkdownLine);
    const transcript = session.getMessages()
        .slice(-16)
        .map((message) => `- [${message.role}] ${truncateText(singleLine(message.content), 240)}`);
    const commands = session.getCommandHistory()
        .slice(-10)
        .map((entry) => `- ${formatDateTime(entry.completedAt)} ${entry.success ? 'OK' : 'FAIL'} ${truncateText(entry.command, 180)}`);
    const fileChanges = session.getFileChanges()
        .slice(-10)
        .map((entry) => `- ${formatDateTime(entry.timestamp)} ${entry.changeType.toUpperCase()} ${truncateText(entry.path, 180)} (${entry.bytes} B)`);
    const toolHistory = session.getToolHistory()
        .slice(-10)
        .map((entry) => `- ${formatDateTime(entry.completedAt)} ${entry.success ? 'OK' : 'FAIL'} ${entry.name} => ${truncateText(entry.outputPreview, 180)}`);

    return [
        `# ${summary.title}`,
        '',
        `- Session: ${summary.id}`,
        `- Project: ${summary.projectRoot}`,
        `- Model: ${summary.model}`,
        `- Created: ${formatDateTime(summary.createdAt)}`,
        `- Updated: ${formatDateTime(summary.updatedAt)}`,
        `- Messages: ${summary.messageCount}/${summary.maxMessages}`,
        `- Usage: ${formatSessionUsageSummary(summary.usage)}`,
        `- Commands: ${summary.commandCount}`,
        `- File Changes: ${summary.fileChangeCount}`,
        `- Compactions: ${summary.compactionCount}`,
        '',
        '## Auto Summary',
        '',
        session.getCompactSummary() ?? 'None',
        '',
        '## Conversation Signals',
        '',
        ...(conversationSignals.length > 0 ? conversationSignals : ['- None']),
        '',
        '## Recent Transcript',
        '',
        ...(transcript.length > 0 ? transcript : ['- None']),
        '',
        '## Command History',
        '',
        ...(commands.length > 0 ? commands : ['- None']),
        '',
        '## File Changes',
        '',
        ...(fileChanges.length > 0 ? fileChanges : ['- None']),
        '',
        '## Tool History',
        '',
        ...(toolHistory.length > 0 ? toolHistory : ['- None']),
    ].join('\n');
}

export function parseSessionExportDocument(value: unknown): SessionExportDocument {
    if (!isObject(value)) {
        throw new Error('Imported file is not a valid JSON object');
    }

    if (value['schemaVersion'] === 1) {
        if (!isObject(value['summary']) || !isObject(value['snapshot'])) {
            throw new Error('Exported file is missing summary or snapshot');
        }
        return normalizeSessionExportDocument(value);
    }

    const normalizedFromCompatibleShape = normalizeCompatibleSessionExportDocument(value);
    if (normalizedFromCompatibleShape) {
        return normalizedFromCompatibleShape;
    }

    throw new Error('Only schemaVersion=1 or compatible session export files are supported');
}

export function createImportedSession(
    document: SessionExportDocument,
    sessionId: string,
): AgentSession {
    const metadata = document.snapshot.metadata;
    return new AgentSession({
        id: sessionId,
        createdAt: new Date(document.snapshot.createdAt),
        maxMessages: document.snapshot.maxMessages,
        messages: document.snapshot.messages,
        usage: document.snapshot.usage,
            metadata: {
                ...(metadata.compactSummary
                    ? { compactSummary: metadata.compactSummary }
                    : {}),
                compactions: (metadata.compactions ?? []).map((entry) => ({
                id: entry.id,
                createdAt: new Date(entry.createdAt),
                messageCountBefore: entry.messageCountBefore,
                messageCountAfter: entry.messageCountAfter,
                summary: entry.summary,
            })),
            toolHistory: (metadata.toolHistory ?? []).map((entry) => ({
                id: entry.id,
                name: entry.name,
                args: entry.args,
                success: entry.success,
                outputPreview: entry.outputPreview,
                    ...(entry.error ? { error: entry.error } : {}),
                    startedAt: new Date(entry.startedAt),
                    completedAt: new Date(entry.completedAt),
                })),
                verificationHistory: (metadata.verificationHistory ?? []).map((entry) => ({
                    id: entry.id,
                    ok: entry.ok,
                    blocked: entry.blocked,
                    summary: entry.summary,
                    messages: Array.isArray(entry.messages)
                        ? entry.messages.filter((message): message is string => typeof message === 'string')
                        : [],
                    createdAt: new Date(entry.createdAt),
                })),
                checkpointHistory: (metadata.checkpointHistory ?? []).map((entry) => ({
                    id: entry.id,
                    toolCallId: entry.toolCallId,
                    toolName: entry.toolName,
                    required: entry.required,
                    status: entry.status,
                    ...(entry.rollbackPointId ? { rollbackPointId: entry.rollbackPointId } : {}),
                    timestamp: new Date(entry.timestamp),
                })),
                commandHistory: (metadata.commandHistory ?? []).map((entry) => ({
                    id: entry.id,
                    command: entry.command,
                    cwd: entry.cwd,
                success: entry.success,
                outputPreview: entry.outputPreview,
                ...(entry.error ? { error: entry.error } : {}),
                startedAt: new Date(entry.startedAt),
                completedAt: new Date(entry.completedAt),
            })),
            fileChanges: (metadata.fileChanges ?? []).map((entry) => ({
                id: entry.id,
                path: entry.path,
                changeType: entry.changeType,
                bytes: entry.bytes,
                ...(typeof entry.existedBefore === 'boolean'
                    ? { existedBefore: entry.existedBefore }
                    : {}),
                success: entry.success,
                timestamp: new Date(entry.timestamp),
            })),
            conversationEvents: (metadata.conversationEvents ?? []).map((entry) => ({ ...entry })),
            conversationEventEnvelopes: (metadata.conversationEventEnvelopes ?? []).map((entry) => JSON.parse(JSON.stringify(entry))),
        },
    });
}

function normalizeSessionExportDocument(value: Record<string, unknown>): SessionExportDocument {
    const summary = asObject(value['summary']);
    const snapshot = asObject(value['snapshot']);
    if (!summary || !snapshot) {
        throw new Error('Exported file is missing summary or snapshot');
    }

    const sessionId = readString(snapshot['id'])
        ?? readString(summary['id'])
        ?? 'session_imported';
    const createdAt = readIsoString(snapshot['createdAt'])
        ?? readIsoString(summary['createdAt'])
        ?? new Date(0).toISOString();
    const updatedAt = readIsoString(summary['updatedAt']) ?? createdAt;
    const projectRoot = readString(summary['projectRoot']) ?? '.';
    const cwd = readString(summary['cwd']) ?? projectRoot;
    const model = readString(summary['model']) ?? 'unknown-model';
    const title = readString(summary['title']) ?? sessionId;
    const messages = readMessages(snapshot['messages']);
    if (!messages) {
        throw new Error('Exported file fields are incomplete');
    }

    const maxMessages = readNumber(snapshot['maxMessages'])
        ?? readNumber(summary['maxMessages'])
        ?? 100;
    const usage = normalizeUsage(snapshot['usage'] ?? summary['usage']);
    const metadata = normalizeSnapshotMetadata(snapshot['metadata']);
    const lastUserMessage = readString(summary['lastUserMessage']);

    return {
        schemaVersion: 1,
        exportedAt: readIsoString(value['exportedAt']) ?? updatedAt,
        source: {
            product: 'xqoder',
            version: readString(asObject(value['source'])?.['version']) ?? 'unknown',
        },
        summary: {
            id: sessionId,
            projectRoot,
            cwd,
            model,
            title,
            createdAt,
            updatedAt,
            maxMessages,
            messageCount: readNumber(summary['messageCount']) ?? messages.length,
            usage,
            ...(lastUserMessage ? { lastUserMessage } : {}),
            compactionCount: readNumber(summary['compactionCount']) ?? metadata.compactions.length,
            commandCount: readNumber(summary['commandCount']) ?? metadata.commandHistory.length,
            fileChangeCount: readNumber(summary['fileChangeCount']) ?? metadata.fileChanges.length,
        },
        snapshot: {
            id: sessionId,
            createdAt,
            maxMessages,
            messages,
            usage,
            transcript: buildProjectedConversationTranscript({
                messages,
                toolHistory: metadata.toolHistory.map((entry) => ({
                    id: entry.id,
                    name: entry.name,
                    success: entry.success,
                })),
                verificationHistory: (metadata.verificationHistory ?? []).map((entry) => ({
                    id: entry.id,
                    ok: entry.ok,
                    blocked: entry.blocked,
                    summary: entry.summary,
                    messages: entry.messages,
                })),
                ...selectConversationTranscriptProjectionSources({
                    conversationEventEnvelopes: metadata.conversationEventEnvelopes,
                    conversationEvents: metadata.conversationEvents,
                }),
            }),
            metadata,
        },
    };
}

function formatConversationSignalMarkdownLine(
    entry: ReturnType<typeof buildProjectedConversationTranscript>[number],
): string {
    if (entry.type === 'tool') {
        return `- [tool${entry.toolName ? `:${entry.toolName}` : ''}] ${truncateText(singleLine(entry.content), 240)}`;
    }

    if (entry.type === 'verification') {
        const status = entry.blocked === true
            ? 'verification:block'
            : entry.ok === false
                ? 'verification:fail'
                : 'verification:ok';
        return `- [${status}] ${truncateText(singleLine(entry.content), 240)}`;
    }

    return `- [${entry.type}] ${truncateText(singleLine(entry.content), 240)}`;
}

function normalizeCompatibleSessionExportDocument(value: Record<string, unknown>): SessionExportDocument | undefined {
    const snapshotCandidate = asObject(value['snapshot'])
        ?? asObject(value['session'])
        ?? value;
    const messages = readMessages(snapshotCandidate['messages']);
    if (!messages) {
        return undefined;
    }

    const summaryCandidate = asObject(value['summary']) ?? asObject(value['session']) ?? value;

    const inferred = normalizeSessionExportDocument({
        schemaVersion: 1,
        exportedAt: value['exportedAt'] ?? value['updatedAt'] ?? new Date().toISOString(),
        source: {
            product: 'xqoder',
            version: readString(asObject(value['source'])?.['version']) ?? readString(value['version']) ?? 'compatible-import',
        },
        summary: {
            id: summaryCandidate['id'] ?? value['sessionId'] ?? snapshotCandidate['id'] ?? 'session_imported',
            projectRoot: summaryCandidate['projectRoot'] ?? summaryCandidate['project_path'] ?? value['projectRoot'] ?? '.',
            cwd: summaryCandidate['cwd'] ?? value['cwd'] ?? summaryCandidate['projectRoot'] ?? '.',
            model: summaryCandidate['model'] ?? value['model'] ?? 'unknown-model',
            title: summaryCandidate['title'] ?? value['title'] ?? value['name'] ?? 'Imported Session',
            createdAt: summaryCandidate['createdAt'] ?? snapshotCandidate['createdAt'] ?? value['createdAt'],
            updatedAt: summaryCandidate['updatedAt'] ?? value['updatedAt'] ?? value['exportedAt'],
            maxMessages: summaryCandidate['maxMessages'] ?? snapshotCandidate['maxMessages'] ?? 100,
            messageCount: summaryCandidate['messageCount'] ?? messages.length,
            usage: summaryCandidate['usage'] ?? snapshotCandidate['usage'],
            compactionCount: summaryCandidate['compactionCount'] ?? 0,
            commandCount: summaryCandidate['commandCount'] ?? 0,
            fileChangeCount: summaryCandidate['fileChangeCount'] ?? 0,
        },
        snapshot: {
            id: snapshotCandidate['id'] ?? summaryCandidate['id'] ?? value['sessionId'] ?? 'session_imported',
            createdAt: snapshotCandidate['createdAt'] ?? summaryCandidate['createdAt'] ?? value['createdAt'],
            maxMessages: snapshotCandidate['maxMessages'] ?? summaryCandidate['maxMessages'] ?? 100,
            messages,
            usage: snapshotCandidate['usage'] ?? summaryCandidate['usage'],
            metadata: snapshotCandidate['metadata'],
        },
    });

    return inferred;
}

function normalizeUsage(value: unknown): SerializedSessionSnapshot['usage'] {
    const usage = asObject(value);
    return {
        promptTokens: readNumber(usage?.['promptTokens']) ?? 0,
        completionTokens: readNumber(usage?.['completionTokens']) ?? 0,
        totalTokens: readNumber(usage?.['totalTokens']) ?? 0,
        ...readOptionalSessionUsage(usage),
    };
}

function normalizeSnapshotMetadata(value: unknown): SerializedSessionSnapshot['metadata'] {
    const metadata = asObject(value);
    const compactSummary = readString(metadata?.['compactSummary']);

    return {
        ...(compactSummary ? { compactSummary } : {}),
        compactions: readArray(metadata?.['compactions']),
        toolHistory: readArray(metadata?.['toolHistory']),
        verificationHistory: readArray(metadata?.['verificationHistory']),
        checkpointHistory: readArray(metadata?.['checkpointHistory']),
        commandHistory: readArray(metadata?.['commandHistory']),
        fileChanges: readArray(metadata?.['fileChanges']),
        conversationEvents: readArray(metadata?.['conversationEvents']) as ConversationEventStoreRecord[],
        conversationEventEnvelopes: readArray(metadata?.['conversationEventEnvelopes']) as ConversationEventEnvelope[],
    } as SerializedSessionSnapshot['metadata'];
}
