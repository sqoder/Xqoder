/**
 * Session 存储抽象：仅定义 Runtime 所需的最小契约。
 * 具体实现（如 SQLite、远程同步）由 @xqoder/storage-sqlite 或其它包提供；
 * Core 不依赖任何具体存储实现。
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
