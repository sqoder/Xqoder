// ============================================================
// Debug Logger — Persistent request/response logs
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DebugLoggerOptions {
    enabled: boolean;
    baseDir: string;
    sessionId?: string;
}

/**
 * DebugLogger writes request/response/tool JSON to disk for debugging.
 * Activated by XQODER_DEV_DEBUG=1 environment variable.
 */
export class DebugLogger {
    private dir: string;
    private enabled: boolean;
    private counter = 0;

    constructor(options: DebugLoggerOptions) {
        this.enabled = options.enabled;
        this.dir = path.join(options.baseDir, options.sessionId ?? 'default');

        if (this.enabled) {
            try {
                fs.mkdirSync(this.dir, { recursive: true });
            } catch { /* ignore */ }
        }
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    logRequest(messages: unknown[], tools?: unknown[]): void {
        if (!this.enabled) return;
        this.counter++;
        this.writeJson(`${this.counter}_request.json`, {
            timestamp: new Date().toISOString(),
            messageCount: Array.isArray(messages) ? messages.length : 0,
            messages,
            toolCount: tools?.length ?? 0,
            tools,
        });
    }

    logResponse(response: unknown): void {
        if (!this.enabled) return;
        this.writeJson(`${this.counter}_response.json`, {
            timestamp: new Date().toISOString(),
            response,
        });
    }

    logToolCall(toolName: string, args: unknown, result: unknown): void {
        if (!this.enabled) return;
        this.writeJson(`${this.counter}_tool_${toolName}.json`, {
            timestamp: new Date().toISOString(),
            tool: toolName,
            args,
            result,
        });
    }

    logStream(chunks: string[]): void {
        if (!this.enabled) return;
        this.writeJson(`${this.counter}_stream.json`, {
            timestamp: new Date().toISOString(),
            chunkCount: chunks.length,
            totalLength: chunks.reduce((s, c) => s + c.length, 0),
            chunks,
        });
    }

    logError(error: unknown): void {
        if (!this.enabled) return;
        const errorObj = error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : error;
        this.writeJson(`${this.counter}_error.json`, {
            timestamp: new Date().toISOString(),
            error: errorObj,
        });
    }

    logPanic(error: unknown): void {
        const errorObj = error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { value: String(error) };

        const panicFile = path.join(
            path.dirname(this.dir),
            `xqoder-panic-${Date.now()}.log`,
        );

        try {
            fs.writeFileSync(panicFile, JSON.stringify(errorObj, null, 2), 'utf-8');
        } catch { /* last resort */ }
    }

    private writeJson(filename: string, data: unknown): void {
        try {
            const filePath = path.join(this.dir, filename);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch { /* ignore write errors */ }
    }
}

/**
 * Create a debug logger from environment.
 */
export function createDebugLogger(baseDir: string, sessionId?: string): DebugLogger {
    const enabled = process.env.XQODER_DEV_DEBUG === '1' || process.env.XQODER_DEV_DEBUG === 'true';
    return new DebugLogger({
        enabled,
        baseDir,
        ...(sessionId !== undefined ? { sessionId } : {}),
    });
}
