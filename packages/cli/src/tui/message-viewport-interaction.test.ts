import { describe, expect, it } from 'vitest';
import {
    isPointInRect,
    isScrollbarHit,
    isScrollbarThumbHit,
    parseMouseInput,
    pointFromTranscript,
} from './message-viewport-interaction.js';

describe('message viewport interaction helpers', () => {
    it('parses SGR mouse input', () => {
        expect(parseMouseInput('\u001b[<64;12;8M')).toEqual({
            code: 64,
            x: 12,
            y: 8,
            action: 'press',
        });
    });

    it('matches scrollbar track and thumb hitboxes', () => {
        expect(isPointInRect(11, 6, { x: 10, y: 5, width: 2, height: 10 })).toBe(true);
        expect(isScrollbarHit(11, 6, { anchor: { x: 10, y: 5 }, width: 2, height: 10 })).toBe(true);
        expect(isScrollbarThumbHit(11, 7, { anchor: { x: 10, y: 5 }, width: 2, height: 10 }, 2, 3, 1)).toBe(true);
        expect(isScrollbarThumbHit(11, 8, { anchor: { x: 10, y: 5 }, width: 2, height: 10 }, 2, 3)).toBe(true);
        expect(isScrollbarThumbHit(11, 12, { anchor: { x: 10, y: 5 }, width: 2, height: 10 }, 2, 3)).toBe(false);
    });

    it('maps transcript pointer positions back to transcript coordinates', () => {
        expect(pointFromTranscript(15, 9, {
            anchor: { x: 10, y: 5 },
            topLine: 20,
            visibleLineCount: 8,
            maxColumn: 12,
        })).toEqual({
            line: 23,
            column: 4,
        });

        expect(pointFromTranscript(50, 20, {
            anchor: { x: 10, y: 5 },
            topLine: 20,
            visibleLineCount: 8,
            maxColumn: 12,
            clampOutside: true,
        })).toEqual({
            line: 27,
            column: 12,
        });
    });
});
