import * as net from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { type Writable } from 'node:stream';
import {
    type Logger,
    type LSPServerConfig,
    type LSPStdioServerConfig,
    type LSPTcpServerConfig,
} from '@xqoder/shared';
import {
    connectTcpSocket,
    isTcpServerConfig,
    resolveServerCwd,
} from './lsp-utils.js';

export interface LspClientTransportOptions {
    cwd: string;
    projectRoot: string;
    logger: Logger;
    onData: (chunk: Buffer) => void;
    onTransportError: (error: Error) => void;
}

export interface LspClientTransportControllerInput {
    output: Writable;
    child?: ChildProcessWithoutNullStreams;
    bootstrapChild?: ChildProcessWithoutNullStreams;
    socket?: net.Socket;
}

export class LspClientTransportController {
    private readonly outputStream: Writable;
    private child?: ChildProcessWithoutNullStreams;
    private bootstrapChild?: ChildProcessWithoutNullStreams;
    private socket?: net.Socket;
    private closed = false;

    constructor(input: LspClientTransportControllerInput) {
        this.outputStream = input.output;
        this.child = input.child;
        this.bootstrapChild = input.bootstrapChild;
        this.socket = input.socket;
    }

    get output(): Writable {
        return this.outputStream;
    }

    async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        this.closed = true;

        const child = this.child;
        const bootstrapChild = this.bootstrapChild;
        const socket = this.socket;

        this.child = undefined;
        this.bootstrapChild = undefined;
        this.socket = undefined;

        if (child) {
            child.stdout.removeAllListeners();
            child.stderr.removeAllListeners();
            if (!child.killed) {
                child.kill();
            }
        }

        if (socket) {
            socket.removeAllListeners();
            socket.destroy();
        }

        if (bootstrapChild) {
            bootstrapChild.stdout.removeAllListeners();
            bootstrapChild.stderr.removeAllListeners();
            if (!bootstrapChild.killed) {
                bootstrapChild.kill();
            }
        }

        await waitForExit(child);
        await waitForExit(bootstrapChild);
    }
}

export async function startLspClientTransport(
    config: LSPServerConfig,
    options: LspClientTransportOptions,
): Promise<LspClientTransportController> {
    if (isTcpServerConfig(config)) {
        return startTcpTransport(config, options);
    }

    return startStdioTransport(config as LSPStdioServerConfig, options);
}

async function startStdioTransport(
    config: LSPStdioServerConfig,
    options: LspClientTransportOptions,
): Promise<LspClientTransportController> {
    const child = spawn(config.command, config.args ?? [], {
        cwd: resolveServerCwd(config.cwd, options.projectRoot, options.cwd),
        env: {
            ...process.env,
            ...(config.env ?? {}),
        },
        stdio: 'pipe',
    }) as unknown as ChildProcessWithoutNullStreams;

    child.stdout.on('data', (chunk: Buffer | string) => {
        options.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
    });
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
        logTransportLines(options.logger, chunk);
    });
    child.once('error', (error) => {
        options.onTransportError(new Error(`LSP process failed to start: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
        const reason = code !== null
            ? `Exit code ${code}`
            : `Signal ${signal ?? 'unknown'}`;
        options.onTransportError(new Error(`LSP process exited (${reason})`));
    });

    return new LspClientTransportController({
        child,
        output: child.stdin,
    });
}

async function startTcpTransport(
    config: LSPTcpServerConfig,
    options: LspClientTransportOptions,
): Promise<LspClientTransportController> {
    const bootstrapChild = startTcpBootstrap(config, options);
    const socket = await connectTcpSocket({
        host: config.host,
        port: config.port,
        timeoutMs: config.timeoutMs ?? 15_000,
    });

    socket.on('data', (chunk: Buffer | string) => {
        options.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
    });
    socket.on('error', (error) => {
        options.onTransportError(new Error(`LSP TCP connection error: ${error.message}`));
    });
    socket.on('close', () => {
        options.onTransportError(new Error(`LSP TCP connection closed: ${config.host}:${config.port}`));
    });

    return new LspClientTransportController({
        bootstrapChild,
        socket,
        output: socket,
    });
}

function startTcpBootstrap(
    config: LSPTcpServerConfig,
    options: LspClientTransportOptions,
): ChildProcessWithoutNullStreams | undefined {
    if (!config.command) {
        return undefined;
    }

    const child = spawn(config.command, config.args ?? [], {
        cwd: resolveServerCwd(config.cwd, options.projectRoot, options.cwd),
        env: {
            ...process.env,
            ...(config.env ?? {}),
        },
        stdio: 'pipe',
    }) as unknown as ChildProcessWithoutNullStreams;

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
        logTransportLines(options.logger, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
        logTransportLines(options.logger, chunk);
    });
    child.once('error', (error) => {
        options.logger.warn(`TCP LSP bootstrap failed: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
        const reason = code !== null
            ? `Exit code ${code}`
            : `Signal ${signal ?? 'unknown'}`;
        options.logger.debug(`TCP LSP bootstrap exited (${reason})`);
    });

    return child;
}

function logTransportLines(logger: Logger, chunk: string): void {
    for (const line of chunk.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
        logger.warn(line);
    }
}

async function waitForExit(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
        return;
    }

    try {
        await once(child, 'exit');
    } catch {
        // ignore
    }
}
