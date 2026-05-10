import { describe, expect, it } from 'bun:test';
import {
    isFastModeRejection,
    triggerFastModeCooldownOnRejection,
    __resetFastModeCooldownForTests,
    isFastModeCoolingDown,
} from '../../../src/shared/thinking/index.js';

describe('isFastModeRejection (P20b)', () => {
    it('matches Anthropic-style "fast mode is not available" errors', () => {
        expect(isFastModeRejection(new Error('fast mode is not available for your account'))).toBe(true);
        expect(isFastModeRejection(new Error('fast_mode rejected: account tier'))).toBe(true);
        expect(isFastModeRejection(new Error('Fast-Mode unavailable for this model'))).toBe(true);
        expect(isFastModeRejection(new Error('request denied — fast mode forbidden'))).toBe(true);
    });

    it('matches rate-limit paraphrasings', () => {
        expect(isFastModeRejection(new Error('fast mode rate-limit exceeded'))).toBe(true);
    });

    it('ignores unrelated errors', () => {
        expect(isFastModeRejection(new Error('Socket hang up'))).toBe(false);
        expect(isFastModeRejection(new Error('thinking budget exhausted'))).toBe(false);
        expect(isFastModeRejection(null)).toBe(false);
        expect(isFastModeRejection(undefined)).toBe(false);
        expect(isFastModeRejection('')).toBe(false);
    });
});

describe('triggerFastModeCooldownOnRejection (P20b)', () => {
    it('triggers cooldown and returns true on match', () => {
        __resetFastModeCooldownForTests();
        expect(triggerFastModeCooldownOnRejection(new Error('fast mode unavailable'))).toBe(true);
        expect(isFastModeCoolingDown()).toBe(true);
        __resetFastModeCooldownForTests();
    });

    it('leaves cooldown untouched on non-match', () => {
        __resetFastModeCooldownForTests();
        expect(triggerFastModeCooldownOnRejection(new Error('oauth expired'))).toBe(false);
        expect(isFastModeCoolingDown()).toBe(false);
    });
});
