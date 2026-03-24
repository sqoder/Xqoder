import { describe, expect, it } from 'vitest';
import {
    DAEMON_IDLE_TIMEOUT_ENV,
    DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
    formatDaemonIdleTimeout,
    getDaemonIdleCheckIntervalMs,
    parseDaemonIdleTimeout,
    resolveDaemonIdleTimeout,
} from './idle-timeout.js';

describe('daemon idle timeout', () => {
    it('parses raw millisecond values and suffixed durations', () => {
        expect(parseDaemonIdleTimeout('1800000')).toBe(1_800_000);
        expect(parseDaemonIdleTimeout('45s')).toBe(45_000);
        expect(parseDaemonIdleTimeout('30m')).toBe(1_800_000);
        expect(parseDaemonIdleTimeout('1h')).toBe(3_600_000);
    });

    it('rejects invalid duration strings', () => {
        expect(parseDaemonIdleTimeout('')).toBeUndefined();
        expect(parseDaemonIdleTimeout('-1')).toBeUndefined();
        expect(parseDaemonIdleTimeout('15min')).toBeUndefined();
        expect(parseDaemonIdleTimeout('abc')).toBeUndefined();
    });

    it('falls back to the default timeout when env is missing or invalid', () => {
        expect(resolveDaemonIdleTimeout({})).toEqual({
            timeoutMs: DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
            disabled: false,
            source: 'default',
        });

        const resolved = resolveDaemonIdleTimeout({
            [DAEMON_IDLE_TIMEOUT_ENV]: 'oops',
        });
        expect(resolved.timeoutMs).toBe(DEFAULT_DAEMON_IDLE_TIMEOUT_MS);
        expect(resolved.disabled).toBe(false);
        expect(resolved.source).toBe('default');
        expect(resolved.warning).toContain(DAEMON_IDLE_TIMEOUT_ENV);
    });

    it('allows disabling idle shutdown with zero', () => {
        expect(resolveDaemonIdleTimeout({
            [DAEMON_IDLE_TIMEOUT_ENV]: '0',
        })).toEqual({
            timeoutMs: 0,
            disabled: true,
            source: 'env',
            rawValue: '0',
        });
    });

    it('derives a sane poll interval for the configured timeout', () => {
        expect(getDaemonIdleCheckIntervalMs(5_000)).toBe(1_250);
        expect(getDaemonIdleCheckIntervalMs(1_800_000)).toBe(60_000);
        expect(getDaemonIdleCheckIntervalMs(0)).toBe(60_000);
    });

    it('formats timeout values for logs', () => {
        expect(formatDaemonIdleTimeout(0)).toBe('disabled');
        expect(formatDaemonIdleTimeout(45_000)).toBe('45s');
        expect(formatDaemonIdleTimeout(1_800_000)).toBe('30m');
    });
});
