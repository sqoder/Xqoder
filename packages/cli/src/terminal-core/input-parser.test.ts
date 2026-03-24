import { describe, expect, it } from 'vitest';
import { parseInputChunk, parseInputChunkWithRest } from './input-parser.js';

describe('input parser', () => {
    it('parses bracketed paste and mouse events', () => {
        expect(parseInputChunk('\u001b[200~line1\nline2\u001b[201~')).toEqual([
            { type: 'paste', text: 'line1\nline2', raw: '\u001b[200~line1\nline2\u001b[201~' },
        ]);
        expect(parseInputChunk('\u001b[<64;12;4M')[0]).toMatchObject({
            type: 'mouse',
            kind: 'scroll',
            button: 'wheelUp',
            x: 12,
            y: 4,
        });
    });

    it('parses plain text and key sequences', () => {
        expect(parseInputChunk('abc')).toEqual([{ type: 'text', text: 'abc', raw: 'abc' }]);
        expect(parseInputChunk('\u001b[A')[0]).toMatchObject({ type: 'key', key: 'up' });
    });

    it('parses Ctrl+letter shortcuts as key events with ctrl flag', () => {
        expect(parseInputChunk('\u0005')).toEqual([
            { type: 'key', key: 'e', ctrl: true, raw: '\u0005' },
        ]);
    });

    it('parses modified Enter escape sequences', () => {
        expect(parseInputChunk('\u001b[13;2u')).toEqual([
            { type: 'key', key: 'enter', shift: true, raw: '\u001b[13;2u' },
        ]);
        expect(parseInputChunk('\u001b[13;5u')).toEqual([
            { type: 'key', key: 'enter', ctrl: true, raw: '\u001b[13;5u' },
        ]);
        expect(parseInputChunk('\u001b\r')).toEqual([
            { type: 'key', key: 'enter', alt: true, raw: '\u001b\r' },
        ]);
    });

    it('parses alt+ctrl letter chords from ESC-prefixed control chars', () => {
        expect(parseInputChunk('\u001b\u0007')).toEqual([
            { type: 'key', key: 'g', ctrl: true, alt: true, raw: '\u001b\u0007' },
        ]);
        expect(parseInputChunk('\u001b\u0015')).toEqual([
            { type: 'key', key: 'u', ctrl: true, alt: true, raw: '\u001b\u0015' },
        ]);
    });

    it('parses legacy mouse format (\\x1b[M + 3 bytes) for wheel', () => {
        const legacyWheelUp = '\u001b[M\x60\x20\x20';
        const events = parseInputChunk(legacyWheelUp);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: 'mouse', button: 'wheelUp', kind: 'scroll' });
    });

    it('parseInputChunkWithRest leaves incomplete escape in rest', () => {
        const { events, rest } = parseInputChunkWithRest('\u001b[<64');
        expect(events).toHaveLength(0);
        expect(rest).toBe('\u001b[<64');
        const { events: e2, rest: r2 } = parseInputChunkWithRest(rest + ';50;20M');
        expect(e2).toHaveLength(1);
        expect(e2[0]).toMatchObject({ type: 'mouse', button: 'wheelUp' });
        expect(r2).toBe('');
    });

    it('parseInputChunkWithRest leaves lone \\x1b in rest so Alt+C works across chunks', () => {
        const { events: e1, rest: r1 } = parseInputChunkWithRest('\u001b');
        expect(e1).toHaveLength(0);
        expect(r1).toBe('\u001b');
        const { events: e2, rest: r2 } = parseInputChunkWithRest(r1 + 'c');
        expect(e2).toHaveLength(1);
        expect(e2[0]).toMatchObject({ type: 'key', key: 'c', alt: true });
        expect(r2).toBe('');
    });
});
