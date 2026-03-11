import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TuiSettings } from './commands.js';

const CLI_ENTRYPOINT = fileURLToPath(new URL('../index.js', import.meta.url));
const ANSI_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export interface CliRunnerCallbacks {
    onLine: (line: string) => void;
    onExit: (result: {
        code: number | null;
        signal: NodeJS.Signals | null;
    }) => void;
}

export interface RunningCliCommand {
    kill: () => void;
}

export function runCliCommand(
    args: string[],
    settings: TuiSettings,
    callbacks: CliRunnerCallbacks,
): RunningCliCommand {
    const child = spawn(process.execPath, [
        CLI_ENTRYPOINT,
        ...args,
    ], {
        cwd: settings.dir,
        env: {
            ...process.env,
            FORCE_COLOR: '1',
            NODE_NO_WARNINGS: '1',
            XQODER_SANDBOX_MODE: settings.sandboxMode,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    bindOutput(child, callbacks.onLine);
    child.once('exit', (code, signal) => {
        callbacks.onExit({ code, signal });
    });

    return {
        kill: () => {
            if (!child.killed) {
                child.kill('SIGINT');
            }
        },
    };
}

export function runShellCommand(
    shellCmd: string,
    cwd: string,
    callbacks: CliRunnerCallbacks,
): RunningCliCommand {
    const shell = process.env.SHELL ?? '/bin/sh';
    const child = spawn(shell, ['-c', shellCmd], {
        cwd,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    bindOutput(child, callbacks.onLine);
    child.once('exit', (code, signal) => {
        callbacks.onExit({ code, signal });
    });

    return {
        kill: () => {
            if (!child.killed) {
                child.kill('SIGINT');
            }
        },
    };
}

function bindOutput(
    child: {
        stdout: NodeJS.ReadableStream;
        stderr: NodeJS.ReadableStream;
    },
    onLine: (line: string) => void,
): void {
    pipeLines(child.stdout, onLine);
    pipeLines(child.stderr, onLine);
}

function pipeLines(
    stream: NodeJS.ReadableStream,
    onLine: (line: string) => void,
): void {
    let buffer = '';

    stream.on('data', (chunk: string | Buffer) => {
        buffer += chunk.toString();
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? '';

        for (const part of parts) {
            const cleaned = sanitizeTerminalLine(part);
            if (cleaned) {
                onLine(cleaned);
            }
        }
    });

    stream.on('end', () => {
        const cleaned = sanitizeTerminalLine(buffer);
        if (cleaned) {
            onLine(cleaned);
        }
    });
}

function sanitizeTerminalLine(line: string): string {
    if (
        line.includes('[DEP0040] DeprecationWarning')
        || line.includes('node --trace-deprecation')
    ) {
        return '';
    }

    return line
        .replace(ANSI_PATTERN, '')
        .replace(/\r/g, '')
        .replace(CONTROL_PATTERN, '')
        .trimEnd();
}
