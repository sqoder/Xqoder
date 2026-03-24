import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, XQoderError } from '@xqoder/shared';
import { allowDebugFrameFallback, cleanupDaemonArtifacts, writeDaemonPidFile, writeDaemonRuntimeState } from './control.js';
import { createDaemonDoctorReport } from './doctor.js';
import {
    formatDaemonIdleTimeout,
    getDaemonIdleCheckIntervalMs,
    resolveDaemonIdleTimeout,
} from './idle-timeout.js';
import { decodeMessages, encodeMessage, getDaemonRuntimePaths, type ClientMessage } from './ipc-protocol.js';
import { XQODER_VERSION } from './generated/version.js';
import { SessionManager } from './session-manager.js';

const logger = new Logger('daemon');
const DAEMON_VERSION = XQODER_VERSION;

function isClientMessage(msg: unknown): msg is ClientMessage {
    if (!msg || typeof msg !== 'object' || !('type' in msg)) {
        return false;
    }

    const type = (msg as { type: unknown }).type;
    return type === 'ping'
        || type === 'key'
        || type === 'mouse'
        || type === 'resize'
        || type === 'attach'
        || type === 'detach';
}

export async function startDaemonServer(): Promise<void> {
    const runtimePaths = getDaemonRuntimePaths();
    const socketPath = runtimePaths.socketPath;
    const readyFile = runtimePaths.readyFilePath;
    const daemonDir = path.dirname(fileURLToPath(import.meta.url));
    const defaultCliEntrypoint = path.resolve(daemonDir, '../../cli/dist/index.js');
    const sessionMgr = new SessionManager({
        nodeBinary: process.env.XQODER_NODE ?? process.execPath,
        cliEntrypoint: process.env.XQODER_DAEMON_CLI ?? defaultCliEntrypoint,
    });
    const idleTimeout = resolveDaemonIdleTimeout(process.env);
    if (idleTimeout.warning) {
        logger.warn(idleTimeout.warning);
    }

    if (existsSync(socketPath)) {
        try {
            await unlink(socketPath);
        } catch {
            // ignore stale socket cleanup failures
        }
    }

    if (process.platform !== 'win32') {
        await mkdir(runtimePaths.runDirectory, { recursive: true });
    }

    const server = net.createServer((socket) => {
        logger.info('Client connected');
        const session = sessionMgr.createSession(socket);
        let pending = '';

        socket.write(encodeMessage({ type: 'ready', version: DAEMON_VERSION }));

        socket.on('data', (data: Buffer) => {
            pending += data.toString('utf8');
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            const messages = decodeMessages(Buffer.from(lines.join('\n'), 'utf8'));
            for (const msg of messages) {
                if (isClientMessage(msg)) {
                    sessionMgr.touch();
                    try {
                        session.handleClientMessage(msg);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        logger.error(`Session message handling failed: ${message}`);
                        if (error instanceof XQoderError && error.code === 'PTY_UNAVAILABLE') {
                            socket.end();
                            void shutdown('PTY_UNAVAILABLE', 1);
                            return;
                        }
                    }
                }
            }
        });

        socket.on('close', () => {
            logger.info('Client disconnected');
            sessionMgr.destroySession(session.id);
        });

        socket.on('error', (err: Error) => {
            logger.error(`Socket error: ${err.message}`);
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
            server.off('error', reject);
            resolve();
        });
    });

    logger.info(`Daemon listening on ${socketPath}`);
    await writeFile(readyFile, DAEMON_VERSION, 'utf8');
    writeDaemonPidFile(process.pid);
    const doctorReport = createDaemonDoctorReport(process.env.XQODER_NODE ?? process.execPath);
    writeDaemonRuntimeState({
        status: 'running',
        pid: process.pid,
        version: DAEMON_VERSION,
        channel: runtimePaths.channel,
        workspaceRoot: runtimePaths.workspaceRoot,
        workspaceHash: runtimePaths.workspaceHash,
        runDirectory: runtimePaths.runDirectory,
        socketPath,
        readyFilePath: readyFile,
        nodeBinary: process.env.XQODER_NODE ?? process.execPath,
        nodeVersion: process.version,
        spawnSupported: doctorReport.spawnSupported,
        lastHealthState: doctorReport.spawnSupported ? 'healthy' : 'pty-unavailable',
        frameFallbackAllowed: allowDebugFrameFallback(),
        mode: allowDebugFrameFallback() ? 'debug-fallback-allowed' : 'release-strict',
        idleTimeoutMs: idleTimeout.timeoutMs,
        idleTimeoutSource: idleTimeout.source,
        idleTimeoutDisabled: idleTimeout.disabled,
        startedAt: new Date().toISOString(),
    });
    if (idleTimeout.disabled) {
        logger.info('Daemon idle timeout disabled');
    } else {
        logger.info(`Daemon idle timeout set to ${formatDaemonIdleTimeout(idleTimeout.timeoutMs)}`);
    }

    let shuttingDown = false;
    let idleMonitor: NodeJS.Timeout | undefined;
    const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        logger.info(`Received ${signal}, shutting down...`);
        if (idleMonitor) {
            clearInterval(idleMonitor);
            idleMonitor = undefined;
        }

        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });

        writeDaemonRuntimeState({
            status: 'stopped',
            pid: null,
            version: DAEMON_VERSION,
            channel: runtimePaths.channel,
            workspaceRoot: runtimePaths.workspaceRoot,
            workspaceHash: runtimePaths.workspaceHash,
            runDirectory: runtimePaths.runDirectory,
            socketPath,
            readyFilePath: readyFile,
            nodeBinary: process.env.XQODER_NODE ?? process.execPath,
            nodeVersion: process.version,
            spawnSupported: doctorReport.spawnSupported,
            lastHealthState: signal === 'PTY_UNAVAILABLE' ? 'pty-unavailable' : 'stopped',
            frameFallbackAllowed: allowDebugFrameFallback(),
            mode: allowDebugFrameFallback() ? 'debug-fallback-allowed' : 'release-strict',
            idleTimeoutMs: idleTimeout.timeoutMs,
            idleTimeoutSource: idleTimeout.source,
            idleTimeoutDisabled: idleTimeout.disabled,
            stoppedAt: new Date().toISOString(),
        });
        cleanupDaemonArtifacts();

        process.exit(exitCode);
    };

    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });

    if (!idleTimeout.disabled) {
        idleMonitor = setInterval(() => {
            if (
                sessionMgr.activeCount() === 0
                && Date.now() - sessionMgr.lastActivityTime > idleTimeout.timeoutMs
            ) {
                logger.info(`No active sessions for ${formatDaemonIdleTimeout(idleTimeout.timeoutMs)}, exiting`);
                void shutdown('idle');
            }
        }, getDaemonIdleCheckIntervalMs(idleTimeout.timeoutMs));
        idleMonitor.unref?.();
    }
}

startDaemonServer().catch((err: unknown) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    logger.error(`Daemon startup failed: ${message}`);
    process.exit(1);
});
