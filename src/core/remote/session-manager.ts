// P25c — Remote session manager: tracks active remote sessions.
//
// A remote session is a local agent session that is also accessible via
// the bridge WebSocket. The manager maps session IDs to their connection state.

import * as crypto from 'node:crypto';

export interface RemoteSessionEntry {
    id: string;
    sessionId: string;
    connectedAt: Date;
    lastActivityAt: Date;
}

const sessions = new Map<string, RemoteSessionEntry>();

export function registerRemoteSession(sessionId: string): RemoteSessionEntry {
    const id = crypto.randomUUID();
    const entry: RemoteSessionEntry = {
        id,
        sessionId,
        connectedAt: new Date(),
        lastActivityAt: new Date(),
    };
    sessions.set(id, entry);
    return entry;
}

export function touchRemoteSession(id: string): void {
    const entry = sessions.get(id);
    if (entry) entry.lastActivityAt = new Date();
}

export function unregisterRemoteSession(id: string): boolean {
    return sessions.delete(id);
}

export function listRemoteSessions(): RemoteSessionEntry[] {
    return Array.from(sessions.values());
}

export function getRemoteSession(id: string): RemoteSessionEntry | undefined {
    return sessions.get(id);
}

/** Remove sessions idle for more than `maxIdleMs`. */
export function pruneIdleSessions(maxIdleMs: number): number {
    const cutoff = Date.now() - maxIdleMs;
    let pruned = 0;
    for (const [id, entry] of sessions.entries()) {
        if (entry.lastActivityAt.getTime() < cutoff) {
            sessions.delete(id);
            pruned++;
        }
    }
    return pruned;
}

/** For tests only. */
export function __resetRemoteSessionsForTests(): void {
    sessions.clear();
}
