import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
    __resetFastModeCooldownForTests,
    getFastCooldownRemainingMs,
    isFastModeCoolingDown,
    toggleFastMode,
    triggerFastModeCooldown,
} from '../../../src/shared/thinking/fast-mode.js';

describe('fast-mode cooldown (P20a)', () => {
    beforeEach(() => {
        __resetFastModeCooldownForTests();
    });

    afterEach(() => {
        __resetFastModeCooldownForTests();
    });

    it('starts out of cooldown', () => {
        expect(isFastModeCoolingDown()).toBe(false);
        expect(getFastCooldownRemainingMs()).toBe(0);
    });

    it('triggers cooldown for 2 minutes by default', () => {
        const before = Date.now();
        triggerFastModeCooldown();
        expect(isFastModeCoolingDown()).toBe(true);
        const remaining = getFastCooldownRemainingMs();
        expect(remaining).toBeGreaterThan(0);
        expect(remaining).toBeLessThanOrEqual(120_000);
        // Allow a few ms slack for wall clock advance
        expect(Date.now() - before).toBeLessThan(1000);
    });

    it('respects a custom duration', () => {
        triggerFastModeCooldown(5_000);
        const remaining = getFastCooldownRemainingMs();
        expect(remaining).toBeGreaterThan(0);
        expect(remaining).toBeLessThanOrEqual(5_000);
    });

    it('keeps the longer of two overlapping cooldowns', () => {
        triggerFastModeCooldown(1_000);
        triggerFastModeCooldown(60_000);
        expect(getFastCooldownRemainingMs()).toBeGreaterThan(5_000);
    });

    it('short cooldowns do not extend longer ones', () => {
        triggerFastModeCooldown(60_000);
        triggerFastModeCooldown(500);
        expect(getFastCooldownRemainingMs()).toBeGreaterThan(30_000);
    });

    it('exits cooldown when the clock moves past the deadline', () => {
        triggerFastModeCooldown(1_000);
        const future = Date.now() + 5_000;
        expect(isFastModeCoolingDown(future)).toBe(false);
        expect(getFastCooldownRemainingMs(future)).toBe(0);
    });
});

describe('toggleFastMode (P20a)', () => {
    it('toggles standard → fast and back', () => {
        expect(toggleFastMode('standard')).toBe('fast');
        expect(toggleFastMode('fast')).toBe('standard');
    });

    it('treats undefined as standard (→ fast)', () => {
        expect(toggleFastMode(undefined)).toBe('fast');
    });
});
