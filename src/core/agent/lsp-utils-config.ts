import * as net from 'node:net';
import * as path from 'node:path';
import type { LSPServerConfig, LSPTcpServerConfig } from '@xqoder/shared';

export function parseContentLength(header: string): number | null {
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
        return null;
    }
    return Number.parseInt(match[1] ?? '', 10);
}

export function supportsProvider(value: unknown): boolean {
    return value === true || (typeof value === 'object' && value !== null);
}

export function isTcpServerConfig(config: LSPServerConfig): config is LSPTcpServerConfig {
    return config.transport === 'tcp';
}

export function resolveServerCwd(configuredCwd: string | undefined, projectRoot: string, fallbackCwd: string): string {
    if (!configuredCwd) {
        return fallbackCwd;
    }
    return path.isAbsolute(configuredCwd)
        ? configuredCwd
        : path.resolve(projectRoot, configuredCwd);
}

export async function connectTcpSocket(input: {
    host: string;
    port: number;
    timeoutMs: number;
}): Promise<net.Socket> {
    const startedAt = Date.now();
    let lastError: Error | undefined;

    while (Date.now() - startedAt < input.timeoutMs) {
        try {
            return await new Promise<net.Socket>((resolve, reject) => {
                const socket = net.createConnection({
                    host: input.host,
                    port: input.port,
                });
                const attemptTimeout = Math.max(150, Math.min(1_000, input.timeoutMs));
                const timer = setTimeout(() => {
                    socket.destroy(new Error('TCP connection timeout'));
                }, attemptTimeout);

                const cleanup = () => {
                    clearTimeout(timer);
                    socket.off('connect', handleConnect);
                    socket.off('error', handleError);
                };
                const handleConnect = () => {
                    cleanup();
                    socket.setNoDelay(true);
                    resolve(socket);
                };
                const handleError = (error: Error) => {
                    cleanup();
                    socket.destroy();
                    reject(error);
                };

                socket.once('connect', handleConnect);
                socket.once('error', handleError);
            });
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            await delay(75);
        }
    }

    throw new Error(`Unable to connect to TCP LSP ${input.host}:${input.port}: ${lastError?.message ?? 'unknown error'}`);
}

export function resolveLanguageId(config: LSPServerConfig, filePath: string): string {
    if (config.languageId) {
        return config.languageId;
    }
    const extension = path.extname(filePath).replace(/^\./, '');
    return extension || 'plaintext';
}

export function toLspPosition(line: number, character: number): { line: number; character: number } {
    return {
        line: Math.max(0, Math.floor(line) - 1),
        character: Math.max(0, Math.floor(character) - 1),
    };
}

export function formatServerMessage(params: unknown): string {
    if (!params || typeof params !== 'object') {
        return String(params ?? '');
    }

    const candidate = params as Record<string, unknown>;
    if (typeof candidate['message'] === 'string') {
        return candidate['message'];
    }

    return JSON.stringify(candidate);
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
