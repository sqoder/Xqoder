// P19a — LocalShellTask runner. Spawns a shell command, tees stdio to a
// per-task log file, and updates the task store at start / finish.
//
// Two entry points:
//   - runLocalShellTask(opts): awaits completion (foreground).
//   - startLocalShellTask(opts): returns { pid, done, stop } for background use.
//
// P19.0.x: buildSanitizedEnv() strips sensitive keys (API keys, tokens,
// passwords, secrets) before passing env to the child process.

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Task } from './task-types.js';
import type { TaskStore } from './task-store.js';

const SENSITIVE_KEY_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PASSWD|AUTH/i;
const ALLOWED_ENV_KEYS = new Set(['PATH', 'LANG', 'HOME', 'TERM', 'USER', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'PWD', 'LOGNAME']);

/** Strip sensitive env vars (API keys, tokens, secrets) before passing to child processes. */
export function buildSanitizedEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const result: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(source)) {
        if (value === undefined) continue;
        if (ALLOWED_ENV_KEYS.has(key) || !SENSITIVE_KEY_PATTERN.test(key)) {
            result[key] = value;
        }
    }
    return result;
}

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
        env: buildSanitizedEnv(input.env ?? process.env),
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
