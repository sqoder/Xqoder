import type {
    SessionDetail,
    SessionSummary,
} from './ports.js';

export function formatSessionListLine(summary: SessionSummary): string {
    return [
        `- ${summary.id}`,
        `title=${summary.title}`,
        `updated=${formatDateTime(summary.updatedAt)}`,
        `model=${summary.model}`,
        `msgs=${summary.messageCount}`,
        `tokens=${summary.usage.totalTokens}`,
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
        `Tokens: prompt=${summary.usage.promptTokens}, completion=${summary.usage.completionTokens}, total=${summary.usage.totalTokens}`,
        `Compactions: ${summary.compactionCount}`,
        `Commands: ${summary.commandCount}`,
        `File Changes: ${summary.fileChangeCount}`,
        summary.lastUserMessage ? `Last User Message: ${truncateText(singleLine(summary.lastUserMessage), 180)}` : undefined,
        session.getCompactSummary() ? `Auto Summary:\n${session.getCompactSummary()}` : undefined,
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
        'Tool History:',
        ...(toolHistory.length > 0 ? toolHistory : ['- None']),
    ].filter((line): line is string => line !== undefined).join('\n');
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
