// P25a — Daemon IPC unit tests.

import { afterEach, describe, expect, it } from 'bun:test';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
    createIpcServer,
    createIpcClient,
    isDaemonRunning,
    type IpcServer,
} from '../../../src/core/daemon/ipc.js';

function tmpSocket(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-ipc-'));
    return path.join(dir, 'test.sock');
}

describe('IPC server + client', () => {
    let server: IpcServer | null = null;

    afterEach(() => {
        server?.close();
        server = null;
    });

    it('ping/pong round-trip', async () => {
        const socketPath = tmpSocket();
        server = await createIpcServer(socketPath, async (method) => {
            if (method === 'ping') return { pong: true };
            throw new Error(`unknown: ${method}`);
        });

        const client = await createIpcClient(socketPath);
        const result = await client.call('ping');
        client.close();

        expect((result as Record<string, unknown>)['pong']).toBe(true);
    });

    it('error propagation', async () => {
        const socketPath = tmpSocket();
        server = await createIpcServer(socketPath, async (method) => {
            throw new Error(`method not found: ${method}`);
        });

        const client = await createIpcClient(socketPath);
        await expect(client.call('unknown')).rejects.toThrow(/method not found/);
        client.close();
    });

    it('multiple sequential calls', async () => {
        const socketPath = tmpSocket();
        let counter = 0;
        server = await createIpcServer(socketPath, async (method) => {
            if (method === 'inc') return ++counter;
            throw new Error('unknown');
        });

        const client = await createIpcClient(socketPath);
        const r1 = await client.call('inc');
        const r2 = await client.call('inc');
        const r3 = await client.call('inc');
        client.close();

        expect(r1).toBe(1);
        expect(r2).toBe(2);
        expect(r3).toBe(3);
    });

    it('isDaemonRunning returns false when no server', async () => {
        const socketPath = tmpSocket();
        const running = await isDaemonRunning(socketPath);
        expect(running).toBe(false);
    });

    it('isDaemonRunning returns true when server is up', async () => {
        const socketPath = tmpSocket();
        server = await createIpcServer(socketPath, async () => ({}));
        const running = await isDaemonRunning(socketPath);
        expect(running).toBe(true);
    });
});
