import { describe, expect, it } from 'vitest';
import { parseInputChunk } from './input-parser.js';

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
});
