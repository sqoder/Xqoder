/**
 * 验证 SQLiteRuntimeSessionStoreAdapter 满足 core-runtime SessionStore 契约。
 * 使用内存 mock 的 AgentSessionStore，不依赖真实 SQLite。
 */
import { describe, expect, it } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import type { AgentSessionStore, PersistedSessionSummary, SaveSessionInput } from '@xqoder/agent';
import type { SessionRecord, SessionStore } from '@xqoder/core-runtime';
import { createRuntimeSessionStoreAdapter } from './index.js';

function createMockAgentSessionStore(): AgentSessionStore {
  const sessions = new Map<string, { session: AgentSession; summary: PersistedSessionSummary }>();

  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const baseSummary = (id: string, session: AgentSession): PersistedSessionSummary => ({
    id,
    projectRoot: '/tmp',
    cwd: '/tmp',
    model: 'test',
    title: session.toSnapshot().title ?? 'Session',
    createdAt: session.createdAt,
    updatedAt: new Date(),
    maxMessages: 100,
    messageCount: session.messageCount,
    usage,
    compactionCount: 0,
    commandCount: 0,
    fileChangeCount: 0,
  });

  return {
    getSession(sessionId: string) {
      return sessions.get(sessionId)?.session ?? null;
    },
    getSessionSummary(sessionId: string) {
      return sessions.get(sessionId)?.summary ?? null;
    },
    findLatestSession() {
      return null;
    },
    listSessions(_, limit = 100) {
      return [...sessions.values()]
        .map((e) => e.summary)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, limit);
    },
    saveSession(input: SaveSessionInput): PersistedSessionSummary {
      const id = input.session.id;
      const summary: PersistedSessionSummary = {
        ...baseSummary(id, input.session),
        projectRoot: input.projectRoot,
        cwd: input.cwd,
        model: input.model,
        title: input.title ?? input.session.toSnapshot().title ?? 'Session',
      };
      sessions.set(id, { session: input.session, summary });
      return summary;
    },
    updateSessionTitle() {
      throw new Error('not implemented in mock');
    },
    createEmptySession() {
      throw new Error('not implemented in mock');
    },
    deleteSession() {},
    close() {},
  };
}

describe('SessionStore adapter (storage-sqlite boundary)', () => {
  it('createRuntimeSessionStoreAdapter returns SessionStore with list/get/upsert/appendMessage', () => {
    const mockStore = createMockAgentSessionStore();
    const store: SessionStore = createRuntimeSessionStoreAdapter(mockStore, {
      projectRoot: '/tmp',
      model: 'test',
    });

    expect(store.list()).toEqual([]);
    expect(store.get('s1')).toBeUndefined();

    store.upsert({
      id: 's1',
      cwd: '/tmp',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'user',
          content: 'hello',
          createdAt: 1000,
        },
      ],
      metadata: { projectRoot: '/tmp', model: 'test' },
    });

    expect(store.list()).toHaveLength(1);
    const first = store.get('s1') as SessionRecord | undefined;
    expect(first).toBeDefined();
    expect(first!.messages).toHaveLength(1);

    store.appendMessage('s1', {
      id: 'm2',
      sessionId: 's1',
      role: 'assistant',
      content: 'hi',
      createdAt: 2000,
    });
    const after = store.get('s1') as SessionRecord | undefined;
    expect(after).toBeDefined();
    expect(after!.messages).toHaveLength(2);
    expect(typeof after!.updatedAt).toBe('number');
    expect(after!.updatedAt).toBeGreaterThanOrEqual(1000);
  });
});
