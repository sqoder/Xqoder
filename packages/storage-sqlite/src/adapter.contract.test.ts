/**
 * 验证 SQLiteRuntimeSessionStoreAdapter 满足 core-runtime SessionStore 契约。
 * 使用内存 mock 的 runtime session store，不依赖真实 SQLite。
 */
import { describe, expect, it } from 'vitest';
import { AgentSession } from '@xqoder/agent';
import type {
  AgentSessionSnapshot,
  PersistedSessionSummary,
  RuntimeAgentSessionStore,
  SaveSessionInput,
} from '@xqoder/agent';
import type { SessionRecord, SessionStore } from '@xqoder/runtime';
import {
  createRuntimeSessionStoreAdapter,
  type RuntimeSessionBackingStore,
  type RuntimeSessionSnapshot,
  type RuntimeSessionSummary,
} from './index.js';

function createMockRuntimeSessionStore(): RuntimeAgentSessionStore {
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

  const store: RuntimeAgentSessionStore = {
    getSessionSnapshot(sessionId: string) {
      return sessions.get(sessionId)?.session.toSnapshot() ?? null;
    },
    getSessionSummary(sessionId: string) {
      return sessions.get(sessionId)?.summary ?? null;
    },
    listSessions(_projectRoot, limit = 100) {
      return [...sessions.values()]
        .map((e) => e.summary)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, limit);
    },
    saveSessionSnapshot(input: SaveSessionInput): PersistedSessionSummary {
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
    appendSessionMessage(input: {
      sessionId: string;
      message: {
        role: 'system' | 'user' | 'assistant' | 'tool';
        content: string;
        toolCallId?: string;
      };
      projectRoot: string;
      cwd: string;
      model: string;
      title?: string;
    }) {
      const existing = sessions.get(input.sessionId)?.session;
      const next = existing
        ? AgentSession.fromSnapshot(existing.toSnapshot())
        : new AgentSession({ id: input.sessionId });
      next.addMessage(input.message);
      if (input.title) {
        next.setTitle(input.title);
      }
      const summary: PersistedSessionSummary = {
        ...baseSummary(input.sessionId, next),
        projectRoot: input.projectRoot,
        cwd: input.cwd,
        model: input.model,
        title: input.title ?? next.toSnapshot().title ?? 'Session',
      };
      sessions.set(input.sessionId, { session: next, summary });
      return summary;
    },
  };

  return store;
}

function createRuntimeSessionBackingStore(store: RuntimeAgentSessionStore): RuntimeSessionBackingStore {
  return {
    getSessionSnapshot(sessionId) {
      return store.getSessionSnapshot(sessionId) as RuntimeSessionSnapshot | null;
    },
    getSessionSummary(sessionId) {
      return store.getSessionSummary(sessionId) as RuntimeSessionSummary | null;
    },
    listSessions(projectRoot, limit) {
      return store.listSessions(projectRoot, limit) as RuntimeSessionSummary[];
    },
    saveSessionSnapshot({ snapshot, ...context }) {
      return store.saveSessionSnapshot({
        ...context,
        session: AgentSession.fromSnapshot(snapshot as unknown as AgentSessionSnapshot),
      }) as RuntimeSessionSummary;
    },
  };
}

describe('SessionStore adapter (storage-sqlite boundary)', () => {
  it('createRuntimeSessionStoreAdapter returns SessionStore with list/get/upsert/appendMessage', () => {
    const mockStore = createMockRuntimeSessionStore();
    const store: SessionStore = createRuntimeSessionStoreAdapter(createRuntimeSessionBackingStore(mockStore), {
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
          attachments: [
            {
              kind: 'image',
              mimeType: 'image/png',
              data: 'Zm9v',
              fileName: 'diagram.png',
              filePath: '/tmp/diagram.png',
            },
          ],
        },
      ],
      metadata: { projectRoot: '/tmp', model: 'test' },
    });

    expect(store.list()).toHaveLength(1);
    const first = store.get('s1') as SessionRecord | undefined;
    expect(first).toBeDefined();
    expect(first!.messages).toHaveLength(1);
    expect(first!.messages[0]?.attachments).toEqual([
      {
        kind: 'image',
        mimeType: 'image/png',
        data: 'Zm9v',
        fileName: 'diagram.png',
        filePath: '/tmp/diagram.png',
      },
    ]);

    store.appendMessage('s1', {
      id: 'm2',
      sessionId: 's1',
      role: 'assistant',
      content: 'hi',
      createdAt: 2000,
      attachments: [
        {
          kind: 'file',
          mimeType: 'text/plain',
          fileName: 'notes.txt',
          filePath: '/tmp/notes.txt',
        },
      ],
    });
    const after = store.get('s1') as SessionRecord | undefined;
    expect(after).toBeDefined();
    expect(after!.messages).toHaveLength(2);
    expect(after!.messages[1]?.attachments).toEqual([
      {
        kind: 'file',
        mimeType: 'text/plain',
        fileName: 'notes.txt',
        filePath: '/tmp/notes.txt',
      },
    ]);
    expect(typeof after!.updatedAt).toBe('number');
    expect(after!.updatedAt).toBeGreaterThanOrEqual(1000);
  });

  it('round-trips thinking, toolCalls, parts, and attachment metadata through runtime upsert', async () => {
    const mockStore = createMockRuntimeSessionStore();
    const store = createRuntimeSessionStoreAdapter(createRuntimeSessionBackingStore(mockStore), {
      projectRoot: '/tmp',
      model: 'test',
    });

    store.upsert({
      id: 's-full',
      cwd: '/tmp',
      title: 'Full Fidelity Session',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        {
          id: 'm1',
          sessionId: 's-full',
          role: 'assistant',
          content: 'reply',
          createdAt: 1000,
          toolCallId: 'tool-1',
          thinking: 'pondering',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'read_file',
              arguments: '{"path":"/tmp/demo.ts"}',
            },
          ],
          attachments: [
            {
              kind: 'file',
              mimeType: 'text/plain',
              data: 'Y29udGVudA==',
              fileName: 'notes.txt',
              filePath: '/tmp/notes.txt',
              text: 'inline note',
              url: 'file:///tmp/notes.txt',
              metadata: {
                origin: 'test',
              },
            },
          ],
          parts: [
            { type: 'text', text: 'reply' },
            { type: 'reasoning', text: 'pondering' },
            {
              type: 'tool_call',
              toolCall: {
                id: 'tool-1',
                name: 'read_file',
                arguments: '{"path":"/tmp/demo.ts"}',
              },
            },
            { type: 'tool_result', toolCallId: 'tool-1', output: 'ok', success: true },
            { type: 'finish', reason: 'stop' },
          ],
        },
      ],
      metadata: {
        projectRoot: '/tmp',
        model: 'test',
      },
    });

    const stored = store.get('s-full');
    const record = stored instanceof Promise ? await stored : stored;
    expect(record).toBeDefined();
    expect(record?.messages[0]).toMatchObject({
      role: 'assistant',
      content: 'reply',
      toolCallId: 'tool-1',
      thinking: 'pondering',
      toolCalls: [
        {
          id: 'tool-1',
          name: 'read_file',
          arguments: '{"path":"/tmp/demo.ts"}',
        },
      ],
      attachments: [
        expect.objectContaining({
          kind: 'file',
          mimeType: 'text/plain',
          data: 'Y29udGVudA==',
          fileName: 'notes.txt',
          filePath: '/tmp/notes.txt',
          text: 'inline note',
          url: 'file:///tmp/notes.txt',
          metadata: {
            origin: 'test',
          },
        }),
      ],
      parts: [
        { type: 'text', text: 'reply' },
        { type: 'reasoning', text: 'pondering' },
        {
          type: 'tool_call',
          toolCall: {
            id: 'tool-1',
            name: 'read_file',
            arguments: '{"path":"/tmp/demo.ts"}',
          },
        },
        { type: 'tool_result', toolCallId: 'tool-1', output: 'ok', success: true },
        { type: 'finish', reason: 'stop' },
      ],
    });
  });

  it('keeps a runtime-local session mirror when backing getSession lags behind appends', async () => {
    const staleSession = new AgentSession({ id: 'lagged-session' });
    let latestSummary: PersistedSessionSummary | null = null;

    const laggedStore: RuntimeAgentSessionStore = {
      getSessionSnapshot() {
        return staleSession.toSnapshot();
      },
      getSessionSummary() {
        return latestSummary;
      },
      listSessions() {
        return latestSummary ? [latestSummary] : [];
      },
      saveSessionSnapshot(input: SaveSessionInput): PersistedSessionSummary {
        latestSummary = {
          id: input.session.id,
          projectRoot: input.projectRoot,
          cwd: input.cwd,
          model: input.model,
          title: input.title ?? input.session.toSnapshot().title ?? 'Session',
          createdAt: input.session.createdAt,
          updatedAt: new Date('2026-03-20T00:00:00.000Z'),
          maxMessages: 100,
          messageCount: input.session.messageCount,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          compactionCount: 0,
          commandCount: 0,
          fileChangeCount: 0,
        };
        return latestSummary;
      },
      appendSessionMessage(input: {
        sessionId: string;
        message: {
          role: 'system' | 'user' | 'assistant' | 'tool';
          content: string;
          toolCallId?: string;
        };
        projectRoot: string;
        cwd: string;
        model: string;
        title?: string;
      }) {
        latestSummary = {
          id: input.sessionId,
          projectRoot: input.projectRoot,
          cwd: input.cwd,
          model: input.model,
          title: input.title ?? 'Session',
          createdAt: new Date('2026-03-20T00:00:00.000Z'),
          updatedAt: new Date('2026-03-20T00:00:00.000Z'),
          maxMessages: 100,
          messageCount: (latestSummary?.messageCount ?? 0) + 1,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          compactionCount: 0,
          commandCount: 0,
          fileChangeCount: 0,
        };
        return latestSummary;
      },
    };

    const store = createRuntimeSessionStoreAdapter(createRuntimeSessionBackingStore(laggedStore), {
      projectRoot: '/tmp',
      model: 'test',
    });

    store.appendMessage('lagged-session', {
      id: 'm1',
      sessionId: 'lagged-session',
      role: 'user',
      content: 'first',
      createdAt: 1000,
    });
    store.appendMessage('lagged-session', {
      id: 'm2',
      sessionId: 'lagged-session',
      role: 'assistant',
      content: 'second',
      createdAt: 2000,
    });

    const loaded = store.get('lagged-session');
    const record = loaded instanceof Promise ? await loaded : loaded;
    expect(record).toBeDefined();
    expect(record!.messages.map((message: SessionRecord['messages'][number]) => message.content)).toEqual(['first', 'second']);
    expect(record!.updatedAt).toBe(latestSummary!.updatedAt.getTime());
  });

  it('prefers appendSessionMessage when the runtime backing store exposes it', async () => {
    let session = new AgentSession({ id: 'append-unified' });
    let summary: PersistedSessionSummary = {
      id: session.id,
      projectRoot: '/tmp',
      cwd: '/tmp',
      model: 'test',
      title: 'Append Unified',
      createdAt: session.createdAt,
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
      maxMessages: 100,
      messageCount: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      compactionCount: 0,
      commandCount: 0,
      fileChangeCount: 0,
    };
    let saveCalls = 0;
    let appendCalls = 0;

    const backingStore: RuntimeSessionBackingStore = {
      listSessions() {
        return [summary];
      },
      getSessionSummary(sessionId: string) {
        return sessionId === session.id ? summary : null;
      },
      getSessionSnapshot(sessionId: string) {
        return sessionId === session.id ? session.toSnapshot() as unknown as RuntimeSessionSnapshot : null;
      },
      saveSessionSnapshot(input) {
        saveCalls += 1;
        const snapshot = input.snapshot as unknown as AgentSessionSnapshot;
        session = AgentSession.fromSnapshot(snapshot);
        summary = {
          ...summary,
          id: input.snapshot.id,
          projectRoot: input.projectRoot,
          cwd: input.cwd,
          model: input.model,
          title: input.snapshot.title ?? 'Append Unified',
          updatedAt: new Date('2026-03-20T00:00:01.000Z'),
          messageCount: input.snapshot.messages.length,
        };
        return summary;
      },
      appendSessionMessage(input) {
        appendCalls += 1;
        session.addMessage(input.message as never);
        summary = {
          ...summary,
          id: input.sessionId,
          projectRoot: input.projectRoot,
          cwd: input.cwd,
          model: input.model,
          title: input.title ?? summary.title,
          updatedAt: new Date('2026-03-20T00:00:01.000Z'),
          messageCount: session.messageCount,
        };
        return summary;
      },
    };

    const store = createRuntimeSessionStoreAdapter(backingStore, {
      projectRoot: '/tmp',
      model: 'test',
    });

    store.appendMessage('append-unified', {
      id: 'm1',
      sessionId: 'append-unified',
      role: 'assistant',
      content: 'hello after unify',
      createdAt: 1000,
    });

    const loaded = store.get('append-unified');
    const record = loaded instanceof Promise ? await loaded : loaded;
    expect(saveCalls).toBe(0);
    expect(appendCalls).toBe(1);
    expect(record?.messages.map((message) => message.content)).toEqual(['hello after unify']);
    expect(record?.updatedAt).toBe(summary.updatedAt.getTime());
  });

  it('accepts a snapshot-only runtime backing store without getSession', () => {
    const session = new AgentSession({ id: 'snapshot-only' });
    session.addMessage({ role: 'user', content: 'hello from snapshot' });

    let summary: PersistedSessionSummary = {
      id: session.id,
      projectRoot: '/tmp',
      cwd: '/tmp',
      model: 'test',
      title: 'Snapshot Session',
      createdAt: session.createdAt,
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
      maxMessages: 100,
      messageCount: session.messageCount,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      compactionCount: 0,
      commandCount: 0,
      fileChangeCount: 0,
    };

    const backingStore: RuntimeSessionBackingStore = {
      listSessions() {
        return [summary];
      },
      getSessionSummary(sessionId: string) {
        return sessionId === session.id ? summary : null;
      },
      getSessionSnapshot(sessionId: string) {
        return sessionId === session.id ? session.toSnapshot() as unknown as RuntimeSessionSnapshot : null;
      },
      saveSessionSnapshot(input) {
        summary = {
          ...summary,
          id: input.snapshot.id,
          title: input.snapshot.title ?? 'Snapshot Session',
          updatedAt: new Date('2026-03-20T00:00:01.000Z'),
          messageCount: input.snapshot.messages.length,
        };
        return summary;
      },
    };

    const store = createRuntimeSessionStoreAdapter(backingStore, {
      projectRoot: '/tmp',
      model: 'test',
    });

    const record = store.get(session.id) as SessionRecord | undefined;
    expect(record).toBeDefined();
    expect(record?.messages.map((message) => message.content)).toEqual(['hello from snapshot']);
  });

  it('passes only snapshot and runtime persistence context across the storage boundary', () => {
    let capturedInput: (RuntimeSessionBackingStore extends { saveSessionSnapshot(input: infer T): unknown } ? T : never) | undefined;

    const backingStore: RuntimeSessionBackingStore = {
      listSessions() {
        return [];
      },
      getSessionSummary() {
        return null;
      },
      getSessionSnapshot() {
        return null;
      },
      saveSessionSnapshot(input) {
        capturedInput = input;
        return {
          id: input.snapshot.id,
          projectRoot: input.projectRoot,
          cwd: input.cwd,
          model: input.model,
          title: input.snapshot.title ?? 'Boundary Session',
          createdAt: new Date('2026-03-20T00:00:00.000Z'),
          updatedAt: new Date('2026-03-20T00:00:01.000Z'),
          maxMessages: input.snapshot.maxMessages,
          messageCount: input.snapshot.messages.length,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          compactionCount: 0,
          commandCount: 0,
          fileChangeCount: 0,
        };
      },
    };

    const store = createRuntimeSessionStoreAdapter(backingStore, {
      projectRoot: '/fallback',
      model: 'fallback-model',
    });

    store.upsert({
      id: 'boundary-session',
      cwd: '/workspace/demo',
      title: 'Boundary Session',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{
        id: 'm1',
        sessionId: 'boundary-session',
        role: 'user',
        content: 'hello',
        createdAt: 1000,
      }],
      metadata: {
        projectRoot: '/workspace',
        model: 'gpt-4o',
      },
    });

    expect(capturedInput).toBeDefined();
    const saveInput = capturedInput as NonNullable<typeof capturedInput>;

    expect(saveInput).toMatchObject({
      projectRoot: '/workspace',
      cwd: '/workspace/demo',
      model: 'gpt-4o',
      snapshot: expect.objectContaining({
        id: 'boundary-session',
        title: 'Boundary Session',
      }),
    });
    expect('title' in saveInput).toBe(false);
    expect('options' in saveInput).toBe(false);
  });

  it('derives a cached summary when the backing store save path does not return one', async () => {
    const backingStore: RuntimeSessionBackingStore = {
      listSessions() {
        return [];
      },
      getSessionSummary() {
        return null;
      },
      getSessionSnapshot() {
        return null;
      },
      saveSessionSnapshot() {
        return undefined as unknown as RuntimeSessionSummary;
      },
    };

    const store = createRuntimeSessionStoreAdapter(backingStore, {
      projectRoot: '/fallback',
      model: 'fallback-model',
    });

    store.upsert({
      id: 'summaryless-session',
      cwd: '/workspace/demo',
      title: 'Summaryless Session',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{
        id: 'm1',
        sessionId: 'summaryless-session',
        role: 'user',
        content: 'hello fallback summary',
        createdAt: 1000,
      }],
      metadata: {
        projectRoot: '/workspace',
        model: 'gpt-4o',
        maxMessages: 120,
      },
    });

    const record = store.get('summaryless-session') as SessionRecord | undefined;
    expect(record).toBeDefined();
    expect(record?.title).toBe('Summaryless Session');
    expect(record?.updatedAt).toBe(2000);
    expect(record?.messages.map((message) => message.content)).toEqual(['hello fallback summary']);
    expect(record?.metadata?.['projectRoot']).toBe('/workspace');
    expect(record?.metadata?.['model']).toBe('gpt-4o');
    expect(record?.metadata?.['maxMessages']).toBe(120);
    expect(record?.metadata?.['lastUserMessage']).toBe('hello fallback summary');
    const listed = store.list();
    const records = listed instanceof Promise ? await listed : listed;
    expect(records.map((entry) => entry.id)).toContain('summaryless-session');
  });

  it('preserves session metadata arrays and compactSummary through runtime upsert', () => {
    const mockStore = createMockRuntimeSessionStore();
    const store = createRuntimeSessionStoreAdapter(createRuntimeSessionBackingStore(mockStore), {
      projectRoot: '/tmp',
      model: 'test',
    });

    store.upsert({
      id: 's-meta',
      cwd: '/tmp',
      title: 'Metadata Session',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{
        id: 'm1',
        sessionId: 's-meta',
        role: 'user',
        content: 'hello',
        createdAt: 1000,
      }],
      metadata: {
        projectRoot: '/tmp',
        model: 'test',
        maxMessages: 150,
        compactSummary: 'summary text',
        compactions: [{
          id: 'compact-1',
          createdAt: '2026-03-20T00:00:00.000Z',
          messageCountBefore: 10,
          messageCountAfter: 4,
          summary: 'summary text',
        }],
        toolHistory: [{
          id: 'tool-1',
          name: 'read_file',
          args: { path: '/tmp/demo.ts' },
          success: true,
          outputPreview: 'ok',
          startedAt: '2026-03-20T00:00:01.000Z',
          completedAt: '2026-03-20T00:00:02.000Z',
        }],
        commandHistory: [{
          id: 'cmd-1',
          command: 'pnpm test',
          cwd: '/tmp',
          success: true,
          outputPreview: 'done',
          startedAt: '2026-03-20T00:00:03.000Z',
          completedAt: '2026-03-20T00:00:04.000Z',
        }],
        fileChanges: [{
          id: 'file-1',
          path: '/tmp/demo.ts',
          changeType: 'write',
          bytes: 12,
          success: true,
          timestamp: '2026-03-20T00:00:05.000Z',
        }],
        customAudit: {
          source: 'manual-note',
          actor: 'codex',
        },
        fixHistory: {
          totalRuns: 2,
          successfulRuns: 1,
          failedRuns: 1,
          successRate: 0.5,
          updatedAt: '2026-03-20T00:00:06.000Z',
          recentRuns: [{
            id: 'fix-2',
            success: true,
            attemptCount: 2,
            totalDurationMs: 42000,
            startedAt: '2026-03-20T00:00:00.000Z',
            completedAt: '2026-03-20T00:00:42.000Z',
            remediationPolicyIds: ['compile-error-v2'],
            suspectedFailureBuckets: ['runtime_compile_error'],
            automaticActionIds: [],
          }],
          rollingWindows: [{
            label: '7d',
            totalRuns: 2,
            successfulRuns: 1,
            failedRuns: 1,
            successRate: 0.5,
          }],
        },
      },
    });

    const record = store.get('s-meta') as SessionRecord | undefined;
    expect(record?.metadata?.['compactSummary']).toBe('summary text');
    expect(record?.metadata?.['maxMessages']).toBe(150);
    expect(record?.metadata?.['compactions']).toEqual([
      expect.objectContaining({ id: 'compact-1', summary: 'summary text' }),
    ]);
    expect(record?.metadata?.['toolHistory']).toEqual([
      expect.objectContaining({ id: 'tool-1', name: 'read_file' }),
    ]);
    expect(record?.metadata?.['commandHistory']).toEqual([
      expect.objectContaining({ id: 'cmd-1', command: 'pnpm test' }),
    ]);
    expect(record?.metadata?.['fileChanges']).toEqual([
      expect.objectContaining({ id: 'file-1', path: '/tmp/demo.ts' }),
    ]);
    expect(record?.metadata?.['customAudit']).toEqual({
      source: 'manual-note',
      actor: 'codex',
    });
    expect(record?.metadata?.['fixHistory']).toEqual(expect.objectContaining({
      totalRuns: 2,
      successfulRuns: 1,
      failedRuns: 1,
      successRate: 0.5,
      recentRuns: [
        expect.objectContaining({
          id: 'fix-2',
          attemptCount: 2,
          remediationPolicyIds: ['compile-error-v2'],
        }),
      ],
    }));
  });
});
