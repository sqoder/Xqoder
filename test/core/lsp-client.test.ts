import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import {
    type JsonRpcMessage,
    LspRpcMessagePipeline,
} from '../../src/core/agent/lsp-rpc-pipeline.js';
import { LspClientTransportController } from '../../src/core/agent/lsp-client-transport.js';

describe('LSP RPC message pipeline', () => {
    it('writes JSON-RPC messages with content-length framing', () => {
        const output = new CaptureWritable();
        const pipeline = createPipeline();
        pipeline.setOutput(output);

        pipeline.sendNotification('window/showMessage', { message: 'hello π' });

        const framed = output.text;
        const headerEnd = framed.indexOf('\r\n\r\n');
        expect(headerEnd).toBeGreaterThan(0);

        const header = framed.slice(0, headerEnd);
        const payload = framed.slice(headerEnd + 4);
        const lengthMatch = header.match(/^Content-Length: (\d+)$/);
        expect(lengthMatch).not.toBeNull();
        expect(Number(lengthMatch?.[1])).toBe(Buffer.byteLength(payload, 'utf8'));
        expect(JSON.parse(payload)).toEqual({
            jsonrpc: '2.0',
            method: 'window/showMessage',
            params: { message: 'hello π' },
        });
    });

    it('buffers partial stdout chunks until a complete LSP payload arrives', async () => {
        const messages: JsonRpcMessage[] = [];
        const pipeline = createPipeline({
            handleMessage: async (message) => {
                messages.push(message);
            },
        });
        const framed = frame({
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: {
                uri: 'file:///repo/example.ts',
                diagnostics: [],
            },
        });
        const splitAt = framed.indexOf('\r\n\r\n') + 7;

        pipeline.handleIncomingChunk(Buffer.from(framed.slice(0, splitAt), 'utf8'));
        await pipeline.drainMessages();
        expect(messages).toEqual([]);

        pipeline.handleIncomingChunk(Buffer.from(framed.slice(splitAt), 'utf8'));
        await pipeline.drainMessages();

        expect(messages).toEqual([
            {
                jsonrpc: '2.0',
                method: 'textDocument/publishDiagnostics',
                params: {
                    uri: 'file:///repo/example.ts',
                    diagnostics: [],
                },
            },
        ]);
    });

    it('rejects requests that exceed the configured timeout', async () => {
        const pipeline = createPipeline({ timeoutMs: 5 });
        pipeline.setOutput(new CaptureWritable());

        await expect(pipeline.sendRequest('workspace/symbol', { query: 'missing' }))
            .rejects.toThrow('LSP request timeout: workspace/symbol');
    });
});

describe('LSP transport controller', () => {
    it('closes idempotently without repeating socket teardown', async () => {
        let destroyCount = 0;
        const socket = Object.assign(new EventEmitter(), {
            destroy() {
                destroyCount += 1;
                return this;
            },
        });
        const controller = new LspClientTransportController({
            output: new CaptureWritable(),
            socket: socket as never,
        });

        await controller.close();
        await controller.close();

        expect(destroyCount).toBe(1);
    });
});

class CaptureWritable extends Writable {
    private readonly chunks: Buffer[] = [];

    override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        callback();
    }

    get text(): string {
        return Buffer.concat(this.chunks).toString('utf8');
    }
}

function createPipeline(options: {
    timeoutMs?: number;
    handleMessage?: (message: JsonRpcMessage) => Promise<void>;
} = {}): LspRpcMessagePipeline {
    const logger = {
        debug: () => {},
        warn: () => {},
    };

    return new LspRpcMessagePipeline({
        logger,
        getTimeoutMs: () => options.timeoutMs ?? 1_000,
        handleMessage: options.handleMessage ?? (async () => {}),
    });
}

function frame(message: JsonRpcMessage): string {
    const payload = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}
