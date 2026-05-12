// P21b — Local loopback HTTP server for OAuth authorization_code callback.
//
// Starts a short-lived HTTP server on a user-chosen loopback port, awaits a
// single `GET /callback?code=...&state=...`, responds with a human-readable
// success page, and resolves with the code. Designed for desktop CLI OAuth
// flows where the user's browser redirects to `http://127.0.0.1:<port>/callback`.
//
// Explicitly loopback-only: listens on 127.0.0.1. `host: 0.0.0.0` is refused.
// The caller is responsible for timeout / cancellation via AbortSignal.

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CallbackResult {
    readonly code: string;
    readonly state?: string;
}

export interface StartCallbackServerOptions {
    /** Preferred port. When omitted the OS assigns an ephemeral port. */
    readonly port?: number;
    /** Path the redirect URI points to (default '/callback'). */
    readonly path?: string;
    /** Body served on success. Default: short plain-text message. */
    readonly successBody?: string;
    /** Body served on error. Default: short plain-text message. */
    readonly errorBody?: string;
    /** Optional signal to abort waiting. Server is closed on abort. */
    readonly signal?: AbortSignal;
}

export interface RunningCallbackServer {
    readonly port: number;
    readonly redirectUri: string;
    readonly done: Promise<CallbackResult>;
    close(): Promise<void>;
}

const DEFAULT_SUCCESS_BODY = 'XQoder OAuth: authorization received. You may close this tab.\n';
const DEFAULT_ERROR_BODY = 'XQoder OAuth: authorization failed.\n';

export function startCallbackServer(
    options: StartCallbackServerOptions = {},
): Promise<RunningCallbackServer> {
    const path = options.path ?? '/callback';
    const successBody = options.successBody ?? DEFAULT_SUCCESS_BODY;
    const errorBody = options.errorBody ?? DEFAULT_ERROR_BODY;

    return new Promise<RunningCallbackServer>((resolve, reject) => {
        let resolveDone!: (result: CallbackResult) => void;
        let rejectDone!: (err: Error) => void;
        const done = new Promise<CallbackResult>((r, j) => {
            resolveDone = r;
            rejectDone = j;
        });

        const server = http.createServer((req, res) => {
            try {
                const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
                if (requestUrl.pathname !== path) {
                    res.writeHead(404, { 'content-type': 'text/plain' });
                    res.end('not found\n');
                    return;
                }
                const error = requestUrl.searchParams.get('error');
                if (error) {
                    res.writeHead(400, { 'content-type': 'text/plain' });
                    res.end(errorBody);
                    rejectDone(new Error(`OAuth callback error: ${error}`));
                    return;
                }
                const code = requestUrl.searchParams.get('code');
                if (!code) {
                    res.writeHead(400, { 'content-type': 'text/plain' });
                    res.end(errorBody);
                    rejectDone(new Error('OAuth callback missing code'));
                    return;
                }
                res.writeHead(200, { 'content-type': 'text/plain' });
                res.end(successBody);
                const state = requestUrl.searchParams.get('state') ?? undefined;
                resolveDone(state !== undefined ? { code, state } : { code });
            } catch (err) {
                rejectDone(err instanceof Error ? err : new Error(String(err)));
            }
        });

        server.on('error', (err) => reject(err));

        server.listen(options.port ?? 0, '127.0.0.1', () => {
            const address = server.address() as AddressInfo | null;
            if (!address) {
                reject(new Error('callback server failed to bind'));
                return;
            }
            const port = address.port;
            const redirectUri = `http://127.0.0.1:${port}${path}`;

            const close = (): Promise<void> => new Promise<void>((r) => {
                server.close(() => r());
            });

            if (options.signal) {
                const onAbort = (): void => {
                    rejectDone(new Error('OAuth callback aborted'));
                    void close();
                };
                if (options.signal.aborted) {
                    onAbort();
                } else {
                    options.signal.addEventListener('abort', onAbort, { once: true });
                }
            }

            resolve({ port, redirectUri, done, close });
        });
    });
}
