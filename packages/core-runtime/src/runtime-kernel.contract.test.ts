import { describe, expect, it, vi } from 'vitest';
import type { CoreMessage } from '@xqoder/protocol';
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

  it('getSession and appendMessage delegate to sessionStore', async () => {
    const store = createMockSessionStore();
    const appendSpy = vi.spyOn(store, 'appendMessage');
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
    await kernel.appendMessage('sess-1', msg);

    expect(appendSpy).toHaveBeenCalledWith('sess-1', msg);
    const got = kernel.getSession('sess-1');
    const record = got instanceof Promise ? await got : got;
    expect(record).toBeDefined();
    expect(record!.messages).toHaveLength(1);
    expect(record!.messages[0].content).toBe('hello');
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
});
