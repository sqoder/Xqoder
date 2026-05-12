// P26 — structured-io unit tests.

import { describe, expect, it } from 'bun:test';
import { Readable } from 'node:stream';
import {
    ndjsonSafeStringify,
    isControlMessage,
    readNdjsonStdin,
    emitEnvelope,
    emitFinalResult,
    type ControlMessage,
} from '../../src/cli/structured-io.js';

// ---------------------------------------------------------------------------
// ndjsonSafeStringify
// ---------------------------------------------------------------------------

describe('ndjsonSafeStringify', () => {
    it('serializes a simple object to a single JSON line', () => {
        const result = ndjsonSafeStringify({ type: 'event', value: 42 });
        expect(result).toBe('{"type":"event","value":42}\n');
    });

    it('escapes embedded newlines in string values', () => {
        const result = ndjsonSafeStringify({ text: 'line1\nline2' });
        expect(result).not.toContain('\n\n');
        expect(result.trimEnd()).not.toContain('\n');
        // The embedded newline should be escaped
        expect(result).toContain('\\n');
    });

    it('handles circular references gracefully', () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj['self'] = obj;
        const result = ndjsonSafeStringify(obj);
        expect(result).toContain('[Circular]');
        expect(result.endsWith('\n')).toBe(true);
    });

    it('always ends with a newline', () => {
        expect(ndjsonSafeStringify({})).toMatch(/\n$/);
        expect(ndjsonSafeStringify('hello')).toMatch(/\n$/);
        expect(ndjsonSafeStringify(null)).toMatch(/\n$/);
    });
});

// ---------------------------------------------------------------------------
// isControlMessage
// ---------------------------------------------------------------------------

describe('isControlMessage', () => {
    it('returns true for control.interrupt', () => {
        expect(isControlMessage({ type: 'control.interrupt' })).toBe(true);
    });

    it('returns true for control.new_turn', () => {
        expect(isControlMessage({ type: 'control.new_turn' })).toBe(true);
    });

    it('returns false for user messages', () => {
        expect(isControlMessage({ type: 'user', text: 'hello' })).toBe(false);
    });

    it('returns false for non-objects', () => {
        expect(isControlMessage(null)).toBe(false);
        expect(isControlMessage('control.interrupt')).toBe(false);
        expect(isControlMessage(42)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// readNdjsonStdin
// ---------------------------------------------------------------------------

function makeReadable(lines: string[]): Readable {
    return Readable.from(lines.join('\n') + '\n');
}

describe('readNdjsonStdin', () => {
    it('yields user messages', async () => {
        const stream = makeReadable([
            JSON.stringify({ type: 'user', text: 'hello' }),
            JSON.stringify({ type: 'user', text: 'world' }),
        ]);
        const messages = [];
        for await (const msg of readNdjsonStdin(stream)) {
            messages.push(msg);
        }
        expect(messages).toHaveLength(2);
        expect(messages[0]?.type).toBe('user');
        expect(messages[0]?.text).toBe('hello');
    });

    it('yields control messages', async () => {
        const stream = makeReadable([
            JSON.stringify({ type: 'control.interrupt' }),
        ]);
        const messages = [];
        for await (const msg of readNdjsonStdin(stream)) {
            messages.push(msg);
        }
        expect(messages[0]?.type).toBe('control');
        expect(messages[0]?.control?.type).toBe('control.interrupt');
    });

    it('skips malformed lines', async () => {
        const stream = makeReadable([
            'not json',
            JSON.stringify({ type: 'user', text: 'valid' }),
            '{broken',
        ]);
        const messages = [];
        for await (const msg of readNdjsonStdin(stream)) {
            messages.push(msg);
        }
        expect(messages).toHaveLength(1);
        expect(messages[0]?.text).toBe('valid');
    });

    it('skips empty lines', async () => {
        const stream = makeReadable([
            '',
            '   ',
            JSON.stringify({ type: 'user', text: 'hi' }),
        ]);
        const messages = [];
        for await (const msg of readNdjsonStdin(stream)) {
            messages.push(msg);
        }
        expect(messages).toHaveLength(1);
    });

    it('accepts content field as alias for text', async () => {
        const stream = makeReadable([
            JSON.stringify({ content: 'hello via content' }),
        ]);
        const messages = [];
        for await (const msg of readNdjsonStdin(stream)) {
            messages.push(msg);
        }
        expect(messages[0]?.text).toBe('hello via content');
    });
});

// ---------------------------------------------------------------------------
// emitEnvelope / emitFinalResult
// ---------------------------------------------------------------------------

describe('emitEnvelope', () => {
    it('writes ndjson line for ndjson format', () => {
        const chunks: string[] = [];
        const out = { write: (s: string) => { chunks.push(s); return true; } } as unknown as NodeJS.WritableStream;
        const envelope = { type: 'message.delta', payload: { text: 'hi', role: 'assistant', messageId: 'x' } } as unknown as import('../../src/application/chat/index.js').ConversationEventEnvelope;
        emitEnvelope(envelope, 'ndjson', out);
        expect(chunks).toHaveLength(1);
        const parsed = JSON.parse(chunks[0]!.trimEnd());
        expect(parsed.type).toBe('event');
    });

    it('writes ndjson line for stream-json format', () => {
        const chunks: string[] = [];
        const out = { write: (s: string) => { chunks.push(s); return true; } } as unknown as NodeJS.WritableStream;
        const envelope = { type: 'message.delta', payload: { text: 'hi', role: 'assistant', messageId: 'x' } } as unknown as import('../../src/application/chat/index.js').ConversationEventEnvelope;
        emitEnvelope(envelope, 'stream-json', out);
        expect(chunks).toHaveLength(1);
    });

    it('does nothing for text format', () => {
        const chunks: string[] = [];
        const out = { write: (s: string) => { chunks.push(s); return true; } } as unknown as NodeJS.WritableStream;
        const envelope = { type: 'message.delta' } as unknown as import('../../src/application/chat/index.js').ConversationEventEnvelope;
        emitEnvelope(envelope, 'text', out);
        expect(chunks).toHaveLength(0);
    });
});

describe('emitFinalResult', () => {
    it('writes done line for ndjson format', () => {
        const chunks: string[] = [];
        const out = { write: (s: string) => { chunks.push(s); return true; } } as unknown as NodeJS.WritableStream;
        emitFinalResult({ response: 'hello', sessionId: 'sess-1' }, 'ndjson', out);
        const parsed = JSON.parse(chunks[0]!.trimEnd());
        expect(parsed.type).toBe('done');
        expect(parsed.response).toBe('hello');
        expect(parsed.sessionId).toBe('sess-1');
    });
});
