import { describe, expect, test } from 'bun:test';
import { sumPositive } from '../src/sum-positive';

describe('sumPositive', () => {
    test('ignores negatives and zeros', () => {
        expect(sumPositive([1, -2, 3, 0, 4, -5])).toBe(8);
    });

    test('returns 0 for an empty array', () => {
        expect(sumPositive([])).toBe(0);
    });

    test('returns 0 when all inputs are non-positive', () => {
        expect(sumPositive([-1, -2, 0])).toBe(0);
    });
});
