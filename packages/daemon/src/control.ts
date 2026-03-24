import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    getDaemonRuntimePaths,
    getHealthFilePath,
    getPidFilePath,
    getReadyFilePath,
    getSocketPath,
} from './ipc-protocol.js';
import { createDaemonDoctorReport, type DaemonDoctorReport } from './doctor.js';

export interface DaemonRuntimeState {
    status: 'running' | 'stopped';
    pid: number | null;
    version: string;
    channel: string;
    workspaceRoot: string;
    workspaceHash: string;
    runDirectory: string;
    socketPath: string;
    readyFilePath: string;
    nodeBinary: string;
    nodeVersion: string;
    spawnSupported: boolean;
    lastHealthState: string;
    frameFallbackAllowed: boolean;
    mode: 'debug-fallback-allowed' | 'release-strict';
    idleTimeoutMs?: number;
    idleTimeoutSource?: 'default' | 'env';
    idleTimeoutDisabled?: boolean;
    startedAt?: string;
    stoppedAt?: string;
}

export interface DaemonStatusSnapshot {
    running: boolean;
    pid: number | null;
    channel: string;
    workspaceRoot: string;
    workspaceHash: string;
    runDirectory: string;
    socketPath: string;
    readyFilePath: string;
    pidFilePath: string;
    healthFilePath: string;
    version: string | null;
    spawnSupported: boolean;
    lastHealthState: string;
    mode: 'debug-fallback-allowed' | 'release-strict';
    socketStale: boolean;
    readyFileStale: boolean;
}

export interface DaemonStartResult {
    status: 'started' | 'already-running';
    snapshot: DaemonStatusSnapshot;
}

export interface DaemonStopResult {
    status: 'stopped' | 'already-stopped';
    snapshot: DaemonStatusSnapshot;
}

function processExists(pid: number | null): boolean {
    if (!pid || !Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readPidFile(): number | null {
    const pidFilePath = getPidFilePath();
    if (!fs.existsSync(pidFilePath)) {
        return null;
    }
    const raw = fs.readFileSync(pidFilePath, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function allowDebugFrameFallback(): boolean {
    return process.env.XQODER_ALLOW_FRAME_FALLBACK === '1'
        && process.env.CI !== 'true'
        && process.env.NODE_ENV !== 'production';
}

function detectMode(): 'debug-fallback-allowed' | 'release-strict' {
    return allowDebugFrameFallback() ? 'debug-fallback-allowed' : 'release-strict';
}

export function readDaemonRuntimeState(): DaemonRuntimeState | null {
    const filePath = getHealthFilePath();
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw) as DaemonRuntimeState;
    } catch {
        return null;
    }
}

export function writeDaemonRuntimeState(state: DaemonRuntimeState): void {
    fs.mkdirSync(path.dirname(getHealthFilePath()), { recursive: true });
    fs.writeFileSync(getHealthFilePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function writeDaemonPidFile(pid: number): void {
    fs.mkdirSync(path.dirname(getPidFilePath()), { recursive: true });
    fs.writeFileSync(getPidFilePath(), `${pid}\n`, 'utf8');
}

export function cleanupDaemonArtifacts(): void {
    for (const filePath of [getSocketPath(), getReadyFilePath(), getPidFilePath()]) {
        try {
            fs.unlinkSync(filePath);
        } catch {
            // ignore cleanup errors
        }
    }
}

export function createDaemonStatusSnapshot(report: DaemonDoctorReport = createDaemonDoctorReport(process.execPath)): DaemonStatusSnapshot {
    const runtimePaths = getDaemonRuntimePaths();
    const runtimeState = readDaemonRuntimeState();
    const pid = readPidFile() ?? runtimeState?.pid ?? null;
    const running = processExists(pid);
    const socketPath = runtimePaths.socketPath;
    const readyFilePath = runtimePaths.readyFilePath;
    const socketExists = fs.existsSync(socketPath);
    const readyExists = fs.existsSync(readyFilePath);

    return {
        running,
        pid,
        channel: runtimeState?.channel ?? runtimePaths.channel,
        workspaceRoot: runtimeState?.workspaceRoot ?? runtimePaths.workspaceRoot,
        workspaceHash: runtimeState?.workspaceHash ?? runtimePaths.workspaceHash,
        runDirectory: runtimeState?.runDirectory ?? runtimePaths.runDirectory,
        socketPath,
        readyFilePath,
        pidFilePath: runtimePaths.pidFilePath,
        healthFilePath: runtimePaths.healthFilePath,
        version: runtimeState?.version ?? runtimePaths.version,
        spawnSupported: report.spawnSupported,
        lastHealthState: runtimeState?.lastHealthState ?? 'unknown',
        mode: runtimeState?.mode ?? detectMode(),
        socketStale: socketExists && !running,
        readyFileStale: readyExists && !running,
    };
}

function defaultDaemonEntry(): string {
    const daemonDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(daemonDir, './server.js');
}

function waitForReady(timeoutMs = 5000): boolean {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (fs.existsSync(getReadyFilePath())) {
            return true;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
    return false;
}

export function startDaemonProcess(options?: { nodeBinary?: string; daemonEntry?: string }): DaemonStartResult {
    const doctor = createDaemonDoctorReport(process.execPath);
    const current = createDaemonStatusSnapshot(doctor);
    if (current.running) {
        return { status: 'already-running', snapshot: current };
    }

    cleanupDaemonArtifacts();
    const nodeBinary = options?.nodeBinary ?? process.env.XQODER_NODE ?? process.execPath;
    const daemonEntry = options?.daemonEntry ?? process.env.XQODER_DAEMON ?? defaultDaemonEntry();
    const workspaceRoot = process.env.XQODER_WORKSPACE_ROOT ?? process.cwd();
    const child = spawn(nodeBinary, [daemonEntry], {
        detached: true,
        stdio: 'ignore',
        cwd: workspaceRoot,
        env: {
            ...process.env,
            XQODER_NODE: nodeBinary,
            XQODER_WORKSPACE_ROOT: workspaceRoot,
        },
    });
    child.unref();

    if (!waitForReady()) {
        throw new Error(`daemon did not become ready in time: ${daemonEntry}`);
    }

    return {
        status: 'started',
        snapshot: createDaemonStatusSnapshot(createDaemonDoctorReport(nodeBinary)),
    };
}

export function stopDaemonProcess(): DaemonStopResult {
    const before = createDaemonStatusSnapshot();
    if (!before.running || before.pid === null) {
        cleanupDaemonArtifacts();
        return { status: 'already-stopped', snapshot: createDaemonStatusSnapshot() };
    }

    try {
        process.kill(before.pid, 'SIGTERM');
    } catch {
        // ignore and continue cleanup
    }

    const start = Date.now();
    while (Date.now() - start < 5000) {
        if (!processExists(before.pid)) {
            break;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }

    cleanupDaemonArtifacts();
    return { status: 'stopped', snapshot: createDaemonStatusSnapshot() };
}
