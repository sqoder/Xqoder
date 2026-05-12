// P25a — Daemon supervisor: manages worker child processes.
//
// Each worker is a child_process.fork of src/core/daemon/worker.ts.
// The supervisor tracks PIDs, forwards RPC calls, and cleans up stale workers.

import * as child_process from 'node:child_process';
import * as path from 'node:path';
import * as url from 'node:url';
import * as crypto from 'node:crypto';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export interface WorkerEntry {
    id: string;
    pid: number;
    sessionId?: string;
    startedAt: Date;
    process: child_process.ChildProcess;
}

const workers = new Map<string, WorkerEntry>();

export function spawnWorker(params: { sessionId?: string }): { workerId: string; pid: number } {
    const workerId = crypto.randomUUID();
    const workerScript = path.join(__dirname, 'worker.js');

    const child = child_process.fork(workerScript, [], {
        env: { ...process.env, XQODER_WORKER_ID: workerId },
        detached: false,
        stdio: 'inherit',
    });

    const entry: WorkerEntry = {
        id: workerId,
        pid: child.pid ?? 0,
        sessionId: params.sessionId,
        startedAt: new Date(),
        process: child,
    };

    workers.set(workerId, entry);

    child.on('exit', () => {
        workers.delete(workerId);
    });

    return { workerId, pid: child.pid ?? 0 };
}

export function listWorkers(): Array<{ id: string; pid: number; sessionId?: string; startedAt: string }> {
    return Array.from(workers.values()).map((w) => ({
        id: w.id,
        pid: w.pid,
        sessionId: w.sessionId,
        startedAt: w.startedAt.toISOString(),
    }));
}

export function killWorker(workerId: string): boolean {
    const entry = workers.get(workerId);
    if (!entry) return false;
    entry.process.kill('SIGTERM');
    workers.delete(workerId);
    return true;
}

export function killAllWorkers(): void {
    for (const entry of workers.values()) {
        try { entry.process.kill('SIGTERM'); } catch { /* ignore */ }
    }
    workers.clear();
}

/** Remove workers whose process has already exited (stale entries). */
export function pruneStaleWorkers(): number {
    let pruned = 0;
    for (const [id, entry] of workers.entries()) {
        if (entry.process.exitCode !== null || entry.process.killed) {
            workers.delete(id);
            pruned++;
        }
    }
    return pruned;
}

/** For tests only. */
export function __resetWorkersForTests(): void {
    workers.clear();
}
