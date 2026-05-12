import { describe, expect, test } from 'bun:test';
import { add, subtract, divide } from '../src/math';

describe('math helpers', () => {
    test('add', () => {
        expect(add(2, 3)).toBe(5);
    });

    test('subtract', () => {
        expect(subtract(10, 4)).toBe(6);
    });

    test('divide returns the quotient', () => {
        expect(divide(10, 2)).toBe(5);
    });

    test('divide throws RangeError on divide-by-zero', () => {
        expect(() => divide(1, 0)).toThrow(RangeError);
    });
});
