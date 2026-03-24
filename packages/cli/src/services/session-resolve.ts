/**
 * Session 解析服务（Day 43 迁出 TUI 的业务逻辑）
 * 供 TUI 初始加载/恢复与 CLI export/share 共用，避免在 app 内重复 listSessions/getSessionSnapshot。
 */
import {
    AgentSession,
    type AgentSessionSnapshot,
    type PersistedSessionSummary,
} from '@xqoder/agent';
import type { CoreMessage, JsonValue, MessageAttachment as ProtocolMessageAttachment } from '@xqoder/protocol';
import type { SessionRecord } from '@xqoder/runtime';
import type { LLMMessage, MessageAttachment } from '@xqoder/shared';

export interface ResolvedSession {
    session: AgentSession;
    summary: PersistedSessionSummary;
}

export interface ResolvedSessionForTui {
    sessionId: string;
    title?: string;
}

export interface RuntimeSessionResolveStore {
    listSessions(options?: { projectRoot?: string; limit?: number }): Promise<SessionRecord[]> | SessionRecord[];
    loadSessionSnapshot(sessionId: string): Promise<SessionRecord | undefined> | SessionRecord | undefined;
}

export interface SnapshotSessionResolveStore {
    getSessionSnapshot?(sessionId: string): AgentSessionSnapshot | null;
    getSessionSummary?(sessionId: string): PersistedSessionSummary | null;
    listSessions?(projectRoot?: string, limit?: number): PersistedSessionSummary[];
}

/**
 * @deprecated 兼容旧的 snapshot 风格读取接口；新链路请优先使用 RuntimeSessionResolveStore。
 */
export type LegacySessionResolveStore = SnapshotSessionResolveStore;

type SessionLookupStore = Pick<SnapshotSessionResolveStore, 'getSessionSnapshot' | 'getSessionSummary'>;
type LatestSessionStore = Pick<SnapshotSessionResolveStore, 'listSessions'>;
export type SessionResolveStore = SnapshotSessionResolveStore | RuntimeSessionResolveStore;
export type SessionSummaryResolveStore = Pick<SnapshotSessionResolveStore, 'listSessions'> | Pick<RuntimeSessionResolveStore, 'listSessions'>;

export interface SessionResolveDefaults {
    projectRoot?: string;
    cwd?: string;
    model?: string;
}

function isRuntimeSessionResolveStore(
    store: SessionResolveStore | SessionSummaryResolveStore,
): store is RuntimeSessionResolveStore {
    return typeof (store as RuntimeSessionResolveStore).loadSessionSnapshot === 'function'
        && typeof (store as RuntimeSessionResolveStore).listSessions === 'function';
}

function findLastUserMessage(messages: AgentSessionSnapshot['messages']): string | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role === 'user') {
            return messages[index].content;
        }
    }
    return undefined;
}

function toRuntimeJsonValue(value: unknown): JsonValue {
    if (value === null) {
        return null;
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => toRuntimeJsonValue(entry));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, entry]) => entry !== undefined)
                .map(([key, entry]) => [key, toRuntimeJsonValue(entry)]),
        );
    }
    return null;
}

function toCoreMessage(
    message: AgentSessionSnapshot['messages'][number],
    sessionId: string,
    index: number,
    createdAt: number,
): CoreMessage {
    return {
        id: `${sessionId}:snapshot:${index}`,
        sessionId,
        role: message.role,
        content: message.content,
        createdAt,
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message.thinking ? { thinking: message.thinking } : {}),
        ...(message.toolCalls && message.toolCalls.length > 0
            ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) }
            : {}),
        ...(message.attachments && message.attachments.length > 0
            ? {
                attachments: message.attachments.map((attachment) => ({
                    kind: attachment.kind,
                    mimeType: attachment.mimeType,
                    data: attachment.data,
                    fileName: attachment.fileName,
                    filePath: attachment.filePath,
                    ...(attachment.url ? { url: attachment.url } : {}),
                })),
            }
            : {}),
        ...(message.parts && message.parts.length > 0
            ? {
                parts: message.parts.map((part) => {
                    if (part.type === 'tool_call') {
                        return {
                            ...part,
                            toolCall: { ...part.toolCall },
                        };
                    }
                    return { ...part };
                }),
            }
            : {}),
    };
}

function toSessionRecordFromSummary(summary: PersistedSessionSummary): SessionRecord {
    return {
        id: summary.id,
        cwd: summary.cwd,
        title: summary.title,
        createdAt: summary.createdAt.getTime(),
        updatedAt: summary.updatedAt.getTime(),
        messages: [],
        metadata: {
            projectRoot: summary.projectRoot,
            model: summary.model,
            maxMessages: summary.maxMessages,
            messageCount: summary.messageCount,
            promptTokens: summary.usage.promptTokens,
            completionTokens: summary.usage.completionTokens,
            totalTokens: summary.usage.totalTokens,
            ...(summary.usage.cacheReadTokens !== undefined ? { cacheReadTokens: summary.usage.cacheReadTokens } : {}),
            ...(summary.usage.cacheCreationTokens !== undefined ? { cacheCreationTokens: summary.usage.cacheCreationTokens } : {}),
            ...(summary.usage.cost !== undefined ? { cost: summary.usage.cost } : {}),
            ...(summary.lastUserMessage ? { lastUserMessage: summary.lastUserMessage } : {}),
            compactionCount: summary.compactionCount,
            commandCount: summary.commandCount,
            fileChangeCount: summary.fileChangeCount,
        },
    };
}

function toSessionRecordFromSnapshot(
    snapshot: AgentSessionSnapshot,
    summary?: PersistedSessionSummary | null,
    defaults: SessionResolveDefaults = {},
): SessionRecord {
    const createdAt = snapshot.createdAt.getTime();
    const lastUserMessage = findLastUserMessage(snapshot.messages);
    return {
        id: snapshot.id,
        cwd: summary?.cwd ?? defaults.cwd ?? defaults.projectRoot ?? '',
        title: summary?.title ?? snapshot.title ?? 'New Session',
        createdAt,
        updatedAt: summary?.updatedAt.getTime() ?? createdAt,
        messages: snapshot.messages.map((message, index) => toCoreMessage(message, snapshot.id, index, createdAt + index)),
        metadata: {
            projectRoot: summary?.projectRoot ?? defaults.projectRoot ?? defaults.cwd ?? '',
            model: summary?.model ?? defaults.model ?? 'unknown',
            maxMessages: summary?.maxMessages ?? snapshot.maxMessages,
            messageCount: summary?.messageCount ?? snapshot.messages.length,
            promptTokens: snapshot.usage.promptTokens,
            completionTokens: snapshot.usage.completionTokens,
            totalTokens: snapshot.usage.totalTokens,
            ...(snapshot.usage.cacheReadTokens !== undefined ? { cacheReadTokens: snapshot.usage.cacheReadTokens } : {}),
            ...(snapshot.usage.cacheCreationTokens !== undefined ? { cacheCreationTokens: snapshot.usage.cacheCreationTokens } : {}),
            ...(snapshot.usage.cost !== undefined ? { cost: snapshot.usage.cost } : {}),
            ...(summary?.lastUserMessage ?? lastUserMessage ? { lastUserMessage: summary?.lastUserMessage ?? lastUserMessage } : {}),
            ...(snapshot.metadata.compactSummary ? { compactSummary: snapshot.metadata.compactSummary } : {}),
            compactions: toRuntimeJsonValue(snapshot.metadata.compactions),
            toolHistory: toRuntimeJsonValue(snapshot.metadata.toolHistory),
            commandHistory: toRuntimeJsonValue(snapshot.metadata.commandHistory),
            fileChanges: toRuntimeJsonValue(snapshot.metadata.fileChanges),
            ...(snapshot.metadata.fixHistory ? { fixHistory: toRuntimeJsonValue(snapshot.metadata.fixHistory) } : {}),
            compactionCount: summary?.compactionCount ?? snapshot.metadata.compactions.length,
            commandCount: summary?.commandCount ?? snapshot.metadata.commandHistory.length,
            fileChangeCount: summary?.fileChangeCount ?? snapshot.metadata.fileChanges.length,
        },
    };
}

export function createRuntimeSessionResolveStoreAdapter(
    store: SessionResolveStore | SessionSummaryResolveStore,
    defaults: SessionResolveDefaults = {},
): RuntimeSessionResolveStore {
    if (isRuntimeSessionResolveStore(store)) {
        return store;
    }

    const snapshotStore = store as SnapshotSessionResolveStore;

    return {
        listSessions(options) {
            const summaries = snapshotStore.listSessions?.(options?.projectRoot, options?.limit) ?? [];
            return summaries.map((summary) => toSessionRecordFromSummary(summary));
        },
        loadSessionSnapshot(sessionId) {
            const snapshot = snapshotStore.getSessionSnapshot?.(sessionId);
            if (!snapshot) {
                return undefined;
            }
            const summary = snapshotStore.getSessionSummary?.(sessionId) ?? null;
            return toSessionRecordFromSnapshot(snapshot, summary, defaults);
        },
    };
}

export async function loadRuntimeSessionSnapshotRecord(
    sessionStore: RuntimeSessionResolveStore,
    sessionId: string,
): Promise<SessionRecord | undefined> {
    return await sessionStore.loadSessionSnapshot(sessionId);
}

function readLegacySessionSummary(
    sessionStore: SessionResolveStore,
    sessionId: string,
): PersistedSessionSummary | null {
    if (isRuntimeSessionResolveStore(sessionStore)) {
        return null;
    }
    return sessionStore.getSessionSummary?.(sessionId) ?? null;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toSharedAttachment(attachment: ProtocolMessageAttachment): MessageAttachment | null {
    if (attachment.kind !== 'image' && attachment.kind !== 'file') {
        return null;
    }

    return {
        kind: attachment.kind,
        type: attachment.kind,
        mimeType: attachment.mimeType,
        data: attachment.data,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
        ...(attachment.url ? { url: attachment.url } : {}),
    };
}

function toSharedContentPart(
    part: NonNullable<AgentSessionSnapshot['messages'][number]['parts']>[number],
): NonNullable<LLMMessage['parts']>[number] {
    if (part.type === 'tool_call') {
        return {
            ...part,
            toolCall: { ...part.toolCall },
        };
    }
    return { ...part };
}

export function toAgentSession(record: SessionRecord): AgentSession {
    const snapshot = {
        id: record.id,
        ...(record.title ? { title: record.title } : {}),
        createdAt: new Date(record.createdAt),
        maxMessages: readNumber(record.metadata?.['maxMessages'], 100),
        messages: record.messages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
            ...(message.thinking ? { thinking: message.thinking } : {}),
            ...(message.toolCalls
                ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) }
                : {}),
            ...(message.attachments
                ? {
                    attachments: message.attachments
                        .map(toSharedAttachment)
                        .filter((attachment): attachment is MessageAttachment => attachment !== null),
                }
                : {}),
            ...(message.parts
                ? { parts: message.parts.map(toSharedContentPart) }
                : {}),
        })),
        usage: {
            promptTokens: readNumber(record.metadata?.['promptTokens'], 0),
            completionTokens: readNumber(record.metadata?.['completionTokens'], 0),
            totalTokens: readNumber(record.metadata?.['totalTokens'], 0),
            ...(typeof record.metadata?.['cacheReadTokens'] === 'number'
                ? { cacheReadTokens: record.metadata['cacheReadTokens'] }
                : {}),
            ...(typeof record.metadata?.['cacheCreationTokens'] === 'number'
                ? { cacheCreationTokens: record.metadata['cacheCreationTokens'] }
                : {}),
            ...(typeof record.metadata?.['cost'] === 'number'
                ? { cost: record.metadata['cost'] }
                : {}),
        },
        metadata: {
            ...(readString(record.metadata?.['compactSummary'])
                ? { compactSummary: readString(record.metadata?.['compactSummary']) }
                : {}),
            compactions: Array.isArray(record.metadata?.['compactions']) ? record.metadata['compactions'] : [],
            toolHistory: Array.isArray(record.metadata?.['toolHistory']) ? record.metadata['toolHistory'] : [],
            commandHistory: Array.isArray(record.metadata?.['commandHistory']) ? record.metadata['commandHistory'] : [],
            fileChanges: Array.isArray(record.metadata?.['fileChanges']) ? record.metadata['fileChanges'] : [],
            ...(record.metadata?.['fixHistory'] && typeof record.metadata['fixHistory'] === 'object' && !Array.isArray(record.metadata['fixHistory'])
                ? { fixHistory: record.metadata['fixHistory'] }
                : {}),
        },
    } as unknown as AgentSessionSnapshot;

    return AgentSession.fromSnapshot(snapshot);
}

export function toPersistedSessionSummary(record: SessionRecord): PersistedSessionSummary {
    const compactionCountFallback = Array.isArray(record.metadata?.['compactions'])
        ? record.metadata['compactions'].length
        : 0;
    const commandCountFallback = Array.isArray(record.metadata?.['commandHistory'])
        ? record.metadata['commandHistory'].length
        : 0;
    const fileChangeCountFallback = Array.isArray(record.metadata?.['fileChanges'])
        ? record.metadata['fileChanges'].length
        : 0;

    return {
        id: record.id,
        projectRoot: readString(record.metadata?.['projectRoot']) ?? record.cwd,
        cwd: record.cwd,
        model: readString(record.metadata?.['model']) ?? 'unknown',
        title: record.title ?? 'New Session',
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
        maxMessages: readNumber(record.metadata?.['maxMessages'], 100),
        messageCount: readNumber(record.metadata?.['messageCount'], record.messages.length),
        usage: {
            promptTokens: readNumber(record.metadata?.['promptTokens'], 0),
            completionTokens: readNumber(record.metadata?.['completionTokens'], 0),
            totalTokens: readNumber(record.metadata?.['totalTokens'], 0),
            ...(typeof record.metadata?.['cacheReadTokens'] === 'number'
                ? { cacheReadTokens: record.metadata['cacheReadTokens'] }
                : {}),
            ...(typeof record.metadata?.['cacheCreationTokens'] === 'number'
                ? { cacheCreationTokens: record.metadata['cacheCreationTokens'] }
                : {}),
            ...(typeof record.metadata?.['cost'] === 'number'
                ? { cost: record.metadata['cost'] }
                : {}),
        },
        ...(readString(record.metadata?.['lastUserMessage'])
            ? { lastUserMessage: readString(record.metadata?.['lastUserMessage']) }
            : {}),
        compactionCount: readNumber(record.metadata?.['compactionCount'], compactionCountFallback),
        commandCount: readNumber(record.metadata?.['commandCount'], commandCountFallback),
        fileChangeCount: readNumber(record.metadata?.['fileChangeCount'], fileChangeCountFallback),
    };
}

async function loadSessionSnapshotFirst(
    sessionStore: SessionResolveStore,
    sessionId: string,
): Promise<AgentSession | null> {
    const record = await loadRuntimeSessionSnapshotRecord(
        createRuntimeSessionResolveStoreAdapter(sessionStore),
        sessionId,
    );
    if (record) {
        return toAgentSession(record);
    }
    return null;
}

async function listSessionSummaries(
    sessionStore: SessionSummaryResolveStore,
    projectRoot?: string,
    limit?: number,
): Promise<PersistedSessionSummary[]> {
    const records = await createRuntimeSessionResolveStoreAdapter(sessionStore).listSessions({ projectRoot, limit });
    return records.map(toPersistedSessionSummary);
}

async function resolveLatestSessionId(
    sessionStore: SessionResolveStore,
    projectRoot: string,
): Promise<string | null> {
    const latestSummary = (await listSessionSummaries(sessionStore, projectRoot, 1))[0];
    return latestSummary?.id ?? null;
}

async function loadSessionSummary(
    sessionStore: SessionResolveStore,
    sessionId: string,
): Promise<PersistedSessionSummary | null> {
    if (!isRuntimeSessionResolveStore(sessionStore)) {
        return readLegacySessionSummary(sessionStore, sessionId);
    }

    const runtimeStore = createRuntimeSessionResolveStoreAdapter(sessionStore);
    const record = await loadRuntimeSessionSnapshotRecord(runtimeStore, sessionId);
    if (record) {
        return toPersistedSessionSummary(record);
    }
    return null;
}

export async function listResolvedSessionSummaries(
    sessionStore: SessionSummaryResolveStore,
    projectRoot?: string,
    limit?: number,
): Promise<PersistedSessionSummary[]> {
    return listSessionSummaries(sessionStore, projectRoot, limit);
}

export async function resolveSessionForReuse(
    sessionStore: SessionResolveStore | undefined,
    options: {
        projectRoot: string;
        sessionId?: string;
        newSession: boolean;
    },
): Promise<AgentSession | undefined> {
    if (!sessionStore || options.newSession) {
        return undefined;
    }

    if (options.sessionId) {
        const explicitSession = await loadSessionSnapshotFirst(sessionStore, options.sessionId);
        if (!explicitSession) {
            throw new Error(`未找到指定 session: ${options.sessionId}`);
        }
        return explicitSession;
    }

    const latestSessionId = await resolveLatestSessionId(sessionStore, options.projectRoot);
    if (!latestSessionId) {
        return undefined;
    }

    return await loadSessionSnapshotFirst(sessionStore, latestSessionId) ?? undefined;
}

/**
 * 通过统一 session-resolve 入口按 id 读取 session + summary。
 * 返回 null 表示 session 或 summary 任一缺失。
 */
export async function resolveSessionById(
    sessionStore: SessionResolveStore,
    sessionId: string,
): Promise<ResolvedSession | null> {
    const session = await loadSessionSnapshotFirst(sessionStore, sessionId);
    if (!session) {
        return null;
    }

    const summary = await loadSessionSummary(sessionStore, sessionId);
    if (!summary) {
        return null;
    }

    return { session, summary };
}

/**
 * 通过统一 session-resolve 入口按 id 读取 summary。
 * 返回 null 表示 session 摘要不存在。
 */
export async function resolveSessionSummaryById(
    sessionStore: SessionResolveStore,
    sessionId: string,
): Promise<PersistedSessionSummary | null> {
    return loadSessionSummary(sessionStore, sessionId);
}

/**
 * 检查指定 sessionId 是否已存在（runtime/legacy 统一入口）。
 */
export async function resolveSessionExistsById(
    sessionStore: SessionResolveStore,
    sessionId: string,
): Promise<boolean> {
    const runtimeStore = createRuntimeSessionResolveStoreAdapter(sessionStore);
    if (await loadRuntimeSessionSnapshotRecord(runtimeStore, sessionId)) {
        return true;
    }

    if (readLegacySessionSummary(sessionStore, sessionId)) {
        return true;
    }

    const listed = await runtimeStore.listSessions({ limit: 1000 });
    return listed.some((summary) => summary.id === sessionId);
}

/**
 * 解析 session：若指定 sessionId 则取该会话，否则取项目最近一次。
 * 未找到时抛出。
 */
export async function resolveSessionForExport(
    sessionStore: SessionResolveStore,
    sessionId: string | undefined,
    projectRoot: string,
): Promise<ResolvedSession> {
    const resolvedSessionId = sessionId ?? await resolveLatestSessionId(sessionStore, projectRoot) ?? undefined;
    const session = resolvedSessionId
        ? await loadSessionSnapshotFirst(sessionStore, resolvedSessionId)
        : null;

    if (!session) {
        throw new Error(sessionId
            ? `未找到指定 session: ${sessionId}`
            : `项目 ${projectRoot} 还没有可导出的 session`);
    }

    const summary = await loadSessionSummary(sessionStore, session.id);
    if (!summary) {
        throw new Error(`无法读取 session 摘要: ${session.id}`);
    }

    return { session, summary };
}

/**
 * 解析 session 用于 TUI 展示（初始加载或 resume）：返回 sessionId + title，未找到返回 null。
 */
export async function resolveSessionForTui(
    sessionStore: SessionResolveStore,
    projectRoot: string,
    sessionIdOrLatest?: string,
): Promise<ResolvedSessionForTui | null> {
    const id = sessionIdOrLatest === 'latest' || !sessionIdOrLatest
        ? await resolveLatestSessionId(sessionStore, projectRoot)
        : sessionIdOrLatest;

    if (!id) return null;

    const session = await loadSessionSnapshotFirst(sessionStore, id);
    if (!session) return null;

    const summary = await loadSessionSummary(sessionStore, id);
    return {
        sessionId: id,
        title: summary?.title,
    };
}
