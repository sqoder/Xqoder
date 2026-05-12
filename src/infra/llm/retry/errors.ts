// Clean-room reimplementation of the LLM retry error taxonomy inspired by
// Claude Code / OpenClaude's services/api/errors.ts behavior.
// No original source code copied.

import { LLMError } from '../../shared/errors.js';

/**
 * Kinds of LLM provider errors classified by how withRetry should handle them.
 *
 * - throttle: 429 / 503 with optional Retry-After (bounded exponential backoff).
 * - overload: 529 / body overloaded_error (foreground-only retry).
 * - oauth401: Bearer token expired / invalid (refresh then retry once).
 * - transient: Socket-level error (ECONNRESET / EPIPE / ETIMEDOUT), immediate retry.
 * - stream_idle: No SSE chunk for > streamIdleMs; caller may fall back to non-stream.
 * - prompt_too_long: 400 + body mentions prompt length; trigger reactive compaction.
 * - fatal: Any other 4xx; not retried.
 */
export type LLMErrorKind =
    | 'throttle'
    | 'overload'
    | 'oauth401'
    | 'transient'
    | 'stream_idle'
    | 'prompt_too_long'
    | 'fatal';

/**
 * Shared shape for any classified LLM error: surfaces the `kind` discriminator
 * so callers (withRetry, conversation engine) can `switch` rather than
 * string-match the message.
 */
export interface ClassifiedLLMError extends LLMError {
    kind: LLMErrorKind;
    retryAfterMs?: number;
    httpStatus?: number;
}

export class ThrottleError extends LLMError {
    public readonly kind: LLMErrorKind = 'throttle';
    public readonly retryAfterMs?: number;
    public readonly httpStatus?: number;

    constructor(
        message: string,
        provider: string,
        options?: { retryAfterMs?: number; httpStatus?: number },
    ) {
        super(message, provider, options?.httpStatus);
        this.name = 'ThrottleError';
        if (options?.retryAfterMs !== undefined) {
            this.retryAfterMs = options.retryAfterMs;
        }
        if (options?.httpStatus !== undefined) {
            this.httpStatus = options.httpStatus;
        }
    }
}

export class OverloadError extends LLMError {
    public readonly kind: LLMErrorKind = 'overload';
    public readonly httpStatus?: number;

    constructor(
        message: string,
        provider: string,
        options?: { httpStatus?: number },
    ) {
        super(message, provider, options?.httpStatus);
        this.name = 'OverloadError';
        if (options?.httpStatus !== undefined) {
            this.httpStatus = options.httpStatus;
        }
    }
}

export class OAuth401Error extends LLMError {
    public readonly kind: LLMErrorKind = 'oauth401';
    public readonly httpStatus?: number;

    constructor(
        message: string,
        provider: string,
        options?: { httpStatus?: number },
    ) {
        super(message, provider, options?.httpStatus);
        this.name = 'OAuth401Error';
        if (options?.httpStatus !== undefined) {
            this.httpStatus = options.httpStatus;
        }
    }
}

export class TransientIOError extends LLMError {
    public readonly kind: LLMErrorKind = 'transient';
    public readonly socketCode?: string;

    constructor(
        message: string,
        provider: string,
        options?: { socketCode?: string },
    ) {
        super(message, provider);
        this.name = 'TransientIOError';
        if (options?.socketCode !== undefined) {
            this.socketCode = options.socketCode;
        }
    }
}

export class StreamIdleError extends LLMError {
    public readonly kind: LLMErrorKind = 'stream_idle';
    public readonly idleMs: number;

    constructor(message: string, provider: string, idleMs: number) {
        super(message, provider);
        this.name = 'StreamIdleError';
        this.idleMs = idleMs;
    }
}

export class PromptTooLongError extends LLMError {
    public readonly kind: LLMErrorKind = 'prompt_too_long';
    public readonly httpStatus?: number;

    constructor(
        message: string,
        provider: string,
        options?: { httpStatus?: number },
    ) {
        super(message, provider, options?.httpStatus);
        this.name = 'PromptTooLongError';
        if (options?.httpStatus !== undefined) {
            this.httpStatus = options.httpStatus;
        }
    }
}

export class FatalLLMError extends LLMError {
    public readonly kind: LLMErrorKind = 'fatal';
    public readonly httpStatus?: number;

    constructor(
        message: string,
        provider: string,
        options?: { httpStatus?: number },
    ) {
        super(message, provider, options?.httpStatus);
        this.name = 'FatalLLMError';
        if (options?.httpStatus !== undefined) {
            this.httpStatus = options.httpStatus;
        }
    }
}

/**
 * Narrow an unknown error to one of the classified LLM error subclasses.
 * Returns `undefined` if the error is not one of our classified kinds.
 */
export function isClassifiedLLMError(err: unknown): err is ClassifiedLLMError {
    return (
        err instanceof ThrottleError ||
        err instanceof OverloadError ||
        err instanceof OAuth401Error ||
        err instanceof TransientIOError ||
        err instanceof StreamIdleError ||
        err instanceof PromptTooLongError ||
        err instanceof FatalLLMError
    );
}
