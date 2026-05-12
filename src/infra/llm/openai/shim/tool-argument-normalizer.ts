// Reshapes raw tool-call argument strings into the object shape the
// downstream executor expects. OpenAI-compatible models occasionally emit
// a bare string (`"ls -la"`) instead of an object, and reasoning models
// sometimes truncate the JSON mid-stream.
//
// Behavior in priority order:
//   1. Valid JSON object → parsed as-is, optionally coerced to `schemaHint`.
//   2. Truncated JSON object → repaired via `json-repair` then re-tried.
//   3. Well-known shell-like tool names → `{ command: raw }` box.
//   4. Single-string-parameter schema → auto-box into that key.
//   5. Otherwise throw.
//
// Schema coercion (P08): when a schema is provided we only keep declared
// keys, cast primitives with `castBySchema`, and fill `default` values for
// omitted optional keys. This guards against models sending extra fields
// or strings where numbers are expected.

import { repairPossiblyTruncatedObjectJson } from './json-repair.js';

export interface SchemaHintRecord {
    readonly type?: string;
    readonly properties?: Record<string, SchemaHintRecord>;
    readonly required?: readonly string[];
    readonly items?: SchemaHintRecord;
    readonly default?: unknown;
    readonly enum?: readonly unknown[];
}

export function normalizeToolArguments(
    toolName: string,
    raw: string,
    schemaHint?: SchemaHintRecord,
): Record<string, unknown> {
    const trimmed = (raw ?? '').trim();

    if (trimmed.length === 0) {
        return schemaHint ? applyDefaults({}, schemaHint) : {};
    }

    if (trimmed.startsWith('{')) {
        const attempts = [trimmed, repairPossiblyTruncatedObjectJson(trimmed)];
        for (const candidate of attempts) {
            try {
                const parsed = JSON.parse(candidate) as unknown;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return coerceToSchema(parsed as Record<string, unknown>, schemaHint);
                }
            } catch {
                // fall through to boxed-string fallbacks
            }
        }
    }

    // Shell-like tools commonly get a raw command string.
    if (toolName === 'run_shell' || toolName === 'run_command' || toolName === 'bash') {
        return coerceToSchema({ command: trimmed }, schemaHint);
    }

    // Single-string-parameter tool — auto-box into that key.
    const props = schemaHint?.properties;
    if (props) {
        const stringKeys = Object.keys(props).filter((k) => props[k]?.type === 'string');
        if (stringKeys.length === 1) {
            return coerceToSchema({ [stringKeys[0]!]: trimmed }, schemaHint);
        }
    }

    throw new Error(
        `Cannot normalize tool arguments for ${toolName}: ${trimmed.slice(0, 80)}`,
    );
}

function coerceToSchema(
    obj: Record<string, unknown>,
    schema?: SchemaHintRecord,
): Record<string, unknown> {
    if (!schema?.properties) return obj;
    const out: Record<string, unknown> = {};
    const required = new Set(schema.required ?? []);
    for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
            out[key] = castBySchema(obj[key], propSchema);
        } else if (!required.has(key) && propSchema && 'default' in propSchema) {
            out[key] = propSchema.default;
        }
    }
    return out;
}

function applyDefaults(
    obj: Record<string, unknown>,
    schema: SchemaHintRecord,
): Record<string, unknown> {
    if (!schema.properties) return obj;
    const out: Record<string, unknown> = { ...obj };
    const required = new Set(schema.required ?? []);
    for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in out) && !required.has(key) && propSchema && 'default' in propSchema) {
            out[key] = propSchema.default;
        }
    }
    return out;
}

function castBySchema(value: unknown, schema?: SchemaHintRecord): unknown {
    if (!schema?.type) return value;
    switch (schema.type) {
        case 'string':
            return typeof value === 'string' ? value : String(value);
        case 'number':
        case 'integer': {
            if (typeof value === 'number') {
                return schema.type === 'integer' ? Math.trunc(value) : value;
            }
            if (typeof value === 'string' && value.trim() !== '') {
                const n = Number(value);
                if (!Number.isNaN(n)) return schema.type === 'integer' ? Math.trunc(n) : n;
            }
            return value;
        }
        case 'boolean':
            if (typeof value === 'boolean') return value;
            if (value === 'true' || value === '1' || value === 1) return true;
            if (value === 'false' || value === '0' || value === 0) return false;
            return value;
        default:
            return value;
    }
}
