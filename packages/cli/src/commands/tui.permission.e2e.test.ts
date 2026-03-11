import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../');
const scriptPath = path.join(repoRoot, 'scripts', 'xqoder.mjs');
const builtCliEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
const tempDirs: string[] = [];

function createTempProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-tui-permission-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'XQoder.md'), '# XQoder PTY E2E\n', 'utf8');
    return dir;
}

function stripTerminalOutput(value: string): string {
    return value
        .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
        .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/\r/g, '\n')
        .replace(/\u0000/g, '')
        .replace(/\n{3,}/g, '\n\n');
}

async function waitForOutput(
    readOutput: () => string,
    pattern: RegExp,
    timeoutMs: number,
): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const stripped = stripTerminalOutput(readOutput());
        if (pattern.test(stripped)) {
            return stripped;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(
        `Timed out waiting for ${pattern}.\nCaptured output:\n${stripTerminalOutput(readOutput()).slice(-6000)}`,
    );
}

async function waitForClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number | null> {
    if (child.exitCode !== null) {
        return child.exitCode;
    }

    return await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Timed out waiting for PTY process to exit'));
        }, timeoutMs);

        child.once('close', (code) => {
            clearTimeout(timer);
            resolve(code);
        });
        child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

const pythonPtyRelayScript = String.raw`
import fcntl
import os
import pty
import select
import struct
import subprocess
import sys
import termios
import time

command = sys.argv[1:]
master_fd, slave_fd = pty.openpty()
fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
child = subprocess.Popen(
    command,
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    close_fds=True,
    cwd=os.environ.get("XQODER_REPO_ROOT") or None,
    env=os.environ.copy(),
)
os.close(slave_fd)

stdout_fd = sys.stdout.fileno()
actions = [
    (1.2, b"s"),
    (3.2, b"\x03"),
]
action_index = 0
start = time.monotonic()

try:
    while True:
        now = time.monotonic()
        while action_index < len(actions) and now - start >= actions[action_index][0]:
            os.write(master_fd, actions[action_index][1])
            action_index += 1

        ready, _, _ = select.select([master_fd], [], [], 0.1)

        if master_fd in ready:
            try:
                data = os.read(master_fd, 4096)
            except OSError:
                data = b""
            if not data:
                break
            os.write(stdout_fd, data)

        if child.poll() is not None and not ready:
            break
finally:
    try:
        os.close(master_fd)
    except OSError:
        pass

sys.exit(child.wait())
`;

function hasPythonPtyHost(): boolean {
    const probe = spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' });
    return !probe.error && probe.status === 0;
}

function spawnWithPythonPty(args: string[], extraEnv: Record<string, string> = {}): ChildProcessWithoutNullStreams {
    return spawn(
        'python3',
        ['-u', '-c', pythonPtyRelayScript, ...args],
        {
            cwd: repoRoot,
            env: {
                ...process.env,
                TERM: process.env.TERM ?? 'xterm-256color',
                NO_COLOR: '1',
                XQODER_REPO_ROOT: repoRoot,
                XQODER_SANDBOX_MODE: 'project',
                ...extraEnv,
            },
            stdio: 'pipe',
        },
    );
}

const permissionPtyIt = hasPythonPtyHost() ? it : it.skip;

beforeAll(() => {
    const build = spawnSync('pnpm', ['--dir', repoRoot, '--filter', '@xqoder/cli', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
        encoding: 'utf8',
    });

    if (build.status !== 0 || !fs.existsSync(builtCliEntry)) {
        throw new Error(`Failed to build @xqoder/cli before PTY E2E.\n${build.stdout ?? ''}\n${build.stderr ?? ''}`);
    }
});

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('TUI permission PTY E2E', () => {
    permissionPtyIt('shows the permission dialog and accepts allow-all in a real PTY session', async () => {
        const projectDir = createTempProject();
        const externalPath = '/tmp/xqoder-permission-e2e.txt';
        const child = spawnWithPythonPty([
            process.execPath,
            scriptPath,
            'tui',
            '--dir',
            projectDir,
            '--sandbox-mode',
            'project',
        ], {
            XQODER_TUI_TEST_PERMISSION_DIALOG: '1',
            XQODER_TUI_TEST_PERMISSION_DIALOG_PATH: externalPath,
        });

        let output = '';
        child.stdout.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            output += chunk.toString();
        });

        const permissionOutput = await waitForOutput(
            () => output,
            /Permission Request|external-path-access|Permission required: external-path-access/i,
            10000,
        );
        expect(permissionOutput).toMatch(/external-path-access/);
        expect(permissionOutput).toContain(externalPath);

        const allowedOutput = await waitForOutput(
            () => output,
            /Permissions: allow all \(full access\)/,
            10000,
        );
        expect(allowedOutput).not.toContain('Permission denied for external path access.');

        const exitCode = await waitForClose(child, 5000);
        expect(exitCode).not.toBeNull();
    }, 20000);
});


