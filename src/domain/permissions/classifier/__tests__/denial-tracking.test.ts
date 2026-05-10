import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
    getClassifierDenialCount,
    recordClassifierDenial,
    resetClassifierDegradeThresholdForTests,
    resetClassifierDenials,
    setClassifierDegradeThresholdForTests,
    shouldDegradeClassifierToAsk,
} from '../denial-tracking.js';

beforeEach(() => {
    resetClassifierDenials();
});

afterEach(() => {
    resetClassifierDegradeThresholdForTests();
    resetClassifierDenials();
});

describe('denial-tracking', () => {
    it('starts at zero for a fresh sessionId', () => {
        expect(getClassifierDenialCount('s1')).toBe(0);
    });

    it('increments per session independently', () => {
        recordClassifierDenial('s1');
        recordClassifierDenial('s1');
        recordClassifierDenial('s2');
        expect(getClassifierDenialCount('s1')).toBe(2);
        expect(getClassifierDenialCount('s2')).toBe(1);
    });

    it('degrade returns true only once threshold reached', () => {
        setClassifierDegradeThresholdForTests(3);
        recordClassifierDenial('sx');
        recordClassifierDenial('sx');
        expect(shouldDegradeClassifierToAsk('sx')).toBe(false);
        recordClassifierDenial('sx');
        expect(shouldDegradeClassifierToAsk('sx')).toBe(true);
    });

    it('resetClassifierDenials with sessionId clears only that session', () => {
        recordClassifierDenial('a');
        recordClassifierDenial('b');
        resetClassifierDenials('a');
        expect(getClassifierDenialCount('a')).toBe(0);
        expect(getClassifierDenialCount('b')).toBe(1);
    });

    it('resetClassifierDenials without arg clears everything', () => {
        recordClassifierDenial('a');
        recordClassifierDenial('b');
        resetClassifierDenials();
        expect(getClassifierDenialCount('a')).toBe(0);
        expect(getClassifierDenialCount('b')).toBe(0);
    });
});
