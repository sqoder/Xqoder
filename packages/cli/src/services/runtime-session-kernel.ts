import {
    AgentSession,
    SQLiteSessionStore,
    syncProjectMemoryFromSession,
    type AppendSessionMessageInput,
    type ClosableSessionStore,
    type PersistedSessionSummary,
    type RuntimeAgentSessionStore,
    type SaveSessionInput,
} from '@xqoder/agent';
import type { CoreMessage, JsonValue, MessageAttachment as ProtocolMessageAttachment } from '@xqoder/protocol';
import { getMessageAttachmentKind, getXQoderPaths, type LLMMessage, type MessageAttachment } from '@xqoder/shared';
import { InMemorySessionStore, RuntimeKernel, type SessionRecord, type SessionStore } from '@xqoder/runtime';
import { createRuntimeSessionStoreAdapter } from '@xqoder/storage-sqlite';
import {
    toAgentSession,
    toPersistedSessionSummary,
    type SnapshotSessionResolveStore,
} from './session-resolve.js';
import { createRuntimeSessionBackingStore } from './runtime-session-backing-store.js';

export type RuntimeSessionKernelStore = {
    getSessionSnapshot(sessionId: string): import('@xqoder/agent').AgentSessionSnapshot | null;
    getSessionSummary(sessionId: string): PersistedSessionSummary | null;
    listSessions(projectRoot?: string, limit?: number): PersistedSessionSummary[];
    saveSessionSnapshot(input: SaveSessionInput): PersistedSessionSummary;
    appendSessionMessage(input: AppendSessionMessageInput): PersistedSessionSummary;
};

/**
 * @deprecated 兼容旧的 snapshot 风格注入；新代码请优先注入 RuntimeSessionKernelHandle
 * 或完整的 RuntimeSessionKernelStore。
 */
export type SnapshotCompatibleRuntimeSessionStore = SnapshotSessionResolveStore &
    Partial<Pick<RuntimeAgentSessionStore, 'appendSessionMessage'>> & {
        saveSessionSnapshot: (input: SaveSessionInput) => PersistedSessionSummary;
    };

export type RuntimeSessionKernelStoreLike =
    | RuntimeSessionKernelStore
    | SnapshotCompatibleRuntimeSessionStore;

type SnapshotWritableSessionStore = SnapshotCompatibleRuntimeSessionStore & {
    saveSessionSnapshot: (input: SaveSessionInput) => PersistedSessionSummary;
};

export interface SessionKernelDefaults {
    projectRoot: string;
    model: string;
}

export interface RuntimeSessionKernelFacade {
    listSessions(options?: { projectRoot?: string; limit?: number }): Promise<SessionRecord[]> | SessionRecord[];
    loadSessionSnapshot(sessionId: string): Promise<SessionRecord | undefined> | SessionRecord | undefined;
    saveSessionSnapshot(record: SessionRecord): Promise<SessionRecord> | SessionRecord;
    commitSessionSnapshot(record: SessionRecord): Promise<SessionRecord> | SessionRecord;
}

export interface RuntimeSessionKernelHandle<
    TStore extends RuntimeSessionKernelStore = RuntimeSessionKernelStore,
> {
    kernel: RuntimeSessionKernelFacade;
    store: TStore;
    close(): void;
}

export function isRuntimeSessionKernelHandle(
    value: unknown,
): value is RuntimeSessionKernelHandle {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<RuntimeSessionKernelHandle>;
    return typeof candidate.close === 'function'
        && !!candidate.kernel
        && typeof candidate.kernel?.loadSessionSnapshot === 'function'
        && !!candidate.store
        && typeof candidate.store?.getSessionSnapshot === 'function'
        && typeof candidate.store?.getSessionSummary === 'function'
        && typeof candidate.store?.listSessions === 'function'
        && typeof candidate.store?.saveSessionSnapshot === 'function'
        && typeof candidate.store?.appendSessionMessage === 'function';
}

function isRuntimeCompatibleSessionStore(
    store: RuntimeSessionKernelStoreLike,
): store is RuntimeSessionKernelStore {
    return typeof store.getSessionSnapshot === 'function'
        && typeof store.getSessionSummary === 'function'
        && typeof store.listSessions === 'function'
        && typeof store.saveSessionSnapshot === 'function'
        && typeof store.appendSessionMessage === 'function';
}

function cloneSession(session: AgentSession): AgentSession {
    return AgentSession.fromSnapshot(session.toSnapshot());
}

function findLastUserMessage(messages: LLMMessage[]): string | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role === 'user') {
            return messages[index].content;
        }
    }
    return undefined;
}

function toProtocolAttachment(attachment: MessageAttachment): ProtocolMessageAttachment {
    const kind = getMessageAttachmentKind(attachment);
    return {
        kind,
        mimeType: attachment.mimeType,
        data: attachment.data,
        fileName: attachment.fileName,
        filePath: attachment.filePath,
        ...(attachment.url ? { url: attachment.url } : {}),
    };
}

function toCoreMessage(message: LLMMessage, sessionId: string, index: number, createdAt = Date.now()): CoreMessage {
    return {
        id: `${sessionId}:history:${index}`,
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
            ? { attachments: message.attachments.map((attachment) => toProtocolAttachment(attachment as MessageAttachment)) }
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

function cloneStoredMessage(message: LLMMessage): LLMMessage {
    return {
        role: message.role,
        content: message.content,
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message.thinking ? { thinking: message.thinking } : {}),
        ...(message.toolCalls && message.toolCalls.length > 0
            ? { toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall })) }
            : {}),
        ...(message.attachments && message.attachments.length > 0
            ? {
                attachments: message.attachments.map((attachment) => ({
                    ...attachment,
                    kind: getMessageAttachmentKind(attachment),
                    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
                    ...(attachment.url ? { url: attachment.url } : {}),
                    ...(attachment.type ? { type: attachment.type } : {}),
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
        ) as Record<string, JsonValue>;
    }
    return null;
}

function toSessionRecordFromSaveInput(input: SaveSessionInput): SessionRecord {
    const snapshot = input.session.toSnapshot();
    const lastUserMessage = findLastUserMessage(snapshot.messages);
    return {
        id: snapshot.id,
        cwd: input.cwd,
        title: input.title?.trim() || snapshot.title?.trim() || 'Session',
        createdAt: snapshot.createdAt.getTime(),
        updatedAt: Date.now(),
        messages: snapshot.messages.map((message, index) => toCoreMessage(message, snapshot.id, index)),
        metadata: {
            projectRoot: input.projectRoot,
            model: input.model,
            maxMessages: snapshot.maxMessages,
            messageCount: snapshot.messages.length,
            promptTokens: snapshot.usage.promptTokens,
            completionTokens: snapshot.usage.completionTokens,
            totalTokens: snapshot.usage.totalTokens,
            ...(snapshot.usage.cacheReadTokens !== undefined ? { cacheReadTokens: snapshot.usage.cacheReadTokens } : {}),
            ...(snapshot.usage.cacheCreationTokens !== undefined ? { cacheCreationTokens: snapshot.usage.cacheCreationTokens } : {}),
            ...(snapshot.usage.cost !== undefined ? { cost: snapshot.usage.cost } : {}),
            ...(lastUserMessage ? { lastUserMessage } : {}),
            compactionCount: snapshot.metadata.compactions.length,
            commandCount: snapshot.metadata.commandHistory.length,
            fileChangeCount: snapshot.metadata.fileChanges.length,
            ...(snapshot.metadata.fixHistory ? { fixHistory: toRuntimeJsonValue(snapshot.metadata.fixHistory) } : {}),
        },
    };
}

function deriveSummaryFromSaveInput(input: SaveSessionInput): PersistedSessionSummary {
    return toPersistedSessionSummary(toSessionRecordFromSaveInput(input));
}

function cacheRuntimeSessionMirror(
    sessions: Map<string, AgentSession>,
    summaries: Map<string, PersistedSessionSummary>,
    session: AgentSession,
    summary: PersistedSessionSummary,
): PersistedSessionSummary {
    sessions.set(summary.id, cloneSession(session));
    summaries.set(summary.id, summary);
    return summary;
}

function persistRuntimeSessionSnapshot(
    store: SnapshotWritableSessionStore,
    sessions: Map<string, AgentSession>,
    summaries: Map<string, PersistedSessionSummary>,
    input: SaveSessionInput,
): PersistedSessionSummary {
    const summary = store.saveSessionSnapshot(input);
    syncProjectMemoryFromSession(input.projectRoot, input.session);
    return cacheRuntimeSessionMirror(sessions, summaries, input.session, summary);
}

function loadClonedSessionFromStore(
    store: RuntimeSessionKernelStoreLike,
    cache: Map<string, AgentSession>,
    sessionId: string,
): AgentSession | null {
    const cached = cache.get(sessionId);
    if (cached) {
        return cloneSession(cached);
    }

    const snapshot = store.getSessionSnapshot?.(sessionId);
    if (snapshot) {
        const cloned = AgentSession.fromSnapshot(snapshot);
        cache.set(sessionId, cloned);
        return cloneSession(cloned);
    }
    return null;
}

function buildAppendedSession(
    store: RuntimeSessionKernelStoreLike,
    sessions: Map<string, AgentSession>,
    input: AppendSessionMessageInput,
): AgentSession {
    const existing = loadClonedSessionFromStore(store, sessions, input.sessionId);
    const next = existing
        ? cloneSession(existing)
        : new AgentSession({
            id: input.sessionId,
            ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        });
    next.addMessage(cloneStoredMessage(input.message));
    if (input.title?.trim()) {
        next.setTitle(input.title.trim());
    }
    return next;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof (value as Promise<T> | undefined)?.then === 'function';
}

function unwrapSync<T>(value: T | Promise<T>, label: string): T {
    if (isPromiseLike(value)) {
        throw new Error(`${label} requires a synchronous runtime session store`);
    }
    return value;
}

function toRuntimeSessionKernelFacade(kernel: RuntimeKernel): RuntimeSessionKernelFacade {
    const snapshotCommitter = (kernel as {
        commitSessionSnapshot?: (record: SessionRecord) => Promise<SessionRecord> | SessionRecord;
    }).commitSessionSnapshot;
    return {
        listSessions(options) {
            return kernel.listSessions(options);
        },
        loadSessionSnapshot(sessionId) {
            return kernel.loadSessionSnapshot(sessionId);
        },
        saveSessionSnapshot(record) {
            return kernel.saveSessionSnapshot(record);
        },
        commitSessionSnapshot(record) {
            return typeof snapshotCommitter === 'function'
                ? snapshotCommitter.call(kernel, record)
                : kernel.saveSessionSnapshot(record);
        },
    };
}

export function resolveRuntimeSessionStore(
    store: RuntimeSessionKernelStoreLike,
    defaults: { projectRoot: string; cwd: string; model: string },
    initialSessions: AgentSession[] = [],
): RuntimeSessionKernelStore {
    if (isRuntimeCompatibleSessionStore(store)) {
        return store;
    }

    const summaries = new Map<string, PersistedSessionSummary>();
    const sessions = new Map<string, AgentSession>();

    for (const session of initialSessions) {
        const cloned = cloneSession(session);
        sessions.set(cloned.id, cloned);
        const seededSummary = deriveSummaryFromSaveInput({
            session: cloned,
            projectRoot: defaults.projectRoot,
            cwd: defaults.cwd,
            model: defaults.model,
            title: cloned.getTitle(),
        });
        summaries.set(seededSummary.id, seededSummary);
    }

    const saveSessionSnapshot = (input: SaveSessionInput): PersistedSessionSummary =>
        persistRuntimeSessionSnapshot(store, sessions, summaries, input);

    const readSummaryFromCachedSession = (sessionId: string): PersistedSessionSummary | null => {
        const cachedSession = loadClonedSessionFromStore(store, sessions, sessionId);
        if (!cachedSession) {
            return null;
        }

        return deriveSummaryFromSaveInput({
            session: cachedSession,
            projectRoot: defaults.projectRoot,
            cwd: defaults.cwd,
            model: defaults.model,
            title: cachedSession.getTitle(),
        });
    };

    return {
        getSessionSnapshot(sessionId: string) {
            const cached = sessions.get(sessionId);
            if (cached) {
                return cached.toSnapshot();
            }
            const snapshot = store.getSessionSnapshot?.(sessionId);
            if (snapshot) {
                sessions.set(sessionId, AgentSession.fromSnapshot(snapshot));
                return snapshot;
            }
            return null;
        },
        getSessionSummary(sessionId: string) {
            const cached = summaries.get(sessionId);
            if (cached) {
                return cached;
            }
            const summary = readSummaryFromCachedSession(sessionId);
            if (summary) {
                summaries.set(sessionId, summary);
                return summary;
            }
            return null;
        },
        listSessions(projectRoot?: string, limit = 20) {
            for (const sessionId of sessions.keys()) {
                if (!summaries.has(sessionId)) {
                    const summary = readSummaryFromCachedSession(sessionId);
                    if (summary) {
                        summaries.set(summary.id, summary);
                    }
                }
            }

            const values = [...summaries.values()]
                .filter((entry) => (projectRoot ? entry.projectRoot === projectRoot : true))
                .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
            return values.slice(0, Math.max(1, limit));
        },
        saveSessionSnapshot,
        appendSessionMessage(input: AppendSessionMessageInput) {
            const next = buildAppendedSession(store, sessions, input);

            if (typeof store.appendSessionMessage === 'function') {
                const summary = store.appendSessionMessage(input);
                return cacheRuntimeSessionMirror(sessions, summaries, next, summary);
            }

            return saveSessionSnapshot({
                session: next,
                projectRoot: input.projectRoot || defaults.projectRoot,
                cwd: input.cwd || defaults.cwd,
                model: input.model || defaults.model,
                title: input.title,
                options: input.options,
            });
        },
    };
}

function createSessionStoreBackedRuntimeSessionStore(
    store: SessionStore,
    defaults: SessionKernelDefaults,
): RuntimeSessionKernelStore {
    const loadRecord = (sessionId: string): SessionRecord | undefined =>
        unwrapSync(store.get(sessionId), 'Session-store-backed runtime session store');
    const listRecords = (): SessionRecord[] =>
        unwrapSync(store.list(), 'Session-store-backed runtime session store');
    const persistRecord = (record: SessionRecord): SessionRecord => {
        unwrapSync(store.upsert(record), 'Session-store-backed runtime session store');
        return loadRecord(record.id) ?? record;
    };

    return {
        getSessionSnapshot(sessionId: string) {
            const record = loadRecord(sessionId);
            return record ? toAgentSession(record).toSnapshot() : null;
        },
        getSessionSummary(sessionId: string) {
            const record = loadRecord(sessionId);
            return record ? toPersistedSessionSummary(record) : null;
        },
        listSessions(projectRoot?: string, limit?: number) {
            const records = listRecords()
                .filter((record) => (projectRoot
                    ? String(record.metadata?.['projectRoot'] ?? record.cwd) === projectRoot
                    : true))
                .slice(0, Math.max(1, limit ?? 20));
            return records.map(toPersistedSessionSummary);
        },
        saveSessionSnapshot(input: SaveSessionInput) {
            const summary = toPersistedSessionSummary(persistRecord(toSessionRecordFromSaveInput(input)));
            syncProjectMemoryFromSession(input.projectRoot, input.session);
            return summary;
        },
        appendSessionMessage(input: AppendSessionMessageInput) {
            const existing = loadRecord(input.sessionId);
            const next = existing
                ? toAgentSession(existing)
                : new AgentSession({
                    id: input.sessionId,
                    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
                });
            next.addMessage(cloneStoredMessage(input.message));
            if (input.title?.trim()) {
                next.setTitle(input.title.trim());
            }
            return this.saveSessionSnapshot({
                session: next,
                projectRoot: input.projectRoot || String(existing?.metadata?.['projectRoot'] ?? defaults.projectRoot),
                cwd: input.cwd || existing?.cwd || defaults.projectRoot,
                model: input.model || String(existing?.metadata?.['model'] ?? defaults.model),
                title: input.title,
                options: input.options,
            });
        },
    };
}

export function createRuntimeSessionKernel(
    store: RuntimeSessionKernelStoreLike,
    defaults: SessionKernelDefaults,
    initialSessions: AgentSession[] = [],
): RuntimeKernel {
    const runtimeStore = resolveRuntimeSessionStore(store, {
        projectRoot: defaults.projectRoot,
        cwd: defaults.projectRoot,
        model: defaults.model,
    }, initialSessions);

    return new RuntimeKernel({
        sessionStore: createRuntimeSessionStoreAdapter(createRuntimeSessionBackingStore(runtimeStore), defaults),
        permissionPolicy: {
            evaluate: async () => 'allow' as const,
        },
    });
}

export function createRuntimeSessionKernelHandle<
    TStore extends RuntimeSessionKernelStore,
>(
    store: TStore,
    defaults: SessionKernelDefaults,
    options: {
        close?: () => void;
        initialSessions?: AgentSession[];
    } = {},
): RuntimeSessionKernelHandle<TStore> {
    const kernel = createRuntimeSessionKernel(store, defaults, options.initialSessions);
    return {
        kernel: toRuntimeSessionKernelFacade(kernel),
        store,
        close: options.close ?? (() => {}),
    };
}

export function openDefaultRuntimeSessionKernel(
    defaults: SessionKernelDefaults,
): RuntimeSessionKernelHandle<SQLiteSessionStore> {
    const store = new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
    return createRuntimeSessionKernelHandle(store, defaults, {
        close: () => {
            store.close();
        },
    });
}

export function openInMemoryRuntimeSessionKernel(
    defaults: SessionKernelDefaults,
): RuntimeSessionKernelHandle {
    const sessionStore = new InMemorySessionStore();
    const kernel = new RuntimeKernel({
        sessionStore,
        permissionPolicy: {
            evaluate: async () => 'allow' as const,
        },
    });

    return {
        kernel: toRuntimeSessionKernelFacade(kernel),
        store: createSessionStoreBackedRuntimeSessionStore(sessionStore, defaults),
        close: () => {},
    };
}
