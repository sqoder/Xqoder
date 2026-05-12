// P25a — barrel for @xqoder/core-daemon.

export { DEFAULT_SOCKET_PATH, createIpcServer, createIpcClient, isDaemonRunning } from './ipc.js';
export type { RpcRequest, RpcResponse, RpcHandler, IpcServer, IpcClient } from './ipc.js';
export { runDaemon } from './daemon.js';
export type { DaemonOptions } from './daemon.js';
export {
    spawnWorker,
    listWorkers,
    killWorker,
    killAllWorkers,
    pruneStaleWorkers,
    __resetWorkersForTests,
} from './supervisor.js';
export type { WorkerEntry } from './supervisor.js';
