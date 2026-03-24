import { describe, expect, it } from 'vitest';
import { estimateInputLinesForLayout } from './input-layout.js';

describe('input layout helper', () => {
    it('uses at least one line for empty input', () => {
        expect(estimateInputLinesForLayout('')).toBe(1);
    });

    it('caps estimated lines at six', () => {
        expect(estimateInputLinesForLayout(Array.from({ length: 20 }, (_, index) => `line-${index}`).join('\n'))).toBe(6);
    });

    it('counts newline-delimited lines within the cap', () => {
        expect(estimateInputLinesForLayout('a\nb\nc')).toBe(3);
    });
});
