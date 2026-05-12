// P24c — session rewind unit tests.

import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentSession } from '../../../src/core/agent/session/session.js';
import { SQLiteSessionStore } from '../../../src/core/agent/session/store.js';
import { rewindSession } from '../../../src/core/agent/session/rewind.js';

function tmpDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-rewind-'));
    return path.join(dir, 'sessions.sqlite');
}

function makeSession(messages: Array<{ role: 'user' | 'assistant'; content: string }>): AgentSession {
    return new AgentSession({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
}

describe('rewindSession', () => {
    let store: SQLiteSessionStore;

    afterEach(() => {
        store?.close();
    });

    it('creates a branch session with truncated messages', () => {
        store = new SQLiteSessionStore(tmpDbPath());
        const session = makeSession([
            { role: 'user', content: 'msg0' },
            { role: 'assistant', content: 'msg1' },
            { role: 'user', content: 'msg2' },
            { role: 'assistant', content: 'msg3' },
            { role: 'user', content: 'msg4' },
        ]);
        store.saveSession({ session, projectRoot: '/proj', cwd: '/proj', model: 'test' });

        const result = rewindSession(store, {
            sessionId: session.id,
            messageIndex: 2,
            model: 'test',
        });

        expect(result.keptMessages).toBe(3);
        expect(result.discardedMessages).toBe(2);
        expect(result.branchSession.parentSessionId).toBe(session.id);

        // Verify branch has correct message count
        const branch = store.getSession(result.branchSession.id);
        expect(branch?.getMessages()).toHaveLength(3);
    });

    it('throws when session is not found', () => {
        store = new SQLiteSessionStore(tmpDbPath());
        expect(() =>
            rewindSession(store, { sessionId: 'nonexistent', messageIndex: 0, model: 'test' }),
        ).toThrow(/not found/i);
    });

    it('throws when messageIndex is out of range', () => {
        store = new SQLiteSessionStore(tmpDbPath());
        const session = makeSession([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ]);
        store.saveSession({ session, projectRoot: '/proj', cwd: '/proj', model: 'test' });

        expect(() =>
            rewindSession(store, { sessionId: session.id, messageIndex: 10, model: 'test' }),
        ).toThrow(/out of range/i);
    });

    it('throws when messageIndex is negative', () => {
        store = new SQLiteSessionStore(tmpDbPath());
        const session = makeSession([{ role: 'user', content: 'hello' }]);
        store.saveSession({ session, projectRoot: '/proj', cwd: '/proj', model: 'test' });

        expect(() =>
            rewindSession(store, { sessionId: session.id, messageIndex: -1, model: 'test' }),
        ).toThrow(/out of range/i);
    });

    it('keeps all messages when messageIndex = last index', () => {
        store = new SQLiteSessionStore(tmpDbPath());
        const session = makeSession([
            { role: 'user', content: 'a' },
            { role: 'assistant', content: 'b' },
            { role: 'user', content: 'c' },
        ]);
        store.saveSession({ session, projectRoot: '/proj', cwd: '/proj', model: 'test' });

        const result = rewindSession(store, {
            sessionId: session.id,
            messageIndex: 2,
            model: 'test',
        });

        expect(result.keptMessages).toBe(3);
        expect(result.discardedMessages).toBe(0);
    });

    it('uses provided title for branch session', () => {
        store = new SQLiteSessionStore(tmpDbPath());
        const session = makeSession([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ]);
        store.saveSession({ session, projectRoot: '/proj', cwd: '/proj', model: 'test' });

        const result = rewindSession(store, {
            sessionId: session.id,
            messageIndex: 0,
            model: 'test',
            title: 'My Branch',
        });

        expect(result.branchSession.title).toBe('My Branch');
    });
});
