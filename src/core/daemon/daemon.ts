// P25a — Daemon entry point.
//
// Starts the Unix socket IPC server, registers RPC handlers, and runs until
// SIGTERM. Feature-gated behind DAEMON; the CLI stub in cli/handlers/daemon.ts
// calls this when the feature is enabled.

import { createIpcServer, DEFAULT_SOCKET_PATH } from './ipc.js';
import {
    killAllWorkers,
    killWorker,
    listWorkers,
    pruneStaleWorkers,
    spawnWorker,
} from './supervisor.js';

const PRUNE_INTERVAL_MS = 60_000;

export interface DaemonOptions {
    socketPath?: string;
}

export async function runDaemon(options: DaemonOptions = {}): Promise<void> {
    const socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;

    const server = await createIpcServer(socketPath, async (method, params) => {
        const p = params as Record<string, unknown> ?? {};
        switch (method) {
            case 'ping':
                return { pong: true, pid: process.pid };
            case 'spawn':
                return spawnWorker({ sessionId: p['sessionId'] as string | undefined });
            case 'ps':
                return listWorkers();
            case 'kill':
                return { killed: killWorker(p['workerId'] as string) };
            case 'killAll':
                killAllWorkers();
                return { ok: true };
            default:
                throw new Error(`Unknown method: ${method}`);
        }
    });

    // Periodic stale-worker cleanup
    const pruneTimer = setInterval(() => {
        pruneStaleWorkers();
    }, PRUNE_INTERVAL_MS);
    pruneTimer.unref();

    process.stdout.write(`[daemon] listening on ${socketPath} (pid ${process.pid})\n`);

    // Graceful shutdown
    const shutdown = (): void => {
        clearInterval(pruneTimer);
        killAllWorkers();
        server.close();
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Keep process alive
    await new Promise<void>(() => { /* runs until signal */ });
}
