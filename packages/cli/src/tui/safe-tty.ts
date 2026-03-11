import type { EventEmitter } from 'node:events';

interface StreamLike extends EventEmitter {
    writable?: boolean;
    emit: EventEmitter['emit'];
    write?: (...args: unknown[]) => boolean;
}

interface SafeTtyGuardStreams {
    stdin: StreamLike;
    stdout: StreamLike;
    stderr: StreamLike;
}

function getErrorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

export function isIgnorableTtyStreamError(error: unknown): boolean {
    const code = getErrorCode(error);
    if (code === 'EIO' || code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') {
        return true;
    }

    const message = getErrorMessage(error).toLowerCase();
    return message.includes('eio')
        || message.includes('epipe')
        || message.includes('stream destroyed');
}

function patchErrorEmit(stream: StreamLike): () => void {
    const originalEmit = stream.emit.bind(stream);

    stream.emit = ((event: string | symbol, ...args: unknown[]) => {
        if (event === 'error' && isIgnorableTtyStreamError(args[0])) {
            return false;
        }

        return originalEmit(event, ...args);
    }) as typeof stream.emit;

    return () => {
        stream.emit = originalEmit as typeof stream.emit;
    };
}

function patchWrite(stream: StreamLike): () => void {
    if (typeof stream.write !== 'function') {
        return () => {};
    }

    const originalWrite = stream.write.bind(stream);

    stream.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
        const resolvedCallback = typeof encoding === 'function'
            ? encoding as ((error?: Error | null) => void)
            : typeof callback === 'function'
                ? callback as ((error?: Error | null) => void)
                : undefined;
        const resolvedEncoding = typeof encoding === 'function' ? undefined : encoding;

        try {
            return originalWrite(chunk, resolvedEncoding, (error?: Error | null) => {
                if (error && !isIgnorableTtyStreamError(error)) {
                    resolvedCallback?.(error);
                    return;
                }

                resolvedCallback?.(undefined);
            });
        } catch (error) {
            if (isIgnorableTtyStreamError(error)) {
                resolvedCallback?.(undefined);
                return false;
            }

            throw error;
        }
    }) as typeof stream.write;

    return () => {
        stream.write = originalWrite as typeof stream.write;
    };
}

export function installSafeTtyGuards(
    streams: SafeTtyGuardStreams = {
        stdin: process.stdin as unknown as StreamLike,
        stdout: process.stdout as unknown as StreamLike,
        stderr: process.stderr as unknown as StreamLike,
    },
): () => void {
    const restoreFns = [
        patchErrorEmit(streams.stdin),
        patchErrorEmit(streams.stdout),
        patchErrorEmit(streams.stderr),
        patchWrite(streams.stdout),
        patchWrite(streams.stderr),
    ];

    return () => {
        for (const restore of restoreFns.reverse()) {
            restore();
        }
    };
}
