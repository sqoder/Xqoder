// P25a — Daemon IPC: Unix socket RPC protocol.
//
// Lightweight JSON-lines RPC over a Unix domain socket.
// Each message is a single JSON line terminated by '\n'.
// Request:  { id, method, params }
// Response: { id, result } | { id, error }

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

export const DEFAULT_SOCKET_PATH = '/tmp/xqoder-daemon.sock';

export interface RpcRequest {
    id: string;
    method: string;
    params?: unknown;
}

export interface RpcResponse {
    id: string;
    result?: unknown;
    error?: string;
}

export type RpcHandler = (method: string, params: unknown) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface IpcServer {
    close(): void;
}

export function createIpcServer(
    socketPath: string,
    handler: RpcHandler,
): Promise<IpcServer> {
    return new Promise((resolve, reject) => {
        // Remove stale socket
        if (fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
        }

        const server = net.createServer((socket) => {
            let buffer = '';

            socket.on('data', (chunk) => {
                buffer += chunk.toString('utf-8');
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    handleLine(line, socket, handler);
                }
            });

            socket.on('error', () => { /* ignore client disconnect errors */ });
        });

        server.on('error', reject);
        server.listen(socketPath, () => {
            resolve({
                close() {
                    server.close();
                    if (fs.existsSync(socketPath)) {
                        try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
                    }
                },
            });
        });
    });
}

async function handleLine(
    line: string,
    socket: net.Socket,
    handler: RpcHandler,
): Promise<void> {
    let req: RpcRequest;
    try {
        req = JSON.parse(line) as RpcRequest;
    } catch {
        return;
    }

    let response: RpcResponse;
    try {
        const result = await handler(req.method, req.params ?? null);
        response = { id: req.id, result };
    } catch (err) {
        response = { id: req.id, error: (err as Error).message ?? String(err) };
    }

    socket.write(JSON.stringify(response) + '\n');
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface IpcClient {
    call(method: string, params?: unknown): Promise<unknown>;
    close(): void;
}

export function createIpcClient(socketPath: string): Promise<IpcClient> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
        let buffer = '';

        socket.on('connect', () => {
            resolve({
                call(method: string, params?: unknown): Promise<unknown> {
                    return new Promise((res, rej) => {
                        const id = crypto.randomUUID();
                        pending.set(id, { resolve: res, reject: rej });
                        const req: RpcRequest = { id, method, params };
                        socket.write(JSON.stringify(req) + '\n');
                    });
                },
                close() {
                    socket.destroy();
                },
            });
        });

        socket.on('data', (chunk) => {
            buffer += chunk.toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const resp = JSON.parse(line) as RpcResponse;
                    const p = pending.get(resp.id);
                    if (!p) continue;
                    pending.delete(resp.id);
                    if (resp.error) {
                        p.reject(new Error(resp.error));
                    } else {
                        p.resolve(resp.result);
                    }
                } catch { /* ignore malformed */ }
            }
        });

        socket.on('error', (err) => {
            reject(err);
            for (const p of pending.values()) p.reject(err);
            pending.clear();
        });
    });
}

/**
 * Check if a daemon is already running at socketPath.
 * Returns true if a connection can be established.
 */
export async function isDaemonRunning(socketPath: string): Promise<boolean> {
    try {
        const client = await createIpcClient(socketPath);
        client.close();
        return true;
    } catch {
        return false;
    }
}
