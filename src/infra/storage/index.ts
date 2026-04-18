import {
  AgentSession,
  SQLiteSessionStore,
  type AgentSessionSnapshot,
  type AgentSessionStore,
  type PersistedSessionSummary,
  type SaveSessionInput,
  type SaveSessionOptions,
} from '@xqoder/agent';
import type { SessionRecord, SessionStore } from '@xqoder/core-runtime';
import type { CoreMessage, MessageAttachment as ProtocolAttachment } from '@xqoder/protocol';
import type { LLMMessage, MessageAttachment as AgentAttachment } from '@xqoder/shared';

function toProtocolAttachment(attachment: AgentAttachment): ProtocolAttachment {
  return {
    kind: attachment.type,
    mimeType: attachment.mimeType,
    data: attachment.data,
    fileName: attachment.fileName,
    filePath: attachment.filePath,
  };
}

function toAgentAttachment(attachment: ProtocolAttachment): AgentAttachment {
  return {
    type: attachment.kind === 'image' ? 'image' : 'file',
    mimeType: attachment.mimeType ?? (attachment.kind === 'image' ? 'image/png' : 'application/octet-stream'),
    data: attachment.data,
    fileName: attachment.fileName,
    filePath: attachment.filePath,
  };
}

function toCoreMessage(message: LLMMessage, sessionId: string, createdAt: number, index: number): CoreMessage {
  return {
    id: `${sessionId}:stored:${index}`,
    sessionId,
    role: message.role,
    content: message.content,
    createdAt,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments.map(toProtocolAttachment) }
      : {}),
  };
}

function toAgentMessage(message: CoreMessage): LLMMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments.map(toAgentAttachment) }
      : {}),
  };
}

function toSessionRecord(summary: PersistedSessionSummary, session: AgentSession): SessionRecord {
  const snapshot = session.toSnapshot();
  return {
    id: summary.id,
    cwd: summary.cwd,
    title: summary.title,
    createdAt: summary.createdAt.getTime(),
    updatedAt: summary.updatedAt.getTime(),
    messages: snapshot.messages.map((message, index) =>
      toCoreMessage(message, summary.id, summary.createdAt.getTime(), index),
    ),
    metadata: {
      projectRoot: summary.projectRoot,
      model: summary.model,
      messageCount: summary.messageCount,
      commandCount: summary.commandCount,
      fileChangeCount: summary.fileChangeCount,
      compactionCount: summary.compactionCount,
      promptTokens: summary.usage.promptTokens,
      completionTokens: summary.usage.completionTokens,
      totalTokens: summary.usage.totalTokens,
    },
  };
}

function toAgentSession(record: SessionRecord): AgentSession {
  const snapshot: AgentSessionSnapshot = {
    id: record.id,
    title: record.title,
    createdAt: new Date(record.createdAt),
    maxMessages: Number(record.metadata?.['maxMessages'] ?? 100),
    messages: record.messages.map(toAgentMessage),
    usage: {
      promptTokens: Number(record.metadata?.['promptTokens'] ?? 0),
      completionTokens: Number(record.metadata?.['completionTokens'] ?? 0),
      totalTokens: Number(record.metadata?.['totalTokens'] ?? 0),
    },
    metadata: {
      compactions: [],
      toolHistory: [],
      commandHistory: [],
      fileChanges: [],
    },
  };

  return AgentSession.fromSnapshot(snapshot);
}

export class SQLiteRuntimeSessionStoreAdapter implements SessionStore {
  constructor(
    private readonly store: AgentSessionStore,
    private readonly defaults: { projectRoot?: string; model?: string } = {},
  ) {}

  list(): SessionRecord[] {
    return this.store.listSessions(undefined, 1000)
      .map((summary) => {
        const session = this.store.getSession(summary.id);
        return session ? toSessionRecord(summary, session) : undefined;
      })
      .filter((record): record is SessionRecord => Boolean(record));
  }

  get(id: string): SessionRecord | undefined {
    const summary = this.store.getSessionSummary(id);
    const session = this.store.getSession(id);
    if (!summary || !session) {
      return undefined;
    }

    return toSessionRecord(summary, session);
  }

  upsert(record: SessionRecord): void {
    const session = toAgentSession(record);
    this.store.saveSession({
      session,
      projectRoot: String(record.metadata?.['projectRoot'] ?? this.defaults.projectRoot ?? record.cwd),
      cwd: record.cwd,
      model: String(record.metadata?.['model'] ?? this.defaults.model ?? 'unknown'),
      title: record.title,
    });
  }

  appendMessage(sessionId: string, message: CoreMessage): void {
    const existing = this.get(sessionId);
    if (existing) {
      this.upsert({
        ...existing,
        updatedAt: message.createdAt,
        messages: [...existing.messages, message],
      });
      return;
    }

    this.upsert({
      id: sessionId,
      cwd: this.defaults.projectRoot ?? process.cwd(),
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      messages: [message],
      metadata: {
        projectRoot: this.defaults.projectRoot ?? process.cwd(),
        model: this.defaults.model ?? 'unknown',
      },
    });
  }
}

export function createRuntimeSessionStoreAdapter(
  store: AgentSessionStore,
  defaults?: { projectRoot?: string; model?: string },
): SessionStore {
  return new SQLiteRuntimeSessionStoreAdapter(store, defaults);
}

export {
  AgentSession,
  SQLiteSessionStore,
  type AgentSessionStore,
  type PersistedSessionSummary,
  type SaveSessionInput,
  type SaveSessionOptions,
};
