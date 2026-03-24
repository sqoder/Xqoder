import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import type * as http from 'node:http';

type FetchLike = typeof fetch;

interface NormalizedRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
}

function normalizeHeaders(raw: HeadersInit | undefined): Record<string, string> {
    if (!raw) {
        return {};
    }
    if (raw instanceof Headers) {
        const normalized: Record<string, string> = {};
        raw.forEach((value, key) => {
            normalized[key.toLowerCase()] = value;
        });
        return normalized;
    }
    if (Array.isArray(raw)) {
        return Object.fromEntries(raw.map(([key, value]) => [key.toLowerCase(), value]));
    }
    return Object.fromEntries(
        Object.entries(raw).map(([key, value]) => [key.toLowerCase(), String(value)]),
    );
}

async function normalizeRequest(input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]): Promise<NormalizedRequest> {
    if (input instanceof Request) {
        return {
            method: init?.method ?? input.method ?? 'GET',
            url: new URL(input.url).pathname + new URL(input.url).search,
            headers: {
                ...normalizeHeaders(input.headers),
                ...normalizeHeaders(init?.headers),
            },
            body: init?.body != null
                ? String(init.body)
                : (input.bodyUsed ? '' : await input.text()),
        };
    }

    const url = input instanceof URL ? input : new URL(String(input), 'http://in-memory.test');
    const bodyInit = init?.body;
    let body = '';
    if (typeof bodyInit === 'string') {
        body = bodyInit;
    } else if (bodyInit instanceof URLSearchParams) {
        body = bodyInit.toString();
    } else if (bodyInit instanceof Uint8Array) {
        body = Buffer.from(bodyInit).toString('utf8');
    } else if (bodyInit instanceof ArrayBuffer) {
        body = Buffer.from(bodyInit).toString('utf8');
    } else if (bodyInit != null) {
        body = String(bodyInit);
    }

    return {
        method: init?.method ?? 'GET',
        url: url.pathname + url.search,
        headers: normalizeHeaders(init?.headers),
        body,
    };
}

function createMockRequest(request: NormalizedRequest): http.IncomingMessage {
    const req = new EventEmitter() as http.IncomingMessage & EventEmitter;
    req.method = request.method;
    req.url = request.url;
    req.headers = request.headers;

    queueMicrotask(() => {
        if (request.body.length > 0) {
            req.emit('data', Buffer.from(request.body, 'utf8'));
        }
        req.emit('end');
    });

    return req;
}

function createMockResponse(): {
    response: Promise<Response>;
    res: http.ServerResponse & EventEmitter;
} {
    const emitter = new EventEmitter();
    let status = 200;
    const headers = new Headers();
    let writableEnded = false;
    let resolveHeaders: (() => void) | null = null;
    const headersReady = new Promise<void>((resolve) => {
        resolveHeaders = resolve;
    });

    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
            controller = ctrl;
        },
        cancel() {
            emitter.emit('close');
        },
    });

    const ensureHeaders = (): void => {
        if (!resolveHeaders) {
            return;
        }
        resolveHeaders();
        resolveHeaders = null;
    };

    const writeChunk = (chunk: string | Buffer): void => {
        if (!controller) {
            return;
        }
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
        controller.enqueue(new Uint8Array(buffer));
    };

    const res = emitter as http.ServerResponse & EventEmitter;
    Object.defineProperty(res, 'writableEnded', {
        get: () => writableEnded,
    });
    res.writeHead = ((statusCode: number, headerMap?: Record<string, string>) => {
        status = statusCode;
        for (const [key, value] of Object.entries(headerMap ?? {})) {
            headers.set(key, value);
        }
        ensureHeaders();
        return res;
    }) as http.ServerResponse['writeHead'];
    res.write = ((chunk: string | Buffer) => {
        ensureHeaders();
        writeChunk(chunk);
        return true;
    }) as http.ServerResponse['write'];
    res.end = ((chunk?: string | Buffer) => {
        if (chunk != null) {
            res.write(chunk);
        } else {
            ensureHeaders();
        }
        if (!writableEnded) {
            writableEnded = true;
            controller?.close();
            queueMicrotask(() => {
                emitter.emit('close');
                emitter.emit('finish');
            });
        }
        return res;
    }) as http.ServerResponse['end'];

    return {
        res,
        response: headersReady.then(() => new Response(stream, {
            status,
            headers,
        })),
    };
}

export function createInMemoryFetch(handler: http.RequestListener): FetchLike {
    return (async (input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]) => {
        const request = await normalizeRequest(input, init);
        const req = createMockRequest(request);
        const { res, response } = createMockResponse();

        Promise.resolve(handler(req, res)).catch((error) => {
            if (res.writableEnded) {
                return;
            }
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
            }));
        });

        return response;
    }) as FetchLike;
}
