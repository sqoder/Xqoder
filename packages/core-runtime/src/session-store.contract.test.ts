import { describe, expect, it } from 'vitest';
import type { CoreMessage } from '@xqoder/protocol';
import { InMemorySessionStore, type SessionRecord } from './session-store.js';

function createMessage(overrides: Partial<CoreMessage> = {}): CoreMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    role: 'user',
    content: 'hello',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('SessionStore contract (core-runtime boundary)', () => {
  it('InMemorySessionStore implements list/get/upsert/appendMessage', () => {
    const store = new InMemorySessionStore();

    expect(store.list()).toEqual([]);
    expect(store.get('s1')).toBeUndefined();

    const record: SessionRecord = {
      id: 's1',
      cwd: '/tmp',
      title: 'Test',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [createMessage({ id: 'm1', createdAt: 1000 })],
    };
    store.upsert(record);

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe('s1');
    expect(store.get('s1')).toBeDefined();
    expect(store.get('s1')!.messages).toHaveLength(1);

    store.appendMessage('s1', createMessage({ id: 'm2', role: 'assistant', createdAt: 2000 }));
    const after = store.get('s1')!;
    expect(after.messages).toHaveLength(2);
    expect(after.updatedAt).toBe(2000);
  });

  it('appendMessage creates session when missing', () => {
    const store = new InMemorySessionStore();
    store.appendMessage('new-session', createMessage({ id: 'm1' }));
    const rec = store.get('new-session');
    expect(rec).toBeDefined();
    expect(rec!.messages).toHaveLength(1);
  });
});
