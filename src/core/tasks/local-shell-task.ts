// P19a — LocalShellTask runner. Spawns a shell command, tees stdio to a
// per-task log file, and updates the task store at start / finish.
//
// Two entry points:
//   - runLocalShellTask(opts): awaits completion (foreground).
//   - startLocalShellTask(opts): returns { pid, done, stop } for background use.

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Task } from './task-types.js';
import type { TaskStore } from './task-store.js';

export interface LocalShellTaskInput {
    task: Task;
    store: TaskStore;
    cwd: string;
    logDir: string;
    env?: NodeJS.ProcessEnv;
    shell?: string;
}

export interface LocalShellTaskResult {
    status: 'completed' | 'failed' | 'stopped';
    exitCode: number;
    signal?: NodeJS.Signals;
    logPath: string;
}

export interface LocalShellTaskHandle {
    pid: number;
    logPath: string;
    done: Promise<LocalShellTaskResult>;
    stop(signal?: NodeJS.Signals): void;
}

export async function runLocalShellTask(input: LocalShellTaskInput): Promise<LocalShellTaskResult> {
    return startLocalShellTask(input).done;
}

export function startLocalShellTask(input: LocalShellTaskInput): LocalShellTaskHandle {
    const { task, store, cwd, logDir } = input;
    if (task.type !== 'shell') {
        throw new Error(`LocalShellTask requires type=shell, got ${task.type}`);
    }
    if (!task.command || task.command.trim().length === 0) {
        throw new Error(`LocalShellTask requires command for task ${task.id}`);
    }

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, `${task.id}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    const shell = input.shell ?? '/bin/sh';
    const child: ChildProcess = spawn(shell, ['-c', task.command], {
        cwd,
        env: input.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });

    const pid = child.pid ?? 0;
    store.update(task.id, { status: 'running', pid, logPath });

    let stopRequested = false;

    const done = new Promise<LocalShellTaskResult>((resolve) => {
        child.on('close', (code, signal) => {
            const exitCode = typeof code === 'number' ? code : 0;
            const status: LocalShellTaskResult['status'] = stopRequested
                ? 'stopped'
                : exitCode === 0
                    ? 'completed'
                    : 'failed';

            store.update(task.id, {
                status,
                exitCode,
                error: status === 'failed' ? `exit code ${exitCode}` : null,
            });

            logStream.end(() => {
                resolve({
                    status,
                    exitCode,
                    ...(signal ? { signal } : {}),
                    logPath,
                });
            });
        });

        child.on('error', (err) => {
            store.update(task.id, {
                status: 'failed',
                error: err.message,
            });
            logStream.end(() => {
                resolve({
                    status: 'failed',
                    exitCode: 1,
                    logPath,
                });
            });
        });
    });

    return {
        pid,
        logPath,
        done,
        stop(signal: NodeJS.Signals = 'SIGTERM') {
            stopRequested = true;
            if (!child.killed) {
                child.kill(signal);
            }
        },
    };
}
