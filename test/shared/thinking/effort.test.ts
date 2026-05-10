import { describe, expect, it } from 'bun:test';
import {
    assertEffort,
    formatEffort,
    parseEffort,
} from '../../../src/shared/thinking/effort.js';

describe('parseEffort (P20a)', () => {
    it('normalizes canonical names case-insensitively', () => {
        expect(parseEffort('low')).toBe('low');
        expect(parseEffort('Low')).toBe('low');
        expect(parseEffort('HIGH')).toBe('high');
        expect(parseEffort('xhigh')).toBe('xhigh');
    });

    it('recognizes aliases', () => {
        expect(parseEffort('mid')).toBe('medium');
        expect(parseEffort('max')).toBe('high');
        expect(parseEffort('minimal')).toBe('low');
        expect(parseEffort('extreme')).toBe('xhigh');
        expect(parseEffort('extra-high')).toBe('xhigh');
        expect(parseEffort('extra_high')).toBe('xhigh');
    });

    it('returns undefined for empty / unknown values', () => {
        expect(parseEffort(undefined)).toBeUndefined();
        expect(parseEffort('')).toBeUndefined();
        expect(parseEffort('nonsense')).toBeUndefined();
    });
});

describe('assertEffort (P20a)', () => {
    it('returns the canonical value', () => {
        expect(assertEffort('High')).toBe('high');
    });

    it('throws on invalid value', () => {
        expect(() => assertEffort('banana')).toThrow(/invalid effort level/);
        expect(() => assertEffort(undefined)).toThrow(/empty/);
    });
});

describe('formatEffort (P20a)', () => {
    it('echoes the canonical value', () => {
        expect(formatEffort('medium')).toBe('medium');
        expect(formatEffort(undefined)).toBe('unset');
    });
});
