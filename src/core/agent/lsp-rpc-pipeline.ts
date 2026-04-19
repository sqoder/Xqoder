import { type Readable, type Writable } from 'node:stream';
import type { Logger } from '@xqoder/shared';
import { parseContentLength } from './lsp-utils.js';

export interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: string | number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

export interface LspRpcMessagePipelineOptions {
    logger: Pick<Logger, 'debug' | 'warn'>;
    getTimeoutMs: () => number;
    handleMessage: (message: JsonRpcMessage) => Promise<void>;
}

export class LspRpcMessagePipeline {
    private output?: Writable;
    private readonly pendingRequests = new Map<string | number, PendingRequest>();
    private stdoutBuffer = Buffer.alloc(0);
    private nextId = 1;
    private messageQueue: Promise<void> = Promise.resolve();

    constructor(private readonly options: LspRpcMessagePipelineOptions) {}

    attachTransport(input: Readable, output: Writable): void {
        this.setOutput(output);
        input.on('data', (chunk: Buffer | string) => {
            this.handleIncomingChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
        });
    }

    setOutput(output: Writable): void {
        this.output = output;
    }

    clearTransport(): void {
        this.output = undefined;
        this.stdoutBuffer = Buffer.alloc(0);
    }

    handleIncomingChunk(chunk: Buffer): void {
        this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

        while (true) {
            const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
                return;
            }

            const header = this.stdoutBuffer.slice(0, headerEnd).toString('utf8');
            const contentLength = parseContentLength(header);
            if (contentLength === null) {
                throw new Error(`Invalid LSP header: ${header}`);
            }

            const messageStart = headerEnd + 4;
            const messageEnd = messageStart + contentLength;
            if (this.stdoutBuffer.length < messageEnd) {
                return;
            }

            const payload = this.stdoutBuffer.slice(messageStart, messageEnd).toString('utf8');
            this.stdoutBuffer = this.stdoutBuffer.slice(messageEnd);
            this.handleIncomingPayload(payload);
        }
    }

    sendNotification(method: string, params: unknown): void {
        this.sendRaw({
            jsonrpc: '2.0',
            method,
            params,
        });
    }

    sendRaw(message: JsonRpcMessage): void {
        if (!this.output || !this.output.writable) {
            throw new Error('LSP transport not writable');
        }

        const payload = JSON.stringify(message);
        const bytes = Buffer.byteLength(payload, 'utf8');
        this.output.write(`Content-Length: ${bytes}\r\n\r\n${payload}`, 'utf8');
    }

    async sendRequest<T>(method: string, params: unknown): Promise<T> {
        const id = this.nextId++;
        const timeoutMs = this.options.getTimeoutMs();

        const result = await new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`LSP request timeout: ${method}`));
            }, timeoutMs);

            this.pendingRequests.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
                timer,
            });

            try {
                this.sendRaw({
                    jsonrpc: '2.0',
                    id,
                    method,
                    params,
                });
            } catch (error) {
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });

        await this.drainMessages();
        return result;
    }

    rejectAllPending(error: Error): void {
        for (const [id, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pendingRequests.delete(id);
        }
    }

    async drainMessages(): Promise<void> {
        await this.messageQueue;
    }

    private handleIncomingPayload(payload: string): void {
        let message: JsonRpcMessage;

        try {
            message = JSON.parse(payload) as JsonRpcMessage;
        } catch (error) {
            this.options.logger.warn(`Ignoring unparseable LSP message: ${payload}`);
            this.options.logger.debug(String(error));
            return;
        }

        this.messageQueue = this.messageQueue
            .then(() => this.routeIncomingMessage(message))
            .catch((error) => {
                this.options.logger.warn(`Failed to process LSP message: ${error instanceof Error ? error.message : String(error)}`);
            });
    }

    private async routeIncomingMessage(message: JsonRpcMessage): Promise<void> {
        if (message.id !== undefined && message.method === undefined) {
            this.resolvePendingResponse(message);
            return;
        }

        await this.options.handleMessage(message);
    }

    private resolvePendingResponse(message: JsonRpcMessage): void {
        if (message.id === undefined) {
            return;
        }

        const pending = this.pendingRequests.get(message.id);
        if (!pending) {
            return;
        }

        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.id);

        if (message.error) {
            pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
            return;
        }

        pending.resolve(message.result);
    }
}
