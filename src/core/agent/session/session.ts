// ============================================================
// Agent Session Management
// ============================================================

import type { LLMMessage, MessageAttachment } from '@xqoder/shared';

const AUTO_SUMMARY_PREFIX = '[XQoder auto-compact summary]';
const MAX_TEXT_PREVIEW_LENGTH = 400;
const MAX_ARG_PREVIEW_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 1600;

/** Session ID Generation */
function generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateCompactionId(): string {
    return `compact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

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

export interface AgentSessionMetadataSnapshot {
    compactSummary?: string;
    compactions: AgentSessionCompaction[];
    toolHistory: AgentToolExecution[];
    commandHistory: AgentCommandHistoryEntry[];
    fileChanges: AgentFileChangeEntry[];
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

interface AgentSessionOptions {
    id?: string;
    title?: string;
    createdAt?: Date;
    maxMessages?: number;
    systemPrompt?: string;
    messages?: LLMMessage[];
    usage?: Partial<AgentSessionUsage>;
    metadata?: Partial<AgentSessionMetadataSnapshot>;
}

interface RecordToolExecutionInput {
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

const EMPTY_USAGE: AgentSessionUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
};

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
    private commandHistory: AgentCommandHistoryEntry[];
    private fileChanges: AgentFileChangeEntry[];

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
        const metadata = normalizeSessionMetadataSnapshot(options.metadata);

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
        this.commandHistory = metadata.commandHistory;
        this.fileChanges = metadata.fileChanges;

        if (options.messages && options.messages.length > 0) {
            this.messages = cloneMessages(options.messages);
        } else if (options.systemPrompt) {
            this.messages.push({ role: 'system', content: options.systemPrompt as string });
        }

        this.compactIfNeeded();
    }

    /** Add message */
    addMessage(message: LLMMessage): void {
        this.messages.push(cloneMessage(message));
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
        const startedAt = normalizeDate(input.startedAt) ?? new Date();
        const completedAt = normalizeDate(input.completedAt) ?? startedAt;
        const toolEvent: AgentToolExecution = {
            id: input.id,
            name: input.name,
            args: sanitizeToolArgs(input.args),
            success: input.success,
            outputPreview: createTextPreview(input.output),
            ...(input.error ? { error: truncateText(input.error, MAX_TEXT_PREVIEW_LENGTH) } : {}),
            startedAt,
            completedAt,
        };

        this.toolHistory.push(toolEvent);

        const metadata = input.metadata ?? {};
        const command = readString(metadata['command']);
        const cwd = readString(metadata['cwd']);
        if (command && cwd) {
            this.commandHistory.push({
                id: input.id,
                command,
                cwd,
                success: input.success,
                outputPreview: createTextPreview(input.output),
                ...(input.error ? { error: truncateText(input.error, MAX_TEXT_PREVIEW_LENGTH) } : {}),
                startedAt,
                completedAt,
            });
        }

        const filePath = readString(metadata['path']);
        const changeType = readString(metadata['changeType']);
        const bytes = readNumber(metadata['bytes']) ?? 0;
        if (filePath && isFileChangeType(changeType)) {
            this.fileChanges.push({
                id: input.id,
                path: filePath,
                changeType,
                bytes,
                success: input.success,
                ...(typeof metadata['existedBefore'] === 'boolean'
                    ? { existedBefore: metadata['existedBefore'] }
                    : {}),
                timestamp: completedAt,
            });
        }

        const filePaths = Array.isArray(metadata['filePaths'])
            ? metadata['filePaths'].filter((value): value is string => typeof value === 'string')
            : [];
        if (!filePath && filePaths.length > 0 && isFileChangeType(changeType)) {
            for (const changedPath of filePaths) {
                this.fileChanges.push({
                    id: input.id,
                    path: changedPath,
                    changeType,
                    bytes,
                    success: input.success,
                    timestamp: completedAt,
                });
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

    /** Get command execution history */
    getCommandHistory(): AgentCommandHistoryEntry[] {
        return this.commandHistory.map(cloneCommandHistoryEntry);
    }

    /** Get file change history */
    getFileChanges(): AgentFileChangeEntry[] {
        return this.fileChanges.map(cloneFileChangeEntry);
    }

    /** Get session metadata snapshot */
    getMetadata(): AgentSessionMetadataSnapshot {
        return {
            ...(this.compactSummary ? { compactSummary: this.compactSummary } : {}),
            compactions: this.getCompactions(),
            toolHistory: this.getToolHistory(),
            commandHistory: this.getCommandHistory(),
            fileChanges: this.getFileChanges(),
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
        this.commandHistory = [];
        this.fileChanges = [];
    }

    /** Force session compaction using externally provided summary */
    performCompaction(summary: string): void {
        const baseSystemMessage = findBaseSystemMessage(this.messages);
        const conversationMessages = this.messages.filter(m => m !== baseSystemMessage);
        const keepRecentCount = Math.max(4, Math.floor(conversationMessages.length * 0.2));
        const recentMessages = conversationMessages.slice(-keepRecentCount);

        const nextMessages: LLMMessage[] = [];
        if (baseSystemMessage) {
            nextMessages.push(cloneMessage(baseSystemMessage));
        }
        nextMessages.push({
            role: 'system',
            content: `${AUTO_SUMMARY_PREFIX}\n${summary}`,
        });
        nextMessages.push(...cloneMessages(recentMessages));

        const compaction: AgentSessionCompaction = {
            id: generateCompactionId(),
            createdAt: new Date(),
            messageCountBefore: this.messages.length,
            messageCountAfter: nextMessages.length,
            summary,
        };

        this.compactSummary = summary;
        this.compactions.push(compaction);
        this.messages = nextMessages;
    }

    /** Automatically compact old context when message limit is exceeded */
    private compactIfNeeded(): void {
        if (this.messages.length <= this.maxMessages) {
            return;
        }

        const baseSystemMessage = findBaseSystemMessage(this.messages);
        const conversationMessages = this.messages.filter((message) => {
            if (message.role !== 'system') {
                return true;
            }

            return !isAutoSummaryMessage(message) && message !== baseSystemMessage;
        });
        const includeSummaryMessage = this.maxMessages > (baseSystemMessage ? 1 : 0);
        const reservedSlots = (baseSystemMessage ? 1 : 0) + (includeSummaryMessage ? 1 : 0);
        const maxRecentCount = Math.max(1, this.maxMessages - reservedSlots);
        const keepRecentCount = Math.min(
            conversationMessages.length,
            Math.max(1, Math.floor(this.maxMessages / 2)),
            maxRecentCount,
        );
        const compactBoundary = Math.max(0, conversationMessages.length - keepRecentCount);
        const compactedMessages = conversationMessages.slice(0, compactBoundary);
        const recentMessages = conversationMessages.slice(compactBoundary);
        const summary = this.buildCompactSummary(compactedMessages);
        const nextMessages: LLMMessage[] = [];

        if (baseSystemMessage) {
            nextMessages.push(cloneMessage(baseSystemMessage));
        }
        if (includeSummaryMessage) {
            nextMessages.push({
                role: 'system',
                content: formatAutoSummaryMessage(summary),
            });
        }
        nextMessages.push(...cloneMessages(recentMessages));

        const compaction: AgentSessionCompaction = {
            id: generateCompactionId(),
            createdAt: new Date(),
            messageCountBefore: this.messages.length,
            messageCountAfter: nextMessages.length,
            summary,
        };

        this.compactSummary = summary;
        this.compactions.push(compaction);
        this.messages = nextMessages.slice(-this.maxMessages);
    }

    private buildCompactSummary(compactedMessages: LLMMessage[]): string {
        const sections: string[] = [];
        const priorSummary = this.compactSummary?.trim();

        if (priorSummary) {
            sections.push(`Previous summary: ${truncateText(priorSummary, 320)}`);
        }

        const userRequests = collectDistinctMessages(compactedMessages, 'user', 4);
        if (userRequests.length > 0) {
            sections.push(`User requests: ${userRequests.join('; ')}`);
        }

        const assistantConclusions = collectDistinctMessages(compactedMessages, 'assistant', 3);
        if (assistantConclusions.length > 0) {
            sections.push(`Conclusions provided: ${assistantConclusions.join('; ')}`);
        }

        const recentCommands = this.commandHistory.slice(-4).map((entry) => truncateText(entry.command, 120));
        if (recentCommands.length > 0) {
            sections.push(`Recent commands: ${recentCommands.join('; ')}`);
        }

        const changedFiles = this.fileChanges.slice(-6).map((entry) => truncateText(entry.path, 120));
        if (changedFiles.length > 0) {
            sections.push(`Recently changed files: ${changedFiles.join('; ')}`);
        }

        if (sections.length === 0) {
            sections.push('Previous conversation has been automatically compacted. Please continue working with the current project context.');
        }

        return truncateText(
            sections.map((section) => `- ${section}`).join('\n'),
            MAX_SUMMARY_LENGTH,
        );
    }
}

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
    };
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
        timestamp,
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

function cloneMessages(messages: LLMMessage[]): LLMMessage[] {
    return messages.map(cloneMessage);
}

function cloneMessage(message: LLMMessage): LLMMessage {
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

function cloneCompaction(compaction: AgentSessionCompaction): AgentSessionCompaction {
    return {
        ...compaction,
        createdAt: new Date(compaction.createdAt),
    };
}

function cloneToolExecution(entry: AgentToolExecution): AgentToolExecution {
    return {
        ...entry,
        args: sanitizeToolArgs(entry.args),
        startedAt: new Date(entry.startedAt),
        completedAt: new Date(entry.completedAt),
    };
}

function cloneCommandHistoryEntry(entry: AgentCommandHistoryEntry): AgentCommandHistoryEntry {
    return {
        ...entry,
        startedAt: new Date(entry.startedAt),
        completedAt: new Date(entry.completedAt),
    };
}

function cloneFileChangeEntry(entry: AgentFileChangeEntry): AgentFileChangeEntry {
    return {
        ...entry,
        timestamp: new Date(entry.timestamp),
    };
}

function sanitizeToolArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!args) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(args).map(([key, value]) => [key, sanitizeToolArgValue(key, value)]),
    );
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

function findBaseSystemMessage(messages: LLMMessage[]): LLMMessage | undefined {
    return messages.find((message) => message.role === 'system' && !isAutoSummaryMessage(message));
}

function isAutoSummaryMessage(message: LLMMessage): boolean {
    return message.role === 'system' && message.content.startsWith(AUTO_SUMMARY_PREFIX);
}

function formatAutoSummaryMessage(summary: string): string {
    return `${AUTO_SUMMARY_PREFIX}
The following is an automatically compacted context summary. Please continue using these facts and progress in subsequent responses:
${summary}`;
}

function collectDistinctMessages(
    messages: LLMMessage[],
    role: LLMMessage['role'],
    limit: number,
): string[] {
    const values = messages
        .filter((message) => message.role === role)
        .map((message) => truncateText(message.content.trim(), 140))
        .filter(Boolean);

    return Array.from(new Set(values)).slice(-limit);
}

function createTextPreview(value: string): string {
    return truncateText(value.trim(), MAX_TEXT_PREVIEW_LENGTH);
}

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : new Date(value);
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const normalized = new Date(value);
        return Number.isNaN(normalized.getTime()) ? undefined : normalized;
    }

    return undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isFileChangeType(value: string | undefined): value is AgentFileChangeEntry['changeType'] {
    return value === 'write' || value === 'patch' || value === 'restore';
}
