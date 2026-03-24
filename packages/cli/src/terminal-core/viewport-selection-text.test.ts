import { describe, expect, it } from 'vitest';
import { buildViewportSelectedText, getViewportSelectionCopyText } from './viewport-selection-text.js';

describe('viewport-selection-text', () => {
    it('normalizes reversed multi-line selections', () => {
        const text = buildViewportSelectedText(
            ['hello world', 'second line'],
            {
                start: { line: 1, column: 6 },
                end: { line: 0, column: 6 },
            },
        );

        expect(text).toBe('world\nsecond');
    });

    it('respects display columns for double-width characters', () => {
        expect(buildViewportSelectedText(
            ['你ab'],
            {
                start: { line: 0, column: 0 },
                end: { line: 0, column: 2 },
            },
        )).toBe('你');

        expect(buildViewportSelectedText(
            ['你ab'],
            {
                start: { line: 0, column: 2 },
                end: { line: 0, column: 4 },
            },
        )).toBe('ab');
    });

    it('returns an empty string when there is no selection', () => {
        expect(getViewportSelectionCopyText(['hello'], null)).toBe('');
    });

    it('trims only trailing whitespace from the copied selection', () => {
        const text = getViewportSelectionCopyText(
            ['alpha  ', 'beta  '],
            {
                start: { line: 0, column: 0 },
                end: { line: 1, column: 6 },
            },
        );

        expect(text).toBe('alpha  \nbeta');
    });
});
