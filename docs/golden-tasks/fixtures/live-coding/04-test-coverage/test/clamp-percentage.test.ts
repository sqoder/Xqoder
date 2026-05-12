import { describe, expect, test } from 'bun:test';
import { clampPercentage } from '../src/clamp-percentage';

describe('clampPercentage — existing behaviour', () => {
    test('clamps below 0 to 0', () => {
        expect(clampPercentage(-5)).toBe(0);
    });

    test('clamps above 100 to 100', () => {
        expect(clampPercentage(150)).toBe(100);
    });

    test('leaves in-range values untouched', () => {
        expect(clampPercentage(42)).toBe(42);
    });
});
