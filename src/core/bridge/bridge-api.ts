// P25b — Bridge API: HTTP endpoints for bridge pairing + message relay.
//
// Exposes two endpoints:
//   POST /api/bridge/pair   — exchange pairing code for JWT
//   GET  /api/bridge/status — check bridge health (requires JWT)

import * as http from 'node:http';
import { redeemPairingCode, validateBridgeJwt } from './pairing.js';

export interface BridgeApiOptions {
    port?: number;
    hostname?: string;
}

export interface BridgeApiServer {
    port: number;
    close(): void;
}

function extractBearer(req: http.IncomingMessage): string | null {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) return null;
    return auth.slice(7);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

export function createBridgeApiServer(options: BridgeApiOptions = {}): Promise<BridgeApiServer> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const url = req.url ?? '';
            const method = req.method ?? 'GET';

            if (method === 'POST' && url === '/api/bridge/pair') {
                let body: Record<string, unknown>;
                try {
                    body = JSON.parse(await readBody(req)) as Record<string, unknown>;
                } catch {
                    return json(res, 400, { error: 'invalid JSON' });
                }
                const code = typeof body['code'] === 'string' ? body['code'] : '';
                const jwt = redeemPairingCode(code);
                if (!jwt) {
                    return json(res, 401, { error: 'invalid or expired pairing code' });
                }
                return json(res, 200, { jwt });
            }

            if (method === 'GET' && url === '/api/bridge/status') {
                const token = extractBearer(req);
                if (!token || !validateBridgeJwt(token)) {
                    return json(res, 401, { error: 'unauthorized' });
                }
                return json(res, 200, { status: 'ok', pid: process.pid });
            }

            json(res, 404, { error: 'not found' });
        });

        server.on('error', reject);
        server.listen(options.port ?? 0, options.hostname ?? '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({
                port: addr.port,
                close() { server.close(); },
            });
        });
    });
}
