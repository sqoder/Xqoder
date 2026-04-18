import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    AgentSession,
    type PersistedSessionSummary,
} from '@xqoder/storage-sqlite';
import type { LLMMessage } from '@xqoder/shared';
import { getXQoderVersion } from '../../cli/version.js';

export interface SessionStatsReport {
    scope: {
        allProjects: boolean;
        projectRoot?: string;
    };
    sessionCount: number;
    messageCount: number;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    commandCount: number;
    fileChangeCount: number;
    compactionCount: number;
    topModels: Array<{
        model: string;
        count: number;
        totalTokens: number;
    }>;
    topProjects: Array<{
        projectRoot: string;
        count: number;
        totalTokens: number;
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
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
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
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
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
    }): SessionShareRecord;
    listShares(projectRoot?: string, limit?: number): SessionShareRecord[];
    getShare(id: string): SessionShareDetails | null;
    removeShare(id: string): SessionShareRecord | null;
}

interface PersistedSessionShare {
    id: string;
    sessionId: string;
    projectRoot: string;
    title: string;
    format: 'json' | 'markdown';
    createdAt: string;
    artifactPath: string;
}

export function buildSessionStatsReport(
    summaries: PersistedSessionSummary[],
    scope: {
        allProjects: boolean;
        projectRoot?: string;
    },
): SessionStatsReport {
    const sortedByCreatedAt = summaries
        .slice()
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const sortedByUpdatedAt = summaries
        .slice()
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const modelTotals = new Map<string, { count: number; totalTokens: number }>();
    const projectTotals = new Map<string, { count: number; totalTokens: number }>();

    for (const summary of summaries) {
        const modelEntry = modelTotals.get(summary.model) ?? {
            count: 0,
            totalTokens: 0,
        };
        modelEntry.count += 1;
        modelEntry.totalTokens += summary.usage.totalTokens;
        modelTotals.set(summary.model, modelEntry);

        const projectEntry = projectTotals.get(summary.projectRoot) ?? {
            count: 0,
            totalTokens: 0,
        };
        projectEntry.count += 1;
        projectEntry.totalTokens += summary.usage.totalTokens;
        projectTotals.set(summary.projectRoot, projectEntry);
    }

    return {
        scope,
        sessionCount: summaries.length,
        messageCount: summaries.reduce((total, summary) => total + summary.messageCount, 0),
        usage: {
            promptTokens: summaries.reduce((total, summary) => total + summary.usage.promptTokens, 0),
            completionTokens: summaries.reduce((total, summary) => total + summary.usage.completionTokens, 0),
            totalTokens: summaries.reduce((total, summary) => total + summary.usage.totalTokens, 0),
        },
        commandCount: summaries.reduce((total, summary) => total + summary.commandCount, 0),
        fileChangeCount: summaries.reduce((total, summary) => total + summary.fileChangeCount, 0),
        compactionCount: summaries.reduce((total, summary) => total + summary.compactionCount, 0),
        topModels: Array.from(modelTotals.entries())
            .map(([model, stats]) => ({
                model,
                count: stats.count,
                totalTokens: stats.totalTokens,
            }))
            .sort(compareStatsRowsDescending),
        topProjects: Array.from(projectTotals.entries())
            .map(([projectRoot, stats]) => ({
                projectRoot,
                count: stats.count,
                totalTokens: stats.totalTokens,
            }))
            .sort(compareStatsRowsDescending),
        ...(sortedByCreatedAt[0]
            ? { oldestCreatedAt: sortedByCreatedAt[0].createdAt.toISOString() }
            : {}),
        ...(sortedByUpdatedAt[0]
            ? { newestUpdatedAt: sortedByUpdatedAt[0].updatedAt.toISOString() }
            : {}),
    };
}

export function createSessionExportDocument(
    summary: PersistedSessionSummary,
    session: AgentSession,
): SessionExportDocument {
    const snapshot = session.toSnapshot();

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
            },
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
            },
        },
    };
}

export function renderSessionMarkdown(
    summary: PersistedSessionSummary,
    session: AgentSession,
): string {
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
        `- Tokens: prompt=${summary.usage.promptTokens}, completion=${summary.usage.completionTokens}, total=${summary.usage.totalTokens}`,
        `- Commands: ${summary.commandCount}`,
        `- File Changes: ${summary.fileChangeCount}`,
        `- Compactions: ${summary.compactionCount}`,
        '',
        '## Auto Summary',
        '',
        session.getCompactSummary() ?? 'None',
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
            ...(readString(summary['lastUserMessage']) ? { lastUserMessage: readString(summary['lastUserMessage']) } : {}),
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
            metadata,
        },
    };
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

function normalizeUsage(value: unknown): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const usage = asObject(value);
    return {
        promptTokens: readNumber(usage?.['promptTokens']) ?? 0,
        completionTokens: readNumber(usage?.['completionTokens']) ?? 0,
        totalTokens: readNumber(usage?.['totalTokens']) ?? 0,
    };
}

function normalizeSnapshotMetadata(value: unknown): SerializedSessionSnapshot['metadata'] {
    const metadata = asObject(value);
    return {
        ...(readString(metadata?.['compactSummary']) ? { compactSummary: readString(metadata?.['compactSummary']) } : {}),
        compactions: readArray(metadata?.['compactions']),
        toolHistory: readArray(metadata?.['toolHistory']),
        commandHistory: readArray(metadata?.['commandHistory']),
        fileChanges: readArray(metadata?.['fileChanges']),
    } as SerializedSessionSnapshot['metadata'];
}

function asObject(value: unknown): Record<string, unknown> | undefined {
    return isObject(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

function readIsoString(value: unknown): string | undefined {
    const asString = readString(value);
    if (!asString) {
        return undefined;
    }
    const date = new Date(asString);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readMessages(value: unknown): LLMMessage[] | undefined {
    return Array.isArray(value) ? value as LLMMessage[] : undefined;
}

export class FileSessionShareStore implements SessionShareStore {
    constructor(private readonly rootDir: string) {
        fs.mkdirSync(this.rootDir, { recursive: true });
    }

    createShare(input: {
        sessionId: string;
        projectRoot: string;
        title: string;
        format: 'json' | 'markdown';
        content: string;
    }): SessionShareRecord {
        const id = createShareId();
        const directory = path.join(this.rootDir, id);
        const extension = input.format === 'json' ? 'json' : 'md';
        const artifactPath = path.join(directory, `session.${extension}`);
        const persisted: PersistedSessionShare = {
            id,
            sessionId: input.sessionId,
            projectRoot: path.resolve(input.projectRoot),
            title: input.title.trim() || 'xqoder-share',
            format: input.format,
            createdAt: new Date().toISOString(),
            artifactPath,
        };

        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(artifactPath, input.content, 'utf-8');
        fs.writeFileSync(path.join(directory, 'meta.json'), JSON.stringify(persisted, null, 2), 'utf-8');

        return toSessionShareRecord(persisted);
    }

    listShares(projectRoot?: string, limit: number = 20): SessionShareRecord[] {
        const normalizedProjectRoot = projectRoot ? path.resolve(projectRoot) : undefined;

        return fs.readdirSync(this.rootDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => this.readShareSafe(path.join(this.rootDir, entry.name)))
            .filter((entry): entry is PersistedSessionShare => entry !== null)
            .map(toSessionShareRecord)
            .filter((entry) => !normalizedProjectRoot || entry.projectRoot === normalizedProjectRoot)
            .sort(compareSharesDescending)
            .slice(0, Math.max(1, limit));
    }

    getShare(id: string): SessionShareDetails | null {
        try {
            const share = this.readShare(path.join(this.rootDir, id));
            return {
                ...toSessionShareRecord(share),
                content: fs.readFileSync(share.artifactPath, 'utf-8'),
            };
        } catch {
            return null;
        }
    }

    removeShare(id: string): SessionShareRecord | null {
        const directory = path.join(this.rootDir, id);

        try {
            const share = this.readShare(directory);
            fs.rmSync(directory, { recursive: true, force: true });
            return toSessionShareRecord(share);
        } catch {
            return null;
        }
    }

    private readShare(directory: string): PersistedSessionShare {
        const metaPath = path.join(directory, 'meta.json');
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as PersistedSessionShare;
    }

    private readShareSafe(directory: string): PersistedSessionShare | null {
        try {
            return this.readShare(directory);
        } catch {
            return null;
        }
    }
}

export function formatSessionStatsReport(report: SessionStatsReport): string {
    return [
        `Scope: ${report.scope.allProjects ? 'all-projects' : report.scope.projectRoot ?? '.'}`,
        `Sessions: ${report.sessionCount}`,
        `Messages: ${report.messageCount}`,
        `Tokens: prompt=${report.usage.promptTokens}, completion=${report.usage.completionTokens}, total=${report.usage.totalTokens}`,
        `Commands: ${report.commandCount}`,
        `File Changes: ${report.fileChangeCount}`,
        `Compactions: ${report.compactionCount}`,
        report.oldestCreatedAt ? `Oldest: ${report.oldestCreatedAt}` : undefined,
        report.newestUpdatedAt ? `Newest: ${report.newestUpdatedAt}` : undefined,
        '',
        'Top Models:',
        ...(report.topModels.length > 0
            ? report.topModels.slice(0, 5).map((entry) => `- ${entry.model}  sessions=${entry.count}  tokens=${entry.totalTokens}`)
            : ['- None']),
        '',
        'Top Projects:',
        ...(report.topProjects.length > 0
            ? report.topProjects.slice(0, 5).map((entry) => `- ${entry.projectRoot}  sessions=${entry.count}  tokens=${entry.totalTokens}`)
            : ['- None']),
    ].filter((line): line is string => line !== undefined).join('\n');
}

export function formatSessionShareListLine(share: SessionShareRecord): string {
    return [
        `- ${share.id}`,
        `created=${formatDateTime(share.createdAt)}`,
        `format=${share.format}`,
        `session=${share.sessionId}`,
        `title=${share.title}`,
    ].join('  ');
}

export function formatSessionShareDetail(share: SessionShareDetails): string {
    const preview = truncateText(share.content.replace(/\s+/g, ' ').trim(), 280);

    return [
        `Share: ${share.id}`,
        `Session: ${share.sessionId}`,
        `Project: ${share.projectRoot}`,
        `Title: ${share.title}`,
        `Format: ${share.format}`,
        `Created: ${formatDateTime(share.createdAt)}`,
        `Artifact: ${share.artifactPath}`,
        '',
        `Preview: ${preview || 'None'}`,
    ].join('\n');
}

function toSessionShareRecord(value: PersistedSessionShare): SessionShareRecord {
    return {
        id: value.id,
        sessionId: value.sessionId,
        projectRoot: value.projectRoot,
        title: value.title,
        format: value.format,
        createdAt: new Date(value.createdAt),
        artifactPath: value.artifactPath,
    };
}

function createShareId(): string {
    return `share_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function compareStatsRowsDescending(
    left: { count: number; totalTokens: number },
    right: { count: number; totalTokens: number },
): number {
    const countDiff = right.count - left.count;
    if (countDiff !== 0) {
        return countDiff;
    }

    return right.totalTokens - left.totalTokens;
}

function compareSharesDescending(left: SessionShareRecord, right: SessionShareRecord): number {
    const timeDiff = right.createdAt.getTime() - left.createdAt.getTime();
    if (timeDiff !== 0) {
        return timeDiff;
    }

    return right.id.localeCompare(left.id);
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

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
