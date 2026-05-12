// Clean-room reimplementation of LLM error classification inspired by
// Claude Code / OpenClaude's services/api/errors.ts + openaiErrorClassification.ts
// behavior. No original source code copied.

import {
    type ClassifiedLLMError,
    FatalLLMError,
    OAuth401Error,
    OverloadError,
    PromptTooLongError,
    ThrottleError,
    TransientIOError,
    isClassifiedLLMError,
} from './errors.js';

const PROMPT_TOO_LONG_PATTERN =
    /(prompt\s+is\s+too\s+long|context\s+length|maximum\s+context|context_length_exceeded|string too long)/i;

const OVERLOADED_BODY_TYPE = 'overloaded_error';

const TRANSIENT_SOCKET_CODES = new Set([
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'ECONNABORTED',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    // undici surfaces these:
    'UND_ERR_SOCKET',
    'UND_ERR_CLOSED',
]);

interface MaybeSdkError {
    name?: string;
    message?: string;
    code?: string;
    status?: number;
    statusCode?: number;
    headers?: unknown;
    error?: { type?: string; message?: string } | unknown;
    cause?: unknown;
}

/**
 * Map an unknown error thrown by an Anthropic / OpenAI / shim client call into
 * one of our classified LLM error subclasses. The result exposes a stable
 * `kind` discriminator plus optional hints like `retryAfterMs` and
 * `httpStatus`, so callers (withRetry, reactive compaction) can dispatch
 * without string-matching error messages.
 *
 * The classifier is pure and side-effect free; it never logs or mutates the
 * original error.
 */
export function classifyLLMError(
    err: unknown,
    providerName: string,
): ClassifiedLLMError {
    if (isClassifiedLLMError(err)) {
        return err;
    }

    const raw = toSdkError(err);
    const message = raw.message ?? (err instanceof Error ? err.message : String(err));
    const status = raw.status ?? raw.statusCode;

    // Socket-level transient errors. Include nested `cause` chain because
    // fetch / undici commonly wraps the original socket error once.
    const socketCode = findTransientCode(raw);
    if (socketCode) {
        return new TransientIOError(message || socketCode, providerName, {
            socketCode,
        });
    }

    // Overloaded (Anthropic-specific 529 + body overloaded_error).
    if (status === 529 || nestedErrorType(raw) === OVERLOADED_BODY_TYPE) {
        return new OverloadError(message || 'overloaded', providerName, {
            ...(status !== undefined ? { httpStatus: status } : {}),
        });
    }

    // Throttling.
    if (status === 429 || status === 503) {
        const retryAfterMs = parseRetryAfter(readHeader(raw.headers, 'retry-after'));
        return new ThrottleError(message || 'throttled', providerName, {
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            ...(status !== undefined ? { httpStatus: status } : {}),
        });
    }

    // OAuth token expiry. Only classify 401 as OAuth when the challenge
    // indicates it; plain API-key 401 is fatal (wrong key).
    if (status === 401) {
        const challenge = readHeader(raw.headers, 'www-authenticate');
        if (isOAuthBearerChallenge(challenge)) {
            return new OAuth401Error(message || 'oauth', providerName, {
                httpStatus: status,
            });
        }
    }

    // Prompt length issues (Anthropic 400 + "prompt is too long", OpenAI 400
    // + "context length", etc). Match on message body rather than status
    // only, because some providers report 413 or 422 for the same issue.
    if (
        (status !== undefined && status >= 400 && status < 500) &&
        PROMPT_TOO_LONG_PATTERN.test(message)
    ) {
        return new PromptTooLongError(message, providerName, {
            httpStatus: status,
        });
    }

    return new FatalLLMError(message || String(err), providerName, {
        ...(status !== undefined ? { httpStatus: status } : {}),
    });
}

function toSdkError(err: unknown): MaybeSdkError {
    if (err && typeof err === 'object') {
        return err as MaybeSdkError;
    }
    return { message: String(err) };
}

function findTransientCode(raw: MaybeSdkError): string | undefined {
    const codes: Array<string | undefined> = [];
    let cursor: unknown = raw;
    // Walk up to 3 levels of `cause` to cover undici / fetch wrappers.
    for (let i = 0; i < 3 && cursor; i += 1) {
        const obj = cursor as MaybeSdkError;
        codes.push(obj.code);
        cursor = obj.cause;
    }
    for (const code of codes) {
        if (code && TRANSIENT_SOCKET_CODES.has(code)) {
            return code;
        }
    }
    return undefined;
}

function nestedErrorType(raw: MaybeSdkError): string | undefined {
    const nested = raw.error;
    if (nested && typeof nested === 'object' && 'type' in nested) {
        const type = (nested as { type?: unknown }).type;
        return typeof type === 'string' ? type : undefined;
    }
    return undefined;
}

/**
 * Read a header value case-insensitively from either a plain record or a
 * Headers-like instance. Returns undefined if absent.
 */
function readHeader(headers: unknown, name: string): string | undefined {
    if (!headers) {
        return undefined;
    }
    // Fetch Headers instance exposes .get().
    if (typeof (headers as { get?: unknown }).get === 'function') {
        const value = (headers as { get: (k: string) => string | null }).get(name);
        return value ?? undefined;
    }
    if (typeof headers === 'object') {
        const record = headers as Record<string, unknown>;
        const lower = name.toLowerCase();
        for (const key of Object.keys(record)) {
            if (key.toLowerCase() === lower) {
                const value = record[key];
                return typeof value === 'string' ? value : undefined;
            }
        }
    }
    return undefined;
}

/**
 * Parse a Retry-After header into a millisecond delay. Handles both the
 * seconds form (`"3"` or `"3.5"`) and the HTTP-date form. Invalid input
 * returns undefined so callers can fall back to exponential backoff.
 */
function parseRetryAfter(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }
    const seconds = Number.parseFloat(value);
    if (Number.isFinite(seconds)) {
        return Math.max(0, Math.floor(seconds * 1000));
    }
    const date = Date.parse(value);
    if (Number.isFinite(date)) {
        return Math.max(0, date - Date.now());
    }
    return undefined;
}

function isOAuthBearerChallenge(header: string | undefined): boolean {
    if (!header) {
        return false;
    }
    // Accept either `Bearer error="invalid_token"` directly or the more
    // common realm-first form `Bearer realm="api", error="invalid_token"`.
    // The challenge parameters can appear in any order after the scheme.
    return /(^|[\s,])Bearer\b[\s\S]*?\berror\s*=/i.test(header);
}
