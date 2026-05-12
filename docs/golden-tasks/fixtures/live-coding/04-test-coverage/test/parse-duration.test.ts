import { describe, expect, test } from 'bun:test';
import { parseDuration } from '../src/parse-duration';

describe('parseDuration', () => {
    test('parses seconds', () => {
        expect(parseDuration('5s')).toBe(5000);
    });

    test('parses minutes', () => {
        expect(parseDuration('2m')).toBe(120_000);
    });
});
