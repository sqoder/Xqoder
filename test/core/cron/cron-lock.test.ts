// P19b — cron-lock tests.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCronLock, type CronLock } from '../../../src/core/cron/cron-lock.js';

function tmpDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-cron-lock-'));
    return path.join(dir, 'cron.sqlite');
}

describe('createCronLock', () => {
    let dbPath: string;
    let lock: CronLock;

    beforeEach(() => {
        dbPath = tmpDbPath();
        lock = createCronLock(dbPath);
    });

    afterEach(() => {
        lock.close();
    });

    it('first caller wins the minute slot, second fails', () => {
        const fireAt = new Date(2026, 4, 11, 9, 0, 0);
        expect(lock.tryAcquire('job_a', fireAt)).toBe(true);
        expect(lock.tryAcquire('job_a', fireAt)).toBe(false);
    });

    it('different jobs in the same minute do not collide', () => {
        const fireAt = new Date(2026, 4, 11, 9, 0, 0);
        expect(lock.tryAcquire('job_a', fireAt)).toBe(true);
        expect(lock.tryAcquire('job_b', fireAt)).toBe(true);
    });

    it('same job in a different minute does not collide', () => {
        const a = new Date(2026, 4, 11, 9, 0, 0);
        const b = new Date(2026, 4, 11, 9, 1, 0);
        expect(lock.tryAcquire('job_a', a)).toBe(true);
        expect(lock.tryAcquire('job_a', b)).toBe(true);
    });

    it('seconds/ms within the same minute count as the same slot', () => {
        const a = new Date(2026, 4, 11, 9, 0, 0);
        const b = new Date(2026, 4, 11, 9, 0, 59);
        expect(lock.tryAcquire('job_a', a)).toBe(true);
        expect(lock.tryAcquire('job_a', b)).toBe(false);
    });

    it('release allows re-acquisition of the same slot', () => {
        const fireAt = new Date(2026, 4, 11, 9, 0, 0);
        expect(lock.tryAcquire('job_a', fireAt)).toBe(true);
        lock.release('job_a', fireAt);
        expect(lock.tryAcquire('job_a', fireAt)).toBe(true);
    });

    it('release is idempotent on an unheld slot', () => {
        expect(() =>
            lock.release('never', new Date(2026, 4, 11, 9, 0, 0)),
        ).not.toThrow();
    });

    it('two processes sharing a DB cannot both claim the slot', () => {
        const fireAt = new Date(2026, 4, 11, 9, 0, 0);
        const other = createCronLock(dbPath);
        try {
            expect(lock.tryAcquire('job_a', fireAt)).toBe(true);
            expect(other.tryAcquire('job_a', fireAt)).toBe(false);
        } finally {
            other.close();
        }
    });

    it('purgeOlderThan removes stale rows', () => {
        const old = new Date(2026, 4, 11, 9, 0, 0);
        lock.tryAcquire('job_a', old);
        const now = new Date(old.getTime() + 10 * 60_000); // 10 min later
        const purged = lock.purgeOlderThan(5 * 60_000, now);
        expect(purged).toBe(1);
        // Re-acquire the same slot after purge succeeds.
        expect(lock.tryAcquire('job_a', old)).toBe(true);
    });
});
