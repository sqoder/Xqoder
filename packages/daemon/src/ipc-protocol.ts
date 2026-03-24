import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { XQODER_VERSION } from './generated/version.js';

/**
 * ipc-protocol.ts
 * Daemon（Node.js）↔ Client（Rust）通信协议
 *
 * 传输格式：每条消息是一行 JSON，以 \n 结尾（newline-delimited JSON）
 * 这样 Rust 客户端可以用 BufReader::lines() 简单读取
 */

// ─── Client → Daemon ──────────────────────────────────────────────────
// （用户的输入事件，从 Rust 客户端发向 Node.js daemon）

export type ClientMessage =
    | { type: 'key'; data: string }
    | { type: 'mouse'; seq: string }
    | { type: 'resize'; cols: number; rows: number }
    | { type: 'attach'; version: string }
    | { type: 'detach' }
    | { type: 'ping' };

// ─── Daemon → Client ──────────────────────────────────────────────────
// （渲染帧和控制消息，从 Node.js daemon 发向 Rust 客户端）

export interface CellUpdate {
    col: number;
    row: number;
    ch: string;
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
}

export type DaemonMessage =
    | { type: 'frame'; cells: CellUpdate[] }
    | { type: 'ansi'; data: string }
    | { type: 'ready'; version: string }
    | { type: 'pong' }
    | { type: 'restart' }
    | { type: 'error'; message: string; code?: string };

export type IPCMessage = ClientMessage | DaemonMessage;

// ─── 工具函数 ──────────────────────────────────────────────────────────

export function encodeMessage(msg: IPCMessage): Buffer {
    return Buffer.from(`${JSON.stringify(msg)}\n`, 'utf8');
}

function isIPCMessage(value: unknown): value is IPCMessage {
    return typeof value === 'object' && value !== null && 'type' in value;
}

export function decodeMessages(data: Buffer): IPCMessage[] {
    return data
        .toString('utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
            try {
                return JSON.parse(line) as unknown;
            } catch {
                return null;
            }
        })
        .filter(isIPCMessage);
}

// ─── Socket 路径 ───────────────────────────────────────────────────────

export interface DaemonRuntimePaths {
    version: string;
    channel: string;
    workspaceRoot: string;
    workspaceHash: string;
    runDirectory: string;
    socketPath: string;
    readyFilePath: string;
    pidFilePath: string;
    healthFilePath: string;
}

function normalizeChannel(): string {
    const raw = process.env.XQODER_CHANNEL?.trim() || 'stable';
    return raw.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function resolveWorkspaceRoot(): string {
    const candidate = process.env.XQODER_WORKSPACE_ROOT?.trim() || process.cwd();
    const resolved = resolve(candidate);
    try {
        return realpathSync(resolved);
    } catch {
        return resolved;
    }
}

function computeWorkspaceHash(workspaceRoot: string): string {
    return createHash('sha1').update(workspaceRoot).digest('hex').slice(0, 8);
}

function getRunBaseDirectory(): string {
    const override = process.env.XQODER_RUN_BASE_DIR?.trim();
    if (override) {
        return resolve(override);
    }
    const home = homedir();
    if (platform() === 'darwin') {
        return join(home, 'Library', 'Application Support', 'xqoder', 'run');
    }
    if (platform() === 'win32') {
        return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'xqoder', 'run');
    }
    return join(process.env.XDG_STATE_HOME || join(home, '.local', 'state'), 'xqoder', 'run');
}

export function getDaemonRuntimePaths(): DaemonRuntimePaths {
    const version = XQODER_VERSION;
    const channel = normalizeChannel();
    const workspaceRoot = resolveWorkspaceRoot();
    const workspaceHash = computeWorkspaceHash(workspaceRoot);
    const runDirectory = join(getRunBaseDirectory(), channel, `${workspaceHash}-v${version}`);
    const socketPath = platform() === 'win32'
        ? `\\\\.\\pipe\\xqoder-daemon-${channel}-${version}-${workspaceHash}`
        : join(runDirectory, 'daemon.sock');

    return {
        version,
        channel,
        workspaceRoot,
        workspaceHash,
        runDirectory,
        socketPath,
        readyFilePath: join(runDirectory, 'daemon.ready'),
        pidFilePath: join(runDirectory, 'daemon.pid'),
        healthFilePath: join(runDirectory, 'daemon.health.json'),
    };
}

export function getSocketPath(): string {
    return getDaemonRuntimePaths().socketPath;
}

// daemon ready 文件（client 等待这个文件出现再连接）
export function getReadyFilePath(): string {
    return getDaemonRuntimePaths().readyFilePath;
}

export function getPidFilePath(): string {
    return getDaemonRuntimePaths().pidFilePath;
}

export function getHealthFilePath(): string {
    return getDaemonRuntimePaths().healthFilePath;
}
