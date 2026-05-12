// P25c — Remote session manager + permission bridge unit tests.

import { afterEach, describe, expect, it } from 'bun:test';
import {
    __resetRemoteSessionsForTests,
    getRemoteSession,
    listRemoteSessions,
    pruneIdleSessions,
    registerRemoteSession,
    touchRemoteSession,
    unregisterRemoteSession,
} from '../../../src/core/remote/session-manager.js';
import {
    __resetPermissionBridgeForTests,
    listPendingPermissions,
    queuePermissionRequest,
    resolvePermissionRequest,
} from '../../../src/core/remote/permission-bridge.js';

afterEach(() => {
    __resetRemoteSessionsForTests();
    __resetPermissionBridgeForTests();
});

// ---------------------------------------------------------------------------
// Session manager
// ---------------------------------------------------------------------------

describe('remote session manager', () => {
    it('registers and retrieves a session', () => {
        const entry = registerRemoteSession('sess-1');
        expect(entry.sessionId).toBe('sess-1');
        expect(typeof entry.id).toBe('string');
        expect(getRemoteSession(entry.id)).toBe(entry);
    });

    it('listRemoteSessions returns all registered sessions', () => {
        registerRemoteSession('sess-1');
        registerRemoteSession('sess-2');
        expect(listRemoteSessions()).toHaveLength(2);
    });

    it('unregisterRemoteSession removes the session', () => {
        const entry = registerRemoteSession('sess-1');
        expect(unregisterRemoteSession(entry.id)).toBe(true);
        expect(getRemoteSession(entry.id)).toBeUndefined();
    });

    it('unregisterRemoteSession returns false for unknown id', () => {
        expect(unregisterRemoteSession('nonexistent')).toBe(false);
    });

    it('touchRemoteSession updates lastActivityAt', async () => {
        const entry = registerRemoteSession('sess-1');
        const before = entry.lastActivityAt.getTime();
        await new Promise((r) => setTimeout(r, 5));
        touchRemoteSession(entry.id);
        const after = getRemoteSession(entry.id)!.lastActivityAt.getTime();
        expect(after).toBeGreaterThanOrEqual(before);
    });

    it('pruneIdleSessions removes sessions idle longer than maxIdleMs', async () => {
        registerRemoteSession('sess-1');
        await new Promise((r) => setTimeout(r, 10));
        const pruned = pruneIdleSessions(5); // 5ms threshold
        expect(pruned).toBe(1);
        expect(listRemoteSessions()).toHaveLength(0);
    });

    it('pruneIdleSessions keeps recently active sessions', () => {
        registerRemoteSession('sess-1');
        const pruned = pruneIdleSessions(60_000); // 60s threshold
        expect(pruned).toBe(0);
        expect(listRemoteSessions()).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Permission bridge
// ---------------------------------------------------------------------------

describe('permission bridge', () => {
    it('queues a request and resolves it', async () => {
        const promise = queuePermissionRequest('sess-1', 'run_command', { cmd: 'ls' });
        const pending = listPendingPermissions();
        expect(pending).toHaveLength(1);
        expect(pending[0]?.toolName).toBe('run_command');

        const resolved = resolvePermissionRequest({
            requestId: pending[0]!.id,
            approved: true,
        });
        expect(resolved).toBe(true);

        const result = await promise;
        expect(result).toBe(true);
    });

    it('resolves with false when denied', async () => {
        const promise = queuePermissionRequest('sess-1', 'write_file', {});
        const pending = listPendingPermissions();
        resolvePermissionRequest({ requestId: pending[0]!.id, approved: false });
        expect(await promise).toBe(false);
    });

    it('returns false for unknown requestId', () => {
        expect(resolvePermissionRequest({ requestId: 'nonexistent', approved: true })).toBe(false);
    });

    it('listPendingPermissions filters by sessionId', async () => {
        queuePermissionRequest('sess-1', 'tool-a', {});
        queuePermissionRequest('sess-2', 'tool-b', {});
        const forSess1 = listPendingPermissions('sess-1');
        expect(forSess1).toHaveLength(1);
        expect(forSess1[0]?.sessionId).toBe('sess-1');
        // cleanup
        for (const p of listPendingPermissions()) {
            resolvePermissionRequest({ requestId: p.id, approved: false });
        }
    });

    it('__reset denies all pending requests', async () => {
        const promise = queuePermissionRequest('sess-1', 'tool', {});
        __resetPermissionBridgeForTests();
        const result = await promise;
        expect(result).toBe(false);
    });
});
