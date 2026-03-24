import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as pty from 'node-pty';
import { getDaemonRuntimePaths, getHealthFilePath, getPidFilePath, getReadyFilePath, getSocketPath } from './ipc-protocol.js';

const require = createRequire(import.meta.url);

interface StoredRuntimeState {
    status?: string;
    pid?: number | null;
    version?: string;
    channel?: string;
    workspaceRoot?: string;
    workspaceHash?: string;
    runDirectory?: string;
    lastHealthState?: string;
    mode?: 'debug-fallback-allowed' | 'release-strict';
}

export interface PlatformSupportInfo {
    platform: string;
    arch: string;
    tier: 'supported' | 'partial' | 'preview' | 'unsupported';
    daemonMode: 'supported' | 'partial' | 'unsupported';
    rustClient: 'supported' | 'partial' | 'unsupported';
    rendererPackaging: 'supported' | 'partial' | 'unsupported';
    notes: string[];
}

export interface DaemonDoctorReport {
    nodeBinary: string;
    nodeVersion: string;
    nodeMajor: number | null;
    nodePtyVersion: string | null;
    nodePtyResolvedPath: string | null;
    nodePtyBuildMode: 'source-build' | 'prebuilt' | 'unknown' | 'missing';
    platformSupport: PlatformSupportInfo;
    preferredNode22Path: string | null;
    rebuildCommand: string;
    channel: string;
    workspaceRoot: string;
    workspaceHash: string;
    runDirectory: string;
    socketPath: string;
    readyFilePath: string;
    pidFilePath: string;
    healthFilePath: string;
    socketStale: boolean;
    readyFileStale: boolean;
    running: boolean;
    pid: number | null;
    version: string | null;
    frameFallbackAllowed: boolean;
    mode: 'debug-fallback-allowed' | 'release-strict';
    lastHealthState: string;
    spawnSupported: boolean;
    spawnError: string | null;
    suggestions: string[];
}

function parseMajor(version: string): number | null {
    const match = version.match(/v?(\d+)\./u);
    return match ? Number.parseInt(match[1] ?? '', 10) : null;
}

function detectPreferredNode22Path(): string | null {
    if (process.platform === 'darwin') {
        return '/opt/homebrew/opt/node@22/bin/node';
    }
    return null;
}

function detectNodePtyVersion(): string | null {
    try {
        const pkg = require('node-pty/package.json') as { version?: string };
        return pkg.version ?? null;
    } catch {
        return null;
    }
}

function detectNodePtyResolvedPath(): string | null {
    try {
        return require.resolve('node-pty');
    } catch {
        return null;
    }
}

function detectNodePtyPackageDir(): string | null {
    try {
        return path.dirname(require.resolve('node-pty/package.json'));
    } catch {
        return null;
    }
}

function detectNodePtyBuildMode(): DaemonDoctorReport['nodePtyBuildMode'] {
    const packageDir = detectNodePtyPackageDir();
    if (!packageDir) {
        return 'missing';
    }

    const sourceBuildArtifact = path.join(packageDir, 'build', 'Release', 'pty.node');
    if (fs.existsSync(sourceBuildArtifact)) {
        return 'source-build';
    }

    const prebuildsDir = path.join(packageDir, 'prebuilds');
    if (fs.existsSync(prebuildsDir)) {
        return 'prebuilt';
    }

    return 'unknown';
}

function detectPlatformSupport(): PlatformSupportInfo {
    const info: PlatformSupportInfo = {
        platform: process.platform,
        arch: process.arch,
        tier: 'unsupported',
        daemonMode: 'unsupported',
        rustClient: 'unsupported',
        rendererPackaging: 'unsupported',
        notes: [],
    };

    if (process.platform === 'darwin' && process.arch === 'arm64') {
        return {
            ...info,
            tier: 'supported',
            daemonMode: 'supported',
            rustClient: 'supported',
            rendererPackaging: 'supported',
            notes: ['Primary release target: daemon/client/PTy path is validated on macOS arm64.'],
        };
    }

    if (process.platform === 'darwin' && process.arch === 'x64') {
        return {
            ...info,
            tier: 'partial',
            daemonMode: 'partial',
            rustClient: 'supported',
            rendererPackaging: 'partial',
            notes: [
                'Daemon/client flow should work, but a packaged darwin-x64 renderer optionalDependency is not published yet.',
                'Use local renderer builds until a darwin-x64 package is added.',
            ],
        };
    }

    if (process.platform === 'linux' && process.arch === 'x64') {
        return {
            ...info,
            tier: 'partial',
            daemonMode: 'partial',
            rustClient: 'supported',
            rendererPackaging: 'partial',
            notes: [
                'Unix daemon/client flow is implemented, but Linux renderer platform packaging is not yet published.',
                'Treat Linux as preview for release packaging until a linux-x64 platform package exists.',
            ],
        };
    }

    if (process.platform === 'win32') {
        return {
            ...info,
            tier: 'preview',
            daemonMode: 'unsupported',
            rustClient: 'unsupported',
            rendererPackaging: 'unsupported',
            notes: [
                'Named-pipe scaffolding exists, but the daemon/client PTY architecture is not release-supported on Windows yet.',
                'Use the Node CLI path on Windows for now; do not rely on the Rust client or release PTY hosting.',
            ],
        };
    }

    return {
        ...info,
        notes: ['This platform is outside the validated release matrix.'],
    };
}

function readStoredRuntimeState(): StoredRuntimeState | null {
    const filePath = getHealthFilePath();
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredRuntimeState;
    } catch {
        return null;
    }
}

function readPid(): number | null {
    const filePath = getPidFilePath();
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
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

function allowDebugFrameFallback(): boolean {
    return process.env.XQODER_ALLOW_FRAME_FALLBACK === '1'
        && process.env.CI !== 'true'
        && process.env.NODE_ENV !== 'production';
}

function detectMode(): 'debug-fallback-allowed' | 'release-strict' {
    return allowDebugFrameFallback() ? 'debug-fallback-allowed' : 'release-strict';
}

function buildRebuildCommand(preferredNode22Path: string | null): string {
    const prefix = preferredNode22Path
        ? `PATH="${path.dirname(preferredNode22Path)}:$PATH" `
        : '';
    return `${prefix}npm_config_build_from_source=true pnpm rebuild node-pty --filter @xqoder/daemon`;
}

function buildSuggestions(nodeMajor: number | null, rebuildCommand: string, preferredNode22Path: string | null): string[] {
    const suggestions = [
        `Rebuild node-pty from source: ${rebuildCommand}`,
        'For local debugging only, allow frame fallback temporarily: XQODER_ALLOW_FRAME_FALLBACK=1',
        'Re-run: xqoder daemon doctor',
    ];

    if (nodeMajor !== null && nodeMajor > 22) {
        if (preferredNode22Path) {
            suggestions.unshift(`Prefer Node 22 for daemon PTY mode: export PATH="${path.dirname(preferredNode22Path)}:$PATH"`);
        } else {
            suggestions.unshift('Prefer Node 22 LTS for daemon PTY mode');
        }
    }

    if (process.platform === 'win32') {
        suggestions.unshift('Windows currently uses the Node CLI path; daemon/client PTY mode is preview only.');
    }

    return suggestions;
}

function trySpawnPty(nodeBinary: string): { ok: true } | { ok: false; error: string } {
    try {
        const term = pty.spawn(nodeBinary, ['-v'], {
            name: process.env.TERM ?? 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: process.cwd(),
            env: process.env,
        });
        term.kill();
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export function createDaemonDoctorReport(nodeBinary: string = process.execPath): DaemonDoctorReport {
    const nodeVersion = process.version;
    const nodeMajor = parseMajor(nodeVersion);
    const preferredNode22Path = detectPreferredNode22Path();
    const rebuildCommand = buildRebuildCommand(preferredNode22Path);
    const spawnAttempt = trySpawnPty(nodeBinary);
    const runtimePaths = getDaemonRuntimePaths();
    const runtimeState = readStoredRuntimeState();
    const platformSupport = detectPlatformSupport();
    const pid = readPid() ?? runtimeState?.pid ?? null;
    const running = processExists(pid);
    const socketPath = runtimePaths.socketPath;
    const readyFilePath = runtimePaths.readyFilePath;

    return {
        nodeBinary,
        nodeVersion,
        nodeMajor,
        nodePtyVersion: detectNodePtyVersion(),
        nodePtyResolvedPath: detectNodePtyResolvedPath(),
        nodePtyBuildMode: detectNodePtyBuildMode(),
        platformSupport,
        preferredNode22Path,
        rebuildCommand,
        channel: runtimeState?.channel ?? runtimePaths.channel,
        workspaceRoot: runtimeState?.workspaceRoot ?? runtimePaths.workspaceRoot,
        workspaceHash: runtimeState?.workspaceHash ?? runtimePaths.workspaceHash,
        runDirectory: runtimeState?.runDirectory ?? runtimePaths.runDirectory,
        socketPath,
        readyFilePath,
        pidFilePath: runtimePaths.pidFilePath,
        healthFilePath: runtimePaths.healthFilePath,
        socketStale: fs.existsSync(socketPath) && !running,
        readyFileStale: fs.existsSync(readyFilePath) && !running,
        running,
        pid,
        version: runtimeState?.version ?? runtimePaths.version,
        frameFallbackAllowed: allowDebugFrameFallback(),
        mode: runtimeState?.mode ?? detectMode(),
        lastHealthState: runtimeState?.lastHealthState ?? 'unknown',
        spawnSupported: spawnAttempt.ok,
        spawnError: spawnAttempt.ok ? null : spawnAttempt.error,
        suggestions: buildSuggestions(nodeMajor, rebuildCommand, preferredNode22Path),
    };
}

export function formatDaemonDoctorReport(report: DaemonDoctorReport): string {
    const lines = [
        'XQoder Daemon Doctor',
        '',
        `Node binary: ${report.nodeBinary}`,
        `Node version: ${report.nodeVersion}`,
        `node-pty version: ${report.nodePtyVersion ?? 'unavailable'}`,
        `node-pty path: ${report.nodePtyResolvedPath ?? 'unresolved'}`,
        `node-pty build mode: ${report.nodePtyBuildMode}`,
        `platform support tier: ${report.platformSupport.tier}`,
        `daemon/client mode: ${report.platformSupport.daemonMode}`,
        `rust client mode: ${report.platformSupport.rustClient}`,
        `renderer packaging: ${report.platformSupport.rendererPackaging}`,
        `channel: ${report.channel}`,
        `workspace root: ${report.workspaceRoot}`,
        `workspace hash: ${report.workspaceHash}`,
        `run directory: ${report.runDirectory}`,
        `daemon running: ${report.running}`,
        `daemon pid: ${report.pid ?? 'unavailable'}`,
        `socket path: ${report.socketPath}`,
        `ready file: ${report.readyFilePath}`,
        `socket stale: ${report.socketStale}`,
        `ready stale: ${report.readyFileStale}`,
        `mode: ${report.mode}`,
        `frame fallback allowed: ${report.frameFallbackAllowed}`,
        `last health state: ${report.lastHealthState}`,
        `PTY spawn: ${report.spawnSupported ? 'ok' : 'failed'}`,
    ];

    if (report.spawnError) {
        lines.push(`Spawn error: ${report.spawnError}`);
    }

    if (report.preferredNode22Path) {
        lines.push(`Suggested Node 22 path: ${report.preferredNode22Path}`);
    }

    if (report.platformSupport.notes.length > 0) {
        lines.push('', 'Platform notes:');
        report.platformSupport.notes.forEach((note, index) => {
            lines.push(`${index + 1}. ${note}`);
        });
    }

    lines.push('', 'Suggestions:');
    report.suggestions.forEach((suggestion, index) => {
        lines.push(`${index + 1}. ${suggestion}`);
    });

    return lines.join('\n');
}

export function createHostedTuiFallbackMessage(error: unknown, report: DaemonDoctorReport): string {
    const base = error instanceof Error ? error.message : String(error);
    return [
        `Hosted TUI unavailable: ${base}`,
        `Node: ${report.nodeVersion} (${report.nodeBinary})`,
        `node-pty: ${report.nodePtyVersion ?? 'unavailable'}`,
        `Try: ${report.rebuildCommand}`,
        'Diagnose: xqoder daemon doctor',
    ].join(' | ');
}
