import { describe, expect, it, vi } from 'vitest';
import type { AppEvent, CoreMessage } from '@xqoder/protocol';
import type { SessionRecord, SessionStore } from './session-store.js';
import { RuntimeKernel } from './runtime-kernel.js';
import { StaticPermissionPolicy } from '@xqoder/permissions';
import { definePlugin } from '@xqoder/plugin-sdk';

function createMockSessionStore(): SessionStore {
  const sessions = new Map<string, SessionRecord>();
  return {
    list: () => [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    get: (id: string) => sessions.get(id),
    upsert: (record: SessionRecord) => {
      sessions.set(record.id, { ...record, messages: [...record.messages] });
    },
    appendMessage: (sessionId: string, message: CoreMessage) => {
      const existing = sessions.get(sessionId);
      if (existing) {
        sessions.set(sessionId, {
          ...existing,
          messages: [...existing.messages, message],
          updatedAt: message.createdAt,
        });
      } else {
        sessions.set(sessionId, {
          id: sessionId,
          cwd: '',
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
          messages: [message],
        });
      }
    },
  };
}

describe('RuntimeKernel contract (core-runtime)', () => {
  it('snapshot returns empty registries before plugins', () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    const snap = kernel.snapshot();
    expect(snap.commands).toEqual([]);
    expect(snap.modelProviders).toEqual([]);
    expect(snap.agentProviders).toEqual([]);
    expect(snap.toolProviders).toEqual([]);
  });

  it('appendMessage prefers the session store append path', async () => {
    const store = createMockSessionStore();
    const appendSpy = vi.spyOn(store, 'appendMessage');
    const upsertSpy = vi.spyOn(store, 'upsert');
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    const msg: CoreMessage = {
      id: 'm1',
      sessionId: 'sess-1',
      role: 'user',
      content: 'hello',
      createdAt: Date.now(),
    };
    const appended = await kernel.appendMessage('sess-1', msg);

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(appended?.id).toBe('sess-1');
    const got = kernel.loadSessionSnapshot('sess-1');
    const record = got instanceof Promise ? await got : got;
    expect(record).toBeDefined();
    expect(record!.messages).toHaveLength(1);
    expect(record!.messages[0].content).toBe('hello');
  });

  it('appendMessage preserves existing session metadata when rewriting through snapshot save', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    await kernel.saveSessionSnapshot({
      id: 'sess-append-preserve',
      cwd: '/repo',
      title: 'Preserve Me',
      createdAt: 100,
      updatedAt: 200,
      messages: [
        {
          id: 'm0',
          sessionId: 'sess-append-preserve',
          role: 'user',
          content: 'before append',
          createdAt: 100,
        },
      ],
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-4.1',
      },
    });

    await kernel.appendMessage('sess-append-preserve', {
      id: 'm1',
      sessionId: 'sess-append-preserve',
      role: 'assistant',
      content: 'after append',
      createdAt: 300,
    });

    const record = await kernel.loadSessionSnapshot('sess-append-preserve');
    expect(record).toMatchObject({
      id: 'sess-append-preserve',
      cwd: '/repo',
      title: 'Preserve Me',
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-4.1',
      },
    });
    expect(record?.messages.map((message) => message.content)).toEqual([
      'before append',
      'after append',
    ]);
  });

  it('listSessions and loadSessionSnapshot expose explicit session APIs', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    await kernel.saveSessionSnapshot({
      id: 'sess-list-1',
      cwd: '/repo',
      createdAt: 100,
      updatedAt: 300,
      messages: [],
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-4o',
      },
    });
    await kernel.saveSessionSnapshot({
      id: 'sess-list-2',
      cwd: '/repo',
      createdAt: 200,
      updatedAt: 400,
      messages: [],
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-4.1',
      },
    });
    await kernel.saveSessionSnapshot({
      id: 'sess-list-3',
      cwd: '/other',
      createdAt: 300,
      updatedAt: 500,
      messages: [],
      metadata: {
        projectRoot: '/other',
      },
    });

    const sessions = await kernel.listSessions();
    expect(sessions.map((session) => session.id)).toEqual(['sess-list-3', 'sess-list-2', 'sess-list-1']);

    const filtered = await kernel.listSessions({ projectRoot: '/repo', limit: 1 });
    expect(filtered.map((session) => session.id)).toEqual(['sess-list-2']);

    const latest = await kernel.getLatestSession('/repo');
    expect(latest?.id).toBe('sess-list-2');

    const snapshot = await kernel.loadSessionSnapshot('sess-list-2');
    expect(snapshot?.id).toBe('sess-list-2');
  });

  it('saveSessionSnapshot exposes an explicit snapshot persistence API', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    const saved = await kernel.saveSessionSnapshot({
      id: 'sess-snapshot-1',
      cwd: '/repo',
      createdAt: 100,
      updatedAt: 200,
      messages: [],
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-4o',
      },
    });

    expect(saved).toMatchObject({
      id: 'sess-snapshot-1',
      cwd: '/repo',
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-4o',
      },
    });

    const loaded = await kernel.loadSessionSnapshot('sess-snapshot-1');
    expect(loaded?.id).toBe('sess-snapshot-1');
  });

  it('commitSessionSnapshot remains a compatibility alias for saveSessionSnapshot', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    const committed = await kernel.commitSessionSnapshot({
      id: 'sess-commit-alias-1',
      cwd: '/repo',
      createdAt: 100,
      updatedAt: 200,
      messages: [],
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-4o',
      },
    });

    expect(committed.id).toBe('sess-commit-alias-1');
    expect(await kernel.loadSessionSnapshot('sess-commit-alias-1')).toMatchObject({
      id: 'sess-commit-alias-1',
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-4o',
      },
    });
  });

  it('createSession and updateSessionTitle expose explicit lifecycle APIs', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    const created = await kernel.createSession({
      cwd: '/repo',
      projectRoot: '/repo',
      model: 'gpt-4.1',
      title: 'Initial title',
    });
    expect(created.id).toMatch(/^session_/);
    expect(created.title).toBe('Initial title');
    expect(created.metadata?.['projectRoot']).toBe('/repo');

    const updated = await kernel.updateSessionTitle(created.id, 'Better title');
    expect(updated?.title).toBe('Better title');
    expect(updated?.id).toBe(created.id);
  });

  it('updateSession exposes a single mutate API for metadata and message replacement', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    const created = await kernel.createSession({
      id: 'sess-update-1',
      cwd: '/repo',
      projectRoot: '/repo',
      model: 'gpt-4.1',
      title: 'Initial',
    });

    const updated = await kernel.updateSession({
      sessionId: created.id,
      cwd: '/repo/subdir',
      metadata: {
        projectRoot: '/repo/subdir',
        model: 'gpt-5',
        origin: 'tui',
      },
      messages: [{
        id: 'msg-1',
        sessionId: created.id,
        role: 'assistant',
        content: 'updated',
        createdAt: created.createdAt + 1,
      }],
    });

    expect(updated).toMatchObject({
      id: 'sess-update-1',
      cwd: '/repo/subdir',
      title: 'Initial',
      metadata: {
        projectRoot: '/repo/subdir',
        model: 'gpt-5',
        origin: 'tui',
      },
    });
    expect(updated?.messages).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        role: 'assistant',
        content: 'updated',
      }),
    ]);
  });

  it('upsertSession creates missing records and merges metadata when updating existing sessions', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    const created = await kernel.upsertSession({
      sessionId: 'sess-upsert-1',
      cwd: '/repo',
      title: 'Upserted',
      createdAt: 100,
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-5',
      },
      messages: [{
        id: 'msg-1',
        sessionId: 'sess-upsert-1',
        role: 'user',
        content: 'hello',
        createdAt: 101,
      }],
    });

    expect(created).toMatchObject({
      id: 'sess-upsert-1',
      cwd: '/repo',
      title: 'Upserted',
      metadata: {
        projectRoot: '/repo',
        model: 'gpt-5',
      },
    });
    expect(created.messages).toHaveLength(1);

    const updated = await kernel.upsertSession({
      sessionId: 'sess-upsert-1',
      cwd: '/repo/subdir',
      metadata: {
        projectRoot: '/repo/subdir',
        origin: 'tui',
      },
    });

    expect(updated).toMatchObject({
      id: 'sess-upsert-1',
      cwd: '/repo/subdir',
      title: 'Upserted',
      metadata: {
        projectRoot: '/repo/subdir',
        model: 'gpt-5',
        origin: 'tui',
      },
    });
    expect(updated.messages).toEqual([
      expect.objectContaining({
        id: 'msg-1',
        content: 'hello',
      }),
    ]);
  });

  it('registerPlugin runs setup and registers command', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    await kernel.registerPlugin(
      definePlugin({
        manifest: { name: 'test-kernel-plugin', version: '0.0.1' },
        setup(api) {
          api.registerCommand({
            name: 'echo',
            description: 'Echo',
            run: async () => {},
          });
        },
      }),
    );

    const snap = kernel.snapshot();
    expect(snap.commands).toHaveLength(1);
    expect(snap.commands[0].name).toBe('echo');
  });

  it('dispatch routes session commands through kernel single entry', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    const coreMessage: CoreMessage = {
      id: 'm1',
      sessionId: 'sess-2',
      role: 'assistant',
      content: 'hello',
      createdAt: 100,
    };

    await kernel.dispatch({
      type: 'session.append-event',
      sessionId: 'sess-2',
      event: {
        type: 'message.completed',
        sessionId: 'sess-2',
        timestamp: 100,
        source: 'agent',
        message: coreMessage,
      },
    });

    const loaded = await kernel.dispatch({
      type: 'session.load',
      sessionId: 'sess-2',
    });
    expect((loaded as SessionRecord | undefined)?.messages).toHaveLength(1);
    expect((loaded as SessionRecord | undefined)?.messages[0]?.content).toBe('hello');

    const loadedSnapshot = await kernel.dispatch({
      type: 'session.load-snapshot',
      sessionId: 'sess-2',
    });
    expect((loadedSnapshot as SessionRecord | undefined)?.messages).toHaveLength(1);

    const listed = await kernel.dispatch({ type: 'session.list', projectRoot: '', limit: 20 });
    expect((listed as SessionRecord[]).map((record) => record.id)).toEqual(['sess-2']);

    const created = await kernel.dispatch({
      type: 'session.create',
      input: {
        cwd: '/repo',
        projectRoot: '/repo',
        title: 'Created from dispatch',
      },
    });
    expect((created as SessionRecord).title).toBe('Created from dispatch');

    const renamed = await kernel.dispatch({
      type: 'session.update-title',
      sessionId: (created as SessionRecord).id,
      title: 'Renamed from dispatch',
    });
    expect((renamed as SessionRecord | undefined)?.title).toBe('Renamed from dispatch');

    const mutated = await kernel.dispatch({
      type: 'session.update',
      input: {
        sessionId: (created as SessionRecord).id,
        cwd: '/repo/subdir',
        metadata: {
          projectRoot: '/repo/subdir',
          model: 'gpt-5',
        },
      },
    });
    expect((mutated as SessionRecord | undefined)?.cwd).toBe('/repo/subdir');
    expect((mutated as SessionRecord | undefined)?.metadata?.['model']).toBe('gpt-5');

    const upserted = await kernel.dispatch({
      type: 'session.upsert',
      input: {
        sessionId: 'sess-3',
        cwd: '/repo',
        metadata: {
          projectRoot: '/repo',
        },
      },
    });
    expect((upserted as SessionRecord | undefined)?.id).toBe('sess-3');

    const snapshot = await kernel.dispatch({ type: 'kernel.snapshot' });
    expect(snapshot).toBeDefined();
  });

  it('runAgent persists only message.completed events through kernel appendSessionEvent', async () => {
    const store = createMockSessionStore();
    const appendSpy = vi.spyOn(store, 'appendMessage');
    const upsertSpy = vi.spyOn(store, 'upsert');
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    await kernel.registerPlugin(
      definePlugin({
        manifest: { name: 'test-agent-plugin', version: '0.0.1' },
        setup(api) {
          api.registerAgentProvider({
            name: 'test-agent',
            async *run(_task, runtime) {
              const now = Date.now();
              yield {
                type: 'status.changed',
                sessionId: runtime.sessionId,
                timestamp: now,
                source: 'agent',
                status: 'thinking',
              };
              yield {
                type: 'message.delta',
                sessionId: runtime.sessionId,
                timestamp: now + 1,
                source: 'agent',
                messageId: 'assistant-1',
                role: 'assistant',
                text: 'Hel',
              };
              yield {
                type: 'message.completed',
                sessionId: runtime.sessionId,
                timestamp: now + 2,
                source: 'agent',
                message: {
                  id: 'assistant-1',
                  sessionId: runtime.sessionId,
                  role: 'assistant',
                  content: 'Hello',
                  createdAt: now + 2,
                },
              };
            },
          });
        },
      }),
    );

    const emitted: AppEvent[] = [];
    for await (const event of kernel.runAgent('test-agent', {
      prompt: 'hello',
      messages: [],
    }, {
      sessionId: 'sess-agent-1',
      cwd: '/repo',
      permissionPolicy: {
        evaluate: async () => 'allow' as const,
      },
    })) {
      emitted.push(event);
    }

    expect(emitted.map((event) => event.type)).toEqual([
      'status.changed',
      'message.delta',
      'message.completed',
    ]);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(await kernel.loadSessionSnapshot('sess-agent-1')).toMatchObject({
      id: 'sess-agent-1',
      messages: [
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
          content: 'Hello',
        }),
      ],
    });
  });

  it('invokeTool emits lifecycle events from kernel', async () => {
    const store = createMockSessionStore();
    const kernel = new RuntimeKernel({
      sessionStore: store,
      permissionPolicy: new StaticPermissionPolicy(),
    });

    await kernel.registerPlugin(
      definePlugin({
        manifest: { name: 'test-tool-plugin', version: '0.0.1' },
        setup(api) {
          api.registerToolProvider({
            name: 'test-tools',
            tools: () => [{ name: 'echo', description: 'echo' }],
            execute: async () => ({ success: true, output: 'ok', metadata: { from: 'test' } }),
          });
        },
      }),
    );

    const emitted: AppEvent[] = [];
    kernel.events.on('*', (event) => {
      emitted.push(event);
    });

    const result = await kernel.invokeTool('test-tools', 'echo', { value: 'x' }, {
      sessionId: 'sess-3',
      cwd: '/repo',
      permissionPolicy: {
        evaluate: async () => 'allow' as const,
      },
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('ok');
    expect(emitted.map((event) => event.type)).toEqual([
      'tool.called',
      'tool.output',
      'tool.completed',
    ]);
  });
});
