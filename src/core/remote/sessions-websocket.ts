// P25c — Sessions WebSocket: client-side WS connection to a remote bridge.
//
// Connects to the bridge HTTP server's WebSocket endpoint, sends
// ConversationEventEnvelopes, and handles reconnect with exponential backoff.
// v1 uses the Node.js built-in WebSocket (Node 22+) or falls back to a
// simple EventEmitter stub for environments without native WS.

import { EventEmitter } from 'node:events';

export interface SessionsWebSocketOptions {
    url: string;
    jwt: string;
    maxReconnectAttempts?: number;
    baseBackoffMs?: number;
}

export type WebSocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export class SessionsWebSocket extends EventEmitter {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts: number;
    private readonly baseBackoffMs: number;
    private closed = false;

    status: WebSocketStatus = 'closed';

    constructor(private readonly options: SessionsWebSocketOptions) {
        super();
        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
        this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    }

    open(): void {
        if (this.closed) return;
        this.status = 'connecting';
        this.emit('status', 'connecting');

        try {
            // Node 22+ has native WebSocket; older versions will throw
            this.ws = new WebSocket(this.options.url, {
                headers: { Authorization: `Bearer ${this.options.jwt}` },
            } as unknown as string[]);
        } catch {
            // WebSocket not available — emit error and stop
            this.status = 'error';
            this.emit('error', new Error('WebSocket not available in this runtime'));
            return;
        }

        this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            this.status = 'open';
            this.emit('status', 'open');
        };

        this.ws.onmessage = (event) => {
            this.emit('message', event.data);
        };

        this.ws.onerror = (event) => {
            this.emit('error', event);
        };

        this.ws.onclose = () => {
            if (!this.closed) {
                this.reconnectWithBackoff();
            } else {
                this.status = 'closed';
                this.emit('status', 'closed');
            }
        };
    }

    send(data: unknown): void {
        if (this.ws?.readyState === 1 /* OPEN */) {
            this.ws.send(JSON.stringify(data));
        }
    }

    close(): void {
        this.closed = true;
        this.ws?.close();
        this.status = 'closed';
    }

    private reconnectWithBackoff(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.status = 'error';
            this.emit('error', new Error('Max reconnect attempts reached'));
            return;
        }

        const delay = this.baseBackoffMs * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;
        this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

        setTimeout(() => {
            if (!this.closed) this.open();
        }, delay).unref();
    }
}
