// ============================================================
// Agent Session 管理
// ============================================================

import type { LLMMessage, MessageAttachment } from '@xqoder/shared';

const AUTO_SUMMARY_PREFIX = '[XQoder auto-compact summary]';
const MAX_TEXT_PREVIEW_LENGTH = 400;
const MAX_ARG_PREVIEW_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 1600;

/** 会话 ID 生成 */
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

export interface AgentSessionCompactionPlan {
    compactedMessages: LLMMessage[];
    recentMessages: LLMMessage[];
    priorSummary?: string;
    reservedMessageCount: number;
}

export interface AgentSessionFixHistoryWindow {
    label: '7d' | '30d';
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    successRate: number;
}

export interface AgentSessionFixRun {
    id: string;
    success: boolean;
    attemptCount: number;
    totalDurationMs: number;
    startedAt: Date;
    completedAt: Date;
    failureBucket?: string;
    resultLabel?: string;
    remediationPolicyIds: string[];
    suspectedFailureBuckets: string[];
    automaticActionIds: string[];
}

export interface AgentSessionFixHistorySnapshot {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    successRate: number;
    updatedAt: Date;
    rollingWindows: AgentSessionFixHistoryWindow[];
    recentRuns: AgentSessionFixRun[];
}

export interface AgentSessionMetadataSnapshot {
    compactSummary?: string;
    compactions: AgentSessionCompaction[];
    toolHistory: AgentToolExecution[];
    commandHistory: AgentCommandHistoryEntry[];
    fileChanges: AgentFileChangeEntry[];
    fixHistory?: AgentSessionFixHistorySnapshot;
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
    reservedMessages?: number;
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
 * 管理单次 Agent 会话的消息历史和上下文
 */
export class AgentSession {
    readonly id: string;
    private title?: string;
    private messages: LLMMessage[] = [];
    private readonly maxMessages: number;
    private reservedMessages?: number;
    readonly createdAt: Date;
    private usage: AgentSessionUsage;
    private compactSummary?: string;
    private compactions: AgentSessionCompaction[];
    private toolHistory: AgentToolExecution[];
    private commandHistory: AgentCommandHistoryEntry[];
    private fileChanges: AgentFileChangeEntry[];
    private fixHistory?: AgentSessionFixHistorySnapshot;

    constructor(systemPrompt?: string, maxMessages?: number);
    constructor(options: AgentSessionOptions);
    constructor(
        systemPromptOrOptions?: string | AgentSessionOptions,
        maxMessages: number = 100,
    ) {
        const options = typeof systemPromptOrOptions === 'object' && systemPromptOrOptions !== null
            ? systemPromptOrOptions
            : {
                systemPrompt: systemPromptOrOptions,
                maxMessages,
            };
        const metadata = normalizeSessionMetadataSnapshot(options.metadata);

        this.id = options.id ?? generateSessionId();
        this.title = readString(options.title);
        this.maxMessages = options.maxMessages ?? 100;
        this.reservedMessages = normalizeReservedMessages(options.reservedMessages);
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
        this.fixHistory = metadata.fixHistory;

        if (options.messages && options.messages.length > 0) {
            this.messages = cloneMessages(options.messages);
        } else if (options.systemPrompt) {
            this.messages.push({ role: 'system', content: options.systemPrompt });
        }

        this.compactIfNeeded();
    }

    /** 添加消息 */
    addMessage(message: LLMMessage): void {
        this.messages.push(cloneMessage(message));
        this.compactIfNeeded();
    }

    /** 添加用户消息 */
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

    /** 添加助手消息 */
    addAssistantMessage(message: LLMMessage): void {
        this.addMessage(message);
    }

    /** 添加工具结果消息 */
    addToolResult(toolCallId: string, content: string): void {
        this.addMessage({ role: 'tool', content, toolCallId });
    }

    /** 记录累计 Token 使用量 */
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

    /** 记录一次工具执行，并派生命令/文件历史 */
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

    /** 获取所有消息 */
    getMessages(): LLMMessage[] {
        return cloneMessages(this.messages);
    }

    /** 获取消息数量 */
    get messageCount(): number {
        return this.messages.length;
    }

    /** 获取累计 Token 使用量 */
    getUsage(): AgentSessionUsage {
        return { ...this.usage };
    }

    /** 获取当前会话标题 */
    getTitle(): string | undefined {
        return this.title;
    }

    /** 更新会话标题 */
    setTitle(title: string | undefined): void {
        this.title = readString(title);
    }

    /** 获取自动压缩摘要 */
    getCompactSummary(): string | undefined {
        return this.compactSummary;
    }

    /** 配置压缩时保留的最近消息数量 */
    setCompactionReservedMessages(reservedMessages: number | undefined): void {
        this.reservedMessages = normalizeReservedMessages(reservedMessages);
    }

    /** 获取压缩历史 */
    getCompactions(): AgentSessionCompaction[] {
        return this.compactions.map(cloneCompaction);
    }

    /** 获取工具执行历史 */
    getToolHistory(): AgentToolExecution[] {
        return this.toolHistory.map(cloneToolExecution);
    }

    /** 获取命令执行历史 */
    getCommandHistory(): AgentCommandHistoryEntry[] {
        return this.commandHistory.map(cloneCommandHistoryEntry);
    }

    /** 获取文件变更历史 */
    getFileChanges(): AgentFileChangeEntry[] {
        return this.fileChanges.map(cloneFileChangeEntry);
    }

    /** 获取会话元数据快照 */
    getMetadata(): AgentSessionMetadataSnapshot {
        return {
            ...(this.compactSummary ? { compactSummary: this.compactSummary } : {}),
            compactions: this.getCompactions(),
            toolHistory: this.getToolHistory(),
            commandHistory: this.getCommandHistory(),
            fileChanges: this.getFileChanges(),
            ...(this.fixHistory ? { fixHistory: cloneFixHistory(this.fixHistory) } : {}),
        };
    }

    /** 导出可持久化快照 */
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

    /** 根据快照恢复一个会话 */
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

    /** 清空消息（保留 system prompt） */
    clear(): void {
        const systemMessage = findBaseSystemMessage(this.messages);
        this.messages = systemMessage ? [cloneMessage(systemMessage)] : [];
        this.compactSummary = undefined;
        this.compactions = [];
        this.toolHistory = [];
        this.commandHistory = [];
        this.fileChanges = [];
        this.fixHistory = undefined;
    }

    /**
     * 更新「base system prompt」（即第一个非 auto-compact summary 的 system 消息）。
     * 该操作不清空用户/助手/工具消息，只更新系统指令，避免 agent 切换导致上下文丢失。
     */
    setBaseSystemPrompt(systemPrompt: string): void {
        const baseSystem = findBaseSystemMessage(this.messages);
        if (baseSystem) {
            baseSystem.content = systemPrompt;
            return;
        }

        // 如果会话里没有 base system（理论上不应发生），则在最前插入一条。
        this.messages.unshift({ role: 'system', content: systemPrompt });
    }

    /** 计算当前会话的压缩边界，保留最近 N 条消息原样存在 */
    createCompactionPlan(options: { reservedMessages?: number } = {}): AgentSessionCompactionPlan {
        const baseSystemMessage = findBaseSystemMessage(this.messages);
        const conversationMessages = this.messages.filter((message) => {
            if (message.role !== 'system') {
                return true;
            }

            return !isAutoSummaryMessage(message) && message !== baseSystemMessage;
        });
        const reservedSlots = (baseSystemMessage ? 1 : 0) + 1;
        const maxRecentCount = Math.max(1, this.maxMessages - reservedSlots);
        const keepRecentCount = resolveReservedMessageCount(
            conversationMessages.length,
            maxRecentCount,
            normalizeReservedMessages(options.reservedMessages) ?? this.reservedMessages,
            this.maxMessages,
        );
        const compactBoundary = Math.max(0, conversationMessages.length - keepRecentCount);

        return {
            compactedMessages: cloneMessages(conversationMessages.slice(0, compactBoundary)),
            recentMessages: cloneMessages(conversationMessages.slice(compactBoundary)),
            ...(this.compactSummary?.trim() ? { priorSummary: this.compactSummary.trim() } : {}),
            reservedMessageCount: keepRecentCount,
        };
    }

    /** 使用外部提供的摘要强制压缩会话 */
    performCompaction(summary: string, options: { reservedMessages?: number } = {}): void {
        const plan = this.createCompactionPlan(options);
        const baseSystemMessage = findBaseSystemMessage(this.messages);

        const nextMessages: LLMMessage[] = [];
        if (baseSystemMessage) {
            nextMessages.push(cloneMessage(baseSystemMessage));
        }
        nextMessages.push({
            role: 'system',
            content: `${AUTO_SUMMARY_PREFIX}\n${summary}`,
        });
        nextMessages.push(...cloneMessages(plan.recentMessages));

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

    /** 当消息超出限制时，自动压缩旧上下文 */
    private compactIfNeeded(): void {
        if (this.messages.length <= this.maxMessages) {
            return;
        }

        const baseSystemMessage = findBaseSystemMessage(this.messages);
        const plan = this.createCompactionPlan();
        const summary = this.buildCompactSummary(plan.compactedMessages, plan.recentMessages);
        const nextMessages: LLMMessage[] = [];

        if (baseSystemMessage) {
            nextMessages.push(cloneMessage(baseSystemMessage));
        }
        if (this.maxMessages > (baseSystemMessage ? 1 : 0)) {
            nextMessages.push({
                role: 'system',
                content: formatAutoSummaryMessage(summary),
            });
        }
        nextMessages.push(...cloneMessages(plan.recentMessages));

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

    private buildCompactSummary(compactedMessages: LLMMessage[], recentMessages: LLMMessage[]): string {
        const sections: string[] = [];
        const priorSummary = this.compactSummary?.trim();

        if (priorSummary) {
            sections.push([
                '## Historical Summary',
                truncateText(priorSummary, 320),
            ].join('\n'));
        }

        const historicalHighlights: string[] = [];
        const userRequests = collectDistinctMessages(compactedMessages, 'user', 4);
        if (userRequests.length > 0) {
            historicalHighlights.push(`用户需求: ${userRequests.join('；')}`);
        }

        const assistantConclusions = collectDistinctMessages(compactedMessages, 'assistant', 3);
        if (assistantConclusions.length > 0) {
            historicalHighlights.push(`已给出的结论: ${assistantConclusions.join('；')}`);
        }

        const recentCommands = this.commandHistory.slice(-4).map((entry) => truncateText(entry.command, 120));
        if (recentCommands.length > 0) {
            historicalHighlights.push(`最近执行命令: ${recentCommands.join('；')}`);
        }

        const changedFiles = this.fileChanges.slice(-6).map((entry) => truncateText(entry.path, 120));
        if (changedFiles.length > 0) {
            historicalHighlights.push(`最近变更文件: ${changedFiles.join('；')}`);
        }

        if (historicalHighlights.length > 0) {
            sections.push([
                '## Historical Highlights',
                ...historicalHighlights.map((section) => `- ${section}`),
            ].join('\n'));
        }

        if (recentMessages.length > 0) {
            sections.push([
                '## Recent Turns Kept Verbatim',
                `- 保留最近 ${recentMessages.length} 条消息原文，不重复改写。`,
                ...formatRecentTurnLayer(recentMessages),
            ].join('\n'));
        }

        if (sections.length === 0) {
            sections.push([
                '## Historical Highlights',
                '- 此前对话已被自动压缩，请延续当前项目上下文继续工作。',
            ].join('\n'));
        }

        return truncateText(
            sections.join('\n\n'),
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
    const fixHistory = normalizeFixHistory(source?.fixHistory);

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
        ...(fixHistory ? { fixHistory } : {}),
    };
}

function normalizeFixHistory(value: unknown): AgentSessionFixHistorySnapshot | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }

    const source = value as Partial<AgentSessionFixHistorySnapshot>;
    const totalRuns = readNumber(source.totalRuns);
    const successfulRuns = readNumber(source.successfulRuns);
    const failedRuns = readNumber(source.failedRuns);
    const successRate = readNumber(source.successRate);
    const updatedAt = normalizeDate(source.updatedAt);

    if (totalRuns === undefined || successfulRuns === undefined || failedRuns === undefined || successRate === undefined || !updatedAt) {
        return undefined;
    }

    return {
        totalRuns,
        successfulRuns,
        failedRuns,
        successRate,
        updatedAt,
        rollingWindows: Array.isArray(source.rollingWindows)
            ? source.rollingWindows
                .map(normalizeFixHistoryWindow)
                .filter((entry): entry is AgentSessionFixHistoryWindow => entry !== null)
            : [],
        recentRuns: Array.isArray(source.recentRuns)
            ? source.recentRuns
                .map(normalizeFixRun)
                .filter((entry): entry is AgentSessionFixRun => entry !== null)
            : [],
    };
}

function normalizeFixHistoryWindow(value: unknown): AgentSessionFixHistoryWindow | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentSessionFixHistoryWindow>;
    const label = entry.label === '7d' || entry.label === '30d' ? entry.label : undefined;
    const totalRuns = readNumber(entry.totalRuns);
    const successfulRuns = readNumber(entry.successfulRuns);
    const failedRuns = readNumber(entry.failedRuns);
    const successRate = readNumber(entry.successRate);

    if (!label || totalRuns === undefined || successfulRuns === undefined || failedRuns === undefined || successRate === undefined) {
        return null;
    }

    return {
        label,
        totalRuns,
        successfulRuns,
        failedRuns,
        successRate,
    };
}

function normalizeFixRun(value: unknown): AgentSessionFixRun | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const entry = value as Partial<AgentSessionFixRun>;
    const id = readString(entry.id);
    const attemptCount = readNumber(entry.attemptCount);
    const totalDurationMs = readNumber(entry.totalDurationMs);
    const startedAt = normalizeDate(entry.startedAt);
    const completedAt = normalizeDate(entry.completedAt);

    if (!id || attemptCount === undefined || totalDurationMs === undefined || !startedAt || !completedAt) {
        return null;
    }

    return {
        id,
        success: Boolean(entry.success),
        attemptCount,
        totalDurationMs,
        startedAt,
        completedAt,
        ...(readString(entry.failureBucket) ? { failureBucket: readString(entry.failureBucket) } : {}),
        ...(readString(entry.resultLabel) ? { resultLabel: readString(entry.resultLabel) } : {}),
        remediationPolicyIds: Array.isArray(entry.remediationPolicyIds)
            ? entry.remediationPolicyIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
            : [],
        suspectedFailureBuckets: Array.isArray(entry.suspectedFailureBuckets)
            ? entry.suspectedFailureBuckets.filter((item): item is string => typeof item === 'string' && item.length > 0)
            : [],
        automaticActionIds: Array.isArray(entry.automaticActionIds)
            ? entry.automaticActionIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
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

function cloneFixHistory(entry: AgentSessionFixHistorySnapshot): AgentSessionFixHistorySnapshot {
    return {
        ...entry,
        updatedAt: new Date(entry.updatedAt),
        rollingWindows: entry.rollingWindows.map((window) => ({ ...window })),
        recentRuns: entry.recentRuns.map(cloneFixRun),
    };
}

function cloneFixRun(entry: AgentSessionFixRun): AgentSessionFixRun {
    return {
        ...entry,
        startedAt: new Date(entry.startedAt),
        completedAt: new Date(entry.completedAt),
        remediationPolicyIds: [...entry.remediationPolicyIds],
        suspectedFailureBuckets: [...entry.suspectedFailureBuckets],
        automaticActionIds: [...entry.automaticActionIds],
    };
}

function normalizeReservedMessages(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.max(1, Math.trunc(value))
        : undefined;
}

function resolveReservedMessageCount(
    conversationMessageCount: number,
    maxRecentCount: number,
    reservedMessages: number | undefined,
    maxMessages: number,
): number {
    if (reservedMessages !== undefined) {
        return Math.min(conversationMessageCount, maxRecentCount, reservedMessages);
    }

    return Math.min(
        conversationMessageCount,
        Math.max(1, Math.floor(maxMessages / 2)),
        maxRecentCount,
    );
}

function formatRecentTurnLayer(messages: LLMMessage[]): string[] {
    return messages
        .slice(-4)
        .map((message) => `- ${formatMessageRole(message.role)}: ${truncateText(message.content.trim(), 120)}`);
}

function formatMessageRole(role: LLMMessage['role']): string {
    switch (role) {
        case 'user':
            return 'User';
        case 'assistant':
            return 'Assistant';
        case 'tool':
            return 'Tool';
        case 'system':
            return 'System';
        default:
            return role;
    }
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
以下内容是自动压缩后的上下文摘要，请在后续回答中延续这些事实与进度：
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
