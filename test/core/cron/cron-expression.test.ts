// P19b — Cron expression parser + next-fire-at computation.

import { describe, expect, it } from 'bun:test';
import {
    isValidCronExpression,
    nextFireAt,
    parseCronExpression,
} from '../../../src/core/cron/cron-expression.js';

function d(iso: string): Date {
    return new Date(iso);
}

describe('parseCronExpression', () => {
    it('accepts five-field expressions with literals', () => {
        const cron = parseCronExpression('0 9 * * *');
        expect(Array.from(cron.minute)).toEqual([0]);
        expect(Array.from(cron.hour)).toEqual([9]);
        expect(cron.dayOfMonth.size).toBe(31);
        expect(cron.month.size).toBe(12);
        expect(cron.dayOfWeek.size).toBe(7);
        expect(cron.dayOfMonthRestricted).toBe(false);
        expect(cron.dayOfWeekRestricted).toBe(false);
        expect(cron.raw).toBe('0 9 * * *');
    });

    it('supports step ranges (*/5)', () => {
        const cron = parseCronExpression('*/15 * * * *');
        expect(Array.from(cron.minute).sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
    });

    it('supports ranges (9-17) and lists (1,3,5)', () => {
        const cron = parseCronExpression('0 9-11 * * 1,3,5');
        expect(Array.from(cron.hour).sort((a, b) => a - b)).toEqual([9, 10, 11]);
        expect(Array.from(cron.dayOfWeek).sort((a, b) => a - b)).toEqual([1, 3, 5]);
        expect(cron.dayOfWeekRestricted).toBe(true);
    });

    it('supports stepped range (10-30/5)', () => {
        const cron = parseCronExpression('10-30/5 * * * *');
        expect(Array.from(cron.minute).sort((a, b) => a - b)).toEqual([10, 15, 20, 25, 30]);
    });

    it('rejects fewer than five fields', () => {
        expect(() => parseCronExpression('0 9 * *')).toThrow(/exactly 5/);
    });

    it('rejects values outside the field range', () => {
        expect(() => parseCronExpression('60 * * * *')).toThrow(/minute/);
        expect(() => parseCronExpression('* 24 * * *')).toThrow(/hour/);
        expect(() => parseCronExpression('* * 0 * *')).toThrow(/dayOfMonth/);
        expect(() => parseCronExpression('* * * 0 *')).toThrow(/month/);
        expect(() => parseCronExpression('* * * * 7')).toThrow(/dayOfWeek/);
    });

    it('rejects malformed tokens', () => {
        expect(() => parseCronExpression('bogus * * * *')).toThrow();
        expect(() => parseCronExpression('*/0 * * * *')).toThrow();
        expect(() => parseCronExpression('1--3 * * * *')).toThrow();
    });

    it('treats 7 in dayOfWeek as invalid but accepts 0 (Sunday)', () => {
        expect(() => parseCronExpression('* * * * 7')).toThrow();
        const cron = parseCronExpression('* * * * 0');
        expect(Array.from(cron.dayOfWeek)).toEqual([0]);
    });

    it('marks dayOfMonth as unrestricted when "*"', () => {
        const cron = parseCronExpression('* * * * 1');
        expect(cron.dayOfMonthRestricted).toBe(false);
        expect(cron.dayOfWeekRestricted).toBe(true);
    });
});

describe('isValidCronExpression', () => {
    it('returns true for valid and false for invalid', () => {
        expect(isValidCronExpression('0 9 * * *')).toBe(true);
        expect(isValidCronExpression('*/5 * * * *')).toBe(true);
        expect(isValidCronExpression('bogus * * * *')).toBe(false);
        expect(isValidCronExpression('')).toBe(false);
    });
});

describe('nextFireAt', () => {
    it('returns the next matching minute strictly after `from`', () => {
        // Every minute — next is from + 1min, seconds zeroed.
        const cron = parseCronExpression('* * * * *');
        const next = nextFireAt(cron, d('2026-05-11T10:00:30.000'));
        // Local time: next minute at :00 seconds.
        expect(next.getSeconds()).toBe(0);
        expect(next.getMilliseconds()).toBe(0);
        expect(next.getTime()).toBeGreaterThan(d('2026-05-11T10:00:30.000').getTime());
    });

    it('returns the next 9am when fired at midnight', () => {
        const cron = parseCronExpression('0 9 * * *');
        const from = new Date(2026, 4, 11, 0, 0, 0); // local May 11 2026 00:00
        const next = nextFireAt(cron, from);
        expect(next.getHours()).toBe(9);
        expect(next.getMinutes()).toBe(0);
        expect(next.getDate()).toBe(11);
        expect(next.getMonth()).toBe(4);
    });

    it('rolls over to next day when the time already passed', () => {
        const cron = parseCronExpression('0 9 * * *');
        const from = new Date(2026, 4, 11, 10, 0, 0); // 10:00 — already past 9am
        const next = nextFireAt(cron, from);
        expect(next.getDate()).toBe(12);
        expect(next.getHours()).toBe(9);
    });

    it('matches dayOfWeek-only constraint', () => {
        // Every Monday at noon.
        const cron = parseCronExpression('0 12 * * 1');
        const from = new Date(2026, 4, 11, 13, 0, 0); // Monday May 11 2026, 13:00 local
        // Next Monday noon is May 18.
        const next = nextFireAt(cron, from);
        expect(next.getDay()).toBe(1);
        expect(next.getHours()).toBe(12);
    });

    it('when both DoM and DoW are restricted, OR-matches them (standard cron)', () => {
        // Fire on day-of-month 15 OR weekday Friday at 08:00.
        const cron = parseCronExpression('0 8 15 * 5');
        // From May 1 2026 Friday 00:00 — should fire the same day at 08:00.
        const from = new Date(2026, 4, 1, 0, 0, 0);
        const next = nextFireAt(cron, from);
        expect(next.getMonth()).toBe(4);
        expect(next.getDate()).toBe(1);
        expect(next.getHours()).toBe(8);
    });

    it('returns a Date with seconds and ms zeroed', () => {
        const cron = parseCronExpression('0 9 * * *');
        const next = nextFireAt(cron, d('2026-05-11T00:00:00.123'));
        expect(next.getSeconds()).toBe(0);
        expect(next.getMilliseconds()).toBe(0);
    });

    it('handles month rollover', () => {
        // 1st of each month at 00:00.
        const cron = parseCronExpression('0 0 1 * *');
        const from = new Date(2026, 4, 15, 0, 0, 0); // mid-May
        const next = nextFireAt(cron, from);
        expect(next.getMonth()).toBe(5); // June
        expect(next.getDate()).toBe(1);
        expect(next.getHours()).toBe(0);
    });

    it('handles year rollover', () => {
        const cron = parseCronExpression('0 0 1 1 *');
        const from = new Date(2026, 5, 15, 0, 0, 0); // June 2026
        const next = nextFireAt(cron, from);
        expect(next.getFullYear()).toBe(2027);
        expect(next.getMonth()).toBe(0);
        expect(next.getDate()).toBe(1);
    });
});
