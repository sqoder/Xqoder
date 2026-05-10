// P09 sub-PR 1: query-config unit tests.

import { describe, expect, it } from 'bun:test';
import {
    DEFAULT_MAX_TURNS,
    isWallTimeExceeded,
    resolveMaxTurns,
    wouldExceedMaxToolCalls,
} from '../../../src/application/chat/query-config.js';

describe('resolveMaxTurns', () => {
    it('prefers maxTurns when present', () => {
        expect(resolveMaxTurns({ maxTurns: 7, maxIterations: 99 })).toBe(7);
    });

    it('falls back to legacy maxIterations when maxTurns is absent', () => {
        expect(resolveMaxTurns({ maxIterations: 13 })).toBe(13);
    });

    it('uses DEFAULT_MAX_TURNS when neither is set', () => {
        expect(resolveMaxTurns({})).toBe(DEFAULT_MAX_TURNS);
        expect(DEFAULT_MAX_TURNS).toBe(20);
    });
});

describe('isWallTimeExceeded', () => {
    it('returns false when no limit is configured', () => {
        expect(isWallTimeExceeded(0, 1_000_000, undefined)).toBe(false);
    });

    it('returns false when elapsed is within the limit', () => {
        expect(isWallTimeExceeded(1000, 1500, 1000)).toBe(false);
    });

    it('returns true only after the limit is strictly exceeded', () => {
        expect(isWallTimeExceeded(1000, 2000, 1000)).toBe(false); // equal → not exceeded
        expect(isWallTimeExceeded(1000, 2001, 1000)).toBe(true);
    });

    it('guards against negative limits', () => {
        expect(isWallTimeExceeded(0, 500, -1)).toBe(false);
    });
});

describe('wouldExceedMaxToolCalls', () => {
    it('returns false when no limit is configured', () => {
        expect(wouldExceedMaxToolCalls(5, 3, undefined)).toBe(false);
    });

    it('returns false when the next count is at or below the limit', () => {
        expect(wouldExceedMaxToolCalls(2, 3, 5)).toBe(false);
        expect(wouldExceedMaxToolCalls(5, 0, 5)).toBe(false);
    });

    it('returns true as soon as the next count would exceed the limit', () => {
        expect(wouldExceedMaxToolCalls(5, 1, 5)).toBe(true);
        expect(wouldExceedMaxToolCalls(0, 6, 5)).toBe(true);
    });
});
