/**
 * Session Persistence Sanitization
 * Used only for clones before writing to DB; does not modify the session in memory.
 * Rules can be found in docs/session-sanitization-rules.md
 */

const REDACT = '***';

/** Sensitive keys (.env etc.), case-insensitive */
const SENSITIVE_KEYS = new Set([
    'api_key', 'apikey', 'secret', 'token', 'password', 'auth', 'bearer',
    'private_key', 'access_token', 'refresh_token', 'database_url', 'redis_url',
    'aws_secret_access_key', 'github_token', 'openai_api_key', 'anthropic_api_key',
]);

/**
 * Sanitizes a single block of text for persistence.
 * Used for last_user_message and content/thinking fields within messages.
 */
export function sanitizeForPersistence(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let out = text;

    // Bearer Token
    out = out.replace(/\bBearer\s+[A-Za-z0-9_\-.]+\b/gi, `Bearer ${REDACT}`);

    // Authorization: xxx
    out = out.replace(/\bAuthorization:\s*[^\s\n\r]+/gi, `Authorization: ${REDACT}`);

    // sk-xxx (OpenAI-style key)
    out = out.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, `sk-${REDACT}`);

    // key=value / key: value sensitive keys
    out = out.replace(
        /\b([Aa]pi[_-]?[Kk]ey|[Ss]ecret|[Tt]oken|[Pp]assword)\s*[:=]\s*['"]?[^\s'"]*['"]?/gi,
        (_, key) => `${key}=${REDACT}`,
    );

    // .env style lines: KEY=value, if key is in sensitive set, replace the value
    out = out.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"]?[^'"\n]*['"]?/gm, (match, keyPart) => {
        const key = keyPart.trim().toLowerCase().replace(/\s/g, '');
        if (SENSITIVE_KEYS.has(key)) {
            return `${keyPart.trim()}=${REDACT}`;
        }
        return match;
    });

    return out;
}

/** Deep clone and sanitize a single LLMMessage for writing to session_messages.message_json */
export function sanitizeMessageForPersistence(message: {
    role: string;
    content?: string;
    thinking?: string;
    toolCalls?: Array<{ id: string; name: string; arguments?: string }>;
    attachments?: Array<{ type?: string; data?: string; [k: string]: unknown }>;
    parts?: Array<{ type: string; text?: string; output?: string; toolCall?: { arguments?: string }; [k: string]: unknown }>;
    [k: string]: unknown;
}): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(message)) {
        if (value === undefined) continue;

        if (key === 'content' || key === 'thinking') {
            out[key] = typeof value === 'string' ? sanitizeForPersistence(value) : value;
            continue;
        }

        if (key === 'toolCalls' && Array.isArray(value)) {
            out[key] = value.map((tc) => {
                const t = tc as { id: string; name: string; arguments?: string };
                return {
                    ...t,
                    arguments: t.arguments ? sanitizeForPersistence(t.arguments) : t.arguments,
                };
            });
            continue;
        }

        if (key === 'attachments' && Array.isArray(value)) {
            out[key] = value.map((att) => {
                const a = att as { type?: string; data?: string; [k: string]: unknown };
                if (a.data != null) {
                    return { ...a, data: `[attachment omitted, ${String(a.data).length} chars]` };
                }
                return a;
            });
            continue;
        }

        if (key === 'parts' && Array.isArray(value)) {
            out[key] = value.map((part) => {
                const p = part as { type: string; text?: string; output?: string; toolCall?: { arguments?: string }; [k: string]: unknown };
                if (p.type === 'text' || p.type === 'reasoning') {
                    return { ...p, text: p.text ? sanitizeForPersistence(p.text) : p.text };
                }
                if (p.type === 'tool_result' && p.output != null) {
                    return { ...p, output: sanitizeForPersistence(String(p.output)) };
                }
                if (p.type === 'tool_call' && p.toolCall?.arguments) {
                    return {
                        ...p,
                        toolCall: { ...p.toolCall, arguments: sanitizeForPersistence(p.toolCall.arguments) },
                    };
                }
                return p;
            });
            continue;
        }

        out[key] = value;
    }

    return out;
}
