// P25c — Permission bridge: relay tool-approval requests to remote clients.
//
// When a tool call requires approval and a remote client is connected via
// the bridge, the approval request is queued here. The remote client polls
// or receives it via WebSocket, approves/denies, and the result is resolved.

import * as crypto from 'node:crypto';

export interface PermissionRequest {
    id: string;
    sessionId: string;
    toolName: string;
    args: unknown;
    createdAt: Date;
}

export interface PermissionResolution {
    requestId: string;
    approved: boolean;
    reason?: string;
}

const pending = new Map<string, {
    request: PermissionRequest;
    resolve: (approved: boolean) => void;
}>();

export function queuePermissionRequest(
    sessionId: string,
    toolName: string,
    args: unknown,
): Promise<boolean> {
    return new Promise((resolve) => {
        const id = crypto.randomUUID();
        const request: PermissionRequest = {
            id,
            sessionId,
            toolName,
            args,
            createdAt: new Date(),
        };
        pending.set(id, { request, resolve });
    });
}

export function resolvePermissionRequest(resolution: PermissionResolution): boolean {
    const entry = pending.get(resolution.requestId);
    if (!entry) return false;
    pending.delete(resolution.requestId);
    entry.resolve(resolution.approved);
    return true;
}

export function listPendingPermissions(sessionId?: string): PermissionRequest[] {
    const all = Array.from(pending.values()).map((e) => e.request);
    return sessionId ? all.filter((r) => r.sessionId === sessionId) : all;
}

/** For tests only. */
export function __resetPermissionBridgeForTests(): void {
    for (const entry of pending.values()) {
        entry.resolve(false); // deny all pending on reset
    }
    pending.clear();
}
