// P25c — barrel for @xqoder/core-remote.

export {
    registerRemoteSession,
    touchRemoteSession,
    unregisterRemoteSession,
    listRemoteSessions,
    getRemoteSession,
    pruneIdleSessions,
    __resetRemoteSessionsForTests,
} from './session-manager.js';
export type { RemoteSessionEntry } from './session-manager.js';

export { SessionsWebSocket } from './sessions-websocket.js';
export type { SessionsWebSocketOptions, WebSocketStatus } from './sessions-websocket.js';

export {
    queuePermissionRequest,
    resolvePermissionRequest,
    listPendingPermissions,
    __resetPermissionBridgeForTests,
} from './permission-bridge.js';
export type { PermissionRequest, PermissionResolution } from './permission-bridge.js';
