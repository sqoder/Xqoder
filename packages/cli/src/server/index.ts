// ============================================================
// XQoder HTTP Server — OpenCode 风格 API（最小实现）
// ============================================================

import * as http from 'node:http';
import * as url from 'node:url';
import { getXQoderVersion } from '../version.js';

export interface ServerOptions {
    port?: number;
    hostname?: string;
    cors?: string[];
    password?: string;
    username?: string;
}

export function createServer(options: ServerOptions = {}): http.Server {
    const port = options.port ?? 4096;
    const hostname = options.hostname ?? '127.0.0.1';
    const corsOrigins = new Set(options.cors ?? []);
    const authUser = options.username ?? 'xqoder';
    const authPass = options.password;

    const server = http.createServer((req, res) => {
        const parsed = url.parse(req.url ?? '/', true);
        const pathname = parsed.pathname ?? '/';

        // CORS preflight
        if (req.method === 'OPTIONS') {
            const origin = req.headers.origin;
            const allowOrigin = origin && (corsOrigins.has(origin) || corsOrigins.has('*'))
                ? origin
                : (corsOrigins.size > 0 ? Array.from(corsOrigins)[0] : '');
            res.writeHead(204, {
                'Access-Control-Allow-Origin': allowOrigin || '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            });
            res.end();
            return;
        }

        // Basic auth
        if (authPass) {
            const auth = req.headers.authorization;
            if (!auth?.startsWith('Basic ')) {
                res.writeHead(401, {
                    'WWW-Authenticate': 'Basic realm="XQoder"',
                    'Content-Type': 'application/json',
                });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
            const [user, pass] = decoded.split(':');
            if (user !== authUser || pass !== authPass) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
        }

        const origin = req.headers.origin;
        const allowOrigin = origin && corsOrigins.has(origin) ? origin : '*';
        const corsHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': allowOrigin,
        };

        // GET /global/health
        if (pathname === '/global/health' && req.method === 'GET') {
            res.writeHead(200, {
                ...corsHeaders,
                'Content-Type': 'application/json',
            });
            res.end(JSON.stringify({
                healthy: true,
                version: getXQoderVersion(),
            }));
            return;
        }

        // GET /doc — 占位
        if (pathname === '/doc' && req.method === 'GET') {
            res.writeHead(200, {
                ...corsHeaders,
                'Content-Type': 'text/html',
            });
            res.end(`<!DOCTYPE html><html><head><title>XQoder API</title></head><body>
<h1>XQoder Server API</h1>
<p>Minimal implementation. Full OpenCode parity coming soon.</p>
<p><a href="/global/health">/global/health</a> — Health check</p>
</body></html>`);
            return;
        }

        // 404
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
    });

    server.listen(port, hostname, () => {
        // 由调用方打印
    });

    return server;
}
