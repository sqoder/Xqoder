import type { SessionRecord, SessionStore } from '@xqoder/runtime';
import type { CoreMessage } from '@xqoder/protocol';
import {
  buildRuntimeSessionSaveInput,
  cloneCoreMessage,
  cloneSessionRecord,
  toStoredRuntimeMessage,
  toPersistedSessionRecord,
  toSessionRecord,
  type RuntimeSessionAppendInput,
  type RuntimeSessionBackingStore,
  type RuntimeSessionSaveInput,
  type RuntimeSessionSnapshot,
  type RuntimeSessionStoreDefaults,
  type RuntimeSessionSummary,
  type RuntimeSessionUsage,
} from './runtime-session-mappers.js';

export type {
  RuntimeSessionAppendInput,
  RuntimeSessionBackingStore,
  RuntimeSessionSaveInput,
  RuntimeSessionSnapshot,
  RuntimeSessionStoreDefaults,
  RuntimeSessionSummary,
  RuntimeSessionUsage,
} from './runtime-session-mappers.js';

export class SQLiteRuntimeSessionStoreAdapter implements SessionStore {
  private readonly kernelStore: RuntimeSessionBackingStore;
  private readonly records = new Map<string, SessionRecord>();

  constructor(
    private readonly store: RuntimeSessionBackingStore,
    private readonly defaults: RuntimeSessionStoreDefaults = {},
  ) {
    this.kernelStore = store;
  }

  private readSnapshotFromStore(id: string): RuntimeSessionSnapshot | undefined {
    return this.store.getSessionSnapshot(id) ?? undefined;
  }

  private readRecordFromStore(id: string): SessionRecord | undefined {
    const summary = this.store.getSessionSummary(id);
    const snapshot = this.readSnapshotFromStore(id);
    if (!summary || !snapshot) {
      return undefined;
    }
    const record = toSessionRecord(summary, snapshot);
    this.records.set(id, cloneSessionRecord(record));
    return record;
  }

  list(): SessionRecord[] {
    const records = new Map<string, SessionRecord>();
    for (const summary of this.store.listSessions(undefined, 1000)) {
      const cached = this.records.get(summary.id);
      if (cached) {
        records.set(summary.id, cloneSessionRecord(cached));
        continue;
      }
      const record = this.readRecordFromStore(summary.id);
      if (record) {
        records.set(summary.id, cloneSessionRecord(record));
      }
    }
    for (const [id, record] of this.records.entries()) {
      if (!records.has(id)) {
        records.set(id, cloneSessionRecord(record));
      }
    }
    return [...records.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  get(id: string): SessionRecord | undefined {
    const cached = this.records.get(id);
    if (cached) {
      return cloneSessionRecord(cached);
    }
    return this.readRecordFromStore(id);
  }

  private deriveFallbackSummary(record: SessionRecord, saveInput: RuntimeSessionSaveInput): RuntimeSessionSummary {
    const lastUserMessage = [...record.messages]
      .reverse()
      .find((message) => message.role === 'user')
      ?.content;
    const compactions = Array.isArray(record.metadata?.['compactions']) ? record.metadata?.['compactions'] : [];
    const commandHistory = Array.isArray(record.metadata?.['commandHistory']) ? record.metadata?.['commandHistory'] : [];
    const fileChanges = Array.isArray(record.metadata?.['fileChanges']) ? record.metadata?.['fileChanges'] : [];

    return {
      id: record.id,
      projectRoot: saveInput.projectRoot,
      cwd: record.cwd,
      model: saveInput.model,
      title: record.title ?? saveInput.snapshot.title ?? 'Session',
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      maxMessages: Number(record.metadata?.['maxMessages'] ?? saveInput.snapshot.maxMessages),
      messageCount: record.messages.length,
      usage: { ...saveInput.snapshot.usage },
      ...(lastUserMessage ? { lastUserMessage } : {}),
      compactionCount: Number(record.metadata?.['compactionCount'] ?? compactions.length),
      commandCount: Number(record.metadata?.['commandCount'] ?? commandHistory.length),
      fileChangeCount: Number(record.metadata?.['fileChangeCount'] ?? fileChanges.length),
    };
  }

  upsert(record: SessionRecord): void {
    const saveInput = buildRuntimeSessionSaveInput(record, this.defaults);
    const persistedSummary = this.kernelStore.saveSessionSnapshot(saveInput);
    const summary =
      persistedSummary
      ?? this.kernelStore.getSessionSummary(record.id)
      ?? this.deriveFallbackSummary(record, saveInput);
    this.records.set(summary.id, cloneSessionRecord(toPersistedSessionRecord(summary, saveInput.snapshot, record)));
  }

  appendMessage(sessionId: string, message: CoreMessage): void {
    const existing = this.get(sessionId);
    const projectRoot = String(existing?.metadata?.['projectRoot'] ?? this.defaults.projectRoot ?? existing?.cwd ?? process.cwd());
    const model = String(existing?.metadata?.['model'] ?? this.defaults.model ?? 'unknown');
    const cwd = existing?.cwd ?? projectRoot;
    const nextRecord: SessionRecord = existing
      ? {
          ...existing,
          updatedAt: Math.max(message.createdAt, existing.updatedAt),
          messages: [...existing.messages.map(cloneCoreMessage), cloneCoreMessage(message)],
          metadata: {
            ...(existing.metadata ? { ...existing.metadata } : {}),
            projectRoot,
            model,
          },
        }
      : {
          id: sessionId,
          cwd,
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
          messages: [cloneCoreMessage(message)],
          metadata: {
            projectRoot,
            model,
          },
        };
    if (typeof this.kernelStore.appendSessionMessage === 'function') {
      const appendInput: RuntimeSessionAppendInput = {
        sessionId,
        message: toStoredRuntimeMessage(message),
        projectRoot,
        cwd,
        model,
        ...(nextRecord.title ? { title: nextRecord.title } : {}),
      };
      const saveInput = buildRuntimeSessionSaveInput(nextRecord, this.defaults);
      const persistedSummary = this.kernelStore.appendSessionMessage(appendInput);
      const summary =
        persistedSummary
        ?? this.kernelStore.getSessionSummary(sessionId)
        ?? this.deriveFallbackSummary(nextRecord, saveInput);
      this.records.set(summary.id, cloneSessionRecord(toPersistedSessionRecord(summary, saveInput.snapshot, nextRecord)));
      return;
    }

    this.upsert(nextRecord);
  }
}

export function createRuntimeSessionStoreAdapter(
  store: RuntimeSessionBackingStore,
  defaults?: RuntimeSessionStoreDefaults,
): SessionStore {
  return new SQLiteRuntimeSessionStoreAdapter(store, defaults);
}
