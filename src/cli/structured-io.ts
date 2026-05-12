// P26a — Structured I/O: ndjson serialization, stdin reader, control messages.
//
// Provides the building blocks for `--output-format ndjson` and
// `--input-format ndjson` modes. Each line is a self-contained JSON object.

import * as readline from 'node:readline';
import type { ConversationEventEnvelope } from '@xqoder/protocol';

// ---------------------------------------------------------------------------
// ndjsonSafeStringify
// ---------------------------------------------------------------------------

/**
 * Serialize `obj` to a single JSON line (no bare newlines in string values).
 * Appends a trailing `\n` so callers can write directly to stdout.
 */
export function ndjsonSafeStringify(obj: unknown): string {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(obj, (_key, value: unknown) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        return value;
    });
    // Replace bare newlines inside string values with \n escape
    return json.replace(/\n/g, '\\n') + '\n';
}

// ---------------------------------------------------------------------------
// Control messages
// ---------------------------------------------------------------------------

export type ControlMessageType =
    | 'control.interrupt'
    | 'control.new_turn'
    | 'control.feature_toggle';

export interface ControlMessage {
    type: ControlMessageType;
    payload?: unknown;
}

export function isControlMessage(obj: unknown): obj is ControlMessage {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        typeof (obj as Record<string, unknown>)['type'] === 'string' &&
        (obj as Record<string, unknown>)['type'].toString().startsWith('control.')
    );
}

// ---------------------------------------------------------------------------
// Ndjson stdin reader
// ---------------------------------------------------------------------------

export interface NdjsonInputMessage {
    type: 'user' | 'control';
    text?: string;
    control?: ControlMessage;
}

/**
 * Read ndjson lines from stdin and yield parsed messages.
 * Lines that are user messages: `{ "type": "user", "text": "..." }`
 * Lines that are control messages: `{ "type": "control.interrupt", ... }`
 */
export async function* readNdjsonStdin(
    input: NodeJS.ReadableStream = process.stdin,
): AsyncGenerator<NdjsonInputMessage> {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            continue; // skip malformed lines
        }

        if (typeof parsed !== 'object' || parsed === null) continue;

        const obj = parsed as Record<string, unknown>;

        if (isControlMessage(obj)) {
            yield { type: 'control', control: obj as ControlMessage };
        } else if (typeof obj['text'] === 'string') {
            yield { type: 'user', text: obj['text'] };
        } else if (typeof obj['content'] === 'string') {
            yield { type: 'user', text: obj['content'] };
        }
    }
}

// ---------------------------------------------------------------------------
// Envelope emitter
// ---------------------------------------------------------------------------

export type StructuredOutputFormat = 'text' | 'json' | 'stream-json' | 'ndjson';

/**
 * Emit a ConversationEventEnvelope to stdout in the requested format.
 * - `ndjson` / `stream-json`: one JSON line per event.
 * - `text` / `json`: no-op (caller handles final output).
 */
export function emitEnvelope(
    envelope: ConversationEventEnvelope,
    format: StructuredOutputFormat,
    out: NodeJS.WritableStream = process.stdout,
): void {
    if (format === 'ndjson' || format === 'stream-json') {
        out.write(ndjsonSafeStringify({ type: 'event', event: envelope }));
    }
}

/**
 * Emit the final result line for ndjson/stream-json modes.
 */
export function emitFinalResult(
    result: { response: string; sessionId: string },
    format: StructuredOutputFormat,
    out: NodeJS.WritableStream = process.stdout,
): void {
    if (format === 'ndjson' || format === 'stream-json') {
        out.write(ndjsonSafeStringify({ type: 'done', ...result }));
    }
}
