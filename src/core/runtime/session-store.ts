/**
 * Session storage abstraction: defines the minimum contract required by the Runtime.
 * Concrete implementations (e.g., SQLite, remote sync) are provided by @xqoder/storage-sqlite or other packages.
 * Core does not depend on any specific storage implementation.
 */
import type { CoreMessage, JsonRecord } from '@xqoder/protocol';

export interface SessionRecord {
  id: string;
  cwd: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  messages: CoreMessage[];
  metadata?: JsonRecord;
}

export interface SessionStore {
  list(): SessionRecord[] | Promise<SessionRecord[]>;
  get(id: string): SessionRecord | undefined | Promise<SessionRecord | undefined>;
  upsert(record: SessionRecord): void | Promise<void>;
  appendMessage(sessionId: string, message: CoreMessage): void | Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  list(): SessionRecord[] {
    return [...this.sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  get(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }

  upsert(record: SessionRecord): void {
    this.sessions.set(record.id, {
      ...record,
      messages: [...record.messages],
    });
  }

  appendMessage(sessionId: string, message: CoreMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sessions.set(sessionId, {
        id: sessionId,
        cwd: '',
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
        messages: [message],
      });
      return;
    }

    session.messages.push(message);
    session.updatedAt = message.createdAt;
  }
}
