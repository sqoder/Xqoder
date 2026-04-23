import type {
    SessionDetail,
    SessionSummary,
} from './ports.js';
import {
    formatSessionUsageCost,
    formatSessionUsageSummary,
} from '../../shared/session-usage.js';
import {
    buildProjectedConversationTranscript,
    selectConversationTranscriptProjectionSources,
    type ConversationEventStoreRecord,
} from '../../domain/conversation/index.js';
import type { ConversationEventEnvelope } from '@xqoder/protocol';

export function formatSessionListLine(summary: SessionSummary): string {
    return [
        `- ${summary.id}`,
        `title=${summary.title}`,
        `updated=${formatDateTime(summary.updatedAt)}`,
        `model=${summary.model}`,
        `msgs=${summary.messageCount}`,
        `tokens=${summary.usage.totalTokens}`,
        ...(typeof summary.usage.cacheReadTokens === 'number' && summary.usage.cacheReadTokens > 0
            ? [`cacheRead=${summary.usage.cacheReadTokens}`]
            : []),
        ...(typeof summary.usage.cacheCreationTokens === 'number' && summary.usage.cacheCreationTokens > 0
            ? [`cacheCreate=${summary.usage.cacheCreationTokens}`]
            : []),
        ...(typeof summary.usage.cost === 'number'
            ? [`cost=${formatSessionUsageCost(summary.usage.cost)}`]
            : []),
        `commands=${summary.commandCount}`,
        `files=${summary.fileChangeCount}`,
        `compacts=${summary.compactionCount}`,
    ].join('  ');
}

export function formatSessionDetail(
    summary: SessionSummary,
    session: SessionDetail,
    transcriptLimit: number,
    historyLimit: number,
): string {
    const verificationHistory = session.getVerificationHistory ? session.getVerificationHistory() : [];
    const checkpointHistory = session.getCheckpointHistory ? session.getCheckpointHistory() : [];
    const conversationEvents = Array.isArray(session.getConversationEvents?.())
        ? session.getConversationEvents!() as ConversationEventStoreRecord[]
        : undefined;
    const conversationEventEnvelopes = Array.isArray(session.getConversationEventEnvelopes?.())
        ? session.getConversationEventEnvelopes!() as ConversationEventEnvelope[]
        : undefined;
    const conversationSignals = buildProjectedConversationTranscript({
        messages: session.getMessages(),
        toolHistory: session.getToolHistory().map((entry) => ({
            id: entry.id ?? '',
            name: entry.name,
            success: entry.success,
        })).filter((entry) => entry.id.length > 0),
        verificationHistory: verificationHistory.map((entry, index) => ({
            id: `verification:${index}`,
            ok: entry.ok,
            blocked: entry.blocked,
            summary: entry.summary,
            messages: entry.messages,
        })),
        ...selectConversationTranscriptProjectionSources({
            ...(conversationEventEnvelopes ? { conversationEventEnvelopes } : {}),
            ...(conversationEvents ? { conversationEvents } : {}),
        }),
    })
        .slice(-transcriptLimit)
        .map(formatConversationSignalLine);
    const transcript = session.getMessages()
        .slice(-transcriptLimit)
        .map((message) => `- [${message.role}] ${truncateText(singleLine(message.content), 180)}`);
    const commands = session.getCommandHistory()
        .slice(-historyLimit)
        .map((entry) => (
            `- [${formatDateTime(entry.completedAt)}] ${entry.success ? 'OK' : 'FAIL'} ${truncateText(entry.command, 160)}`
        ));
    const fileChanges = session.getFileChanges()
        .slice(-historyLimit)
        .map((entry) => (
            `- [${formatDateTime(entry.timestamp)}] ${formatFileChangeStatus(entry.changeType, entry.success)} ${truncateText(entry.path, 160)} (${entry.bytes} B)`
        ));
    const checkpoints = checkpointHistory
        .slice(-historyLimit)
        .map((entry) => (
            `- [${formatDateTime(entry.timestamp)}] ${entry.toolName} status=${entry.status}${entry.rollbackPointId ? ` rollback=${entry.rollbackPointId}` : ''}`
        ));
    const toolHistory = session.getToolHistory()
        .slice(-historyLimit)
        .map((entry) => (
            `- [${formatDateTime(entry.completedAt)}] ${entry.success ? 'OK' : 'FAIL'} ${entry.name} ${truncateText(JSON.stringify(entry.args), 120)} => ${truncateText(entry.outputPreview, 120)}`
        ));

    return [
        `Session: ${summary.id}`,
        `Title: ${summary.title}`,
        `Project: ${summary.projectRoot}`,
        `Model: ${summary.model}`,
        `Created: ${formatDateTime(summary.createdAt)}`,
        `Updated: ${formatDateTime(summary.updatedAt)}`,
        `Messages: ${summary.messageCount}/${summary.maxMessages}`,
        `Usage: ${formatSessionUsageSummary(summary.usage)}`,
        `Compactions: ${summary.compactionCount}`,
        `Commands: ${summary.commandCount}`,
        `File Changes: ${summary.fileChangeCount}`,
        summary.lastUserMessage ? `Last User Message: ${truncateText(singleLine(summary.lastUserMessage), 180)}` : undefined,
        session.getCompactSummary() ? `Auto Summary:\n${session.getCompactSummary()}` : undefined,
        '',
        'Conversation Signals:',
        ...(conversationSignals.length > 0 ? conversationSignals : ['- None']),
        '',
        'Recent Transcript:',
        ...(transcript.length > 0 ? transcript : ['- None']),
        '',
        'Command History:',
        ...(commands.length > 0 ? commands : ['- None']),
        '',
        'File Changes:',
        ...(fileChanges.length > 0 ? fileChanges : ['- None']),
        '',
        'Checkpoint History:',
        ...(checkpoints.length > 0 ? checkpoints : ['- None']),
        '',
        'Tool History:',
        ...(toolHistory.length > 0 ? toolHistory : ['- None']),
    ].filter((line): line is string => line !== undefined).join('\n');
}

function formatConversationSignalLine(
    entry: ReturnType<typeof buildProjectedConversationTranscript>[number],
): string {
    if (entry.type === 'tool') {
        return `- [tool${entry.toolName ? `:${entry.toolName}` : ''}] ${truncateText(singleLine(entry.content), 180)}`;
    }

    if (entry.type === 'verification') {
        const status = entry.blocked === true
            ? 'verification:block'
            : entry.ok === false
                ? 'verification:fail'
                : 'verification:ok';
        return `- [${status}] ${truncateText(singleLine(entry.content), 180)}`;
    }

    return `- [${entry.type}] ${truncateText(singleLine(entry.content), 180)}`;
}

function formatDateTime(value: Date): string {
    return value.toISOString().replace('T', ' ').slice(0, 19);
}

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function singleLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function formatFileChangeStatus(
    changeType: 'write' | 'patch' | 'restore',
    success: boolean,
): string {
    const label = changeType.toUpperCase();
    return success ? label : `${label}_FAIL`;
}
