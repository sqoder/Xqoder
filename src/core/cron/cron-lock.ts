// P19b — cron advisory lock (SQLite-backed).
//
// Prevents two xqoder processes from firing the same cron job at the same
// fire-minute. We use a unique row in the shared cron DB keyed by
// (jobId, minuteSlot) rather than flock — Docker's behaviour around flock
// on bind-mounted volumes is unreliable, and SQLite's unique-constraint
// insert is atomic across processes on the same file.
//
// The lock is *best-effort*: we don't try to coordinate clocks across
// machines. For a single-host multi-process setup — the only scenario we
// support for v1 — insert-with-unique-row is enough.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    createSqliteDatabase,
    type SqliteDatabase,
} from '../agent/session/sqlite-runtime.js';

export interface CronLock {
    /** Try to claim (jobId, minuteSlot). Returns true iff this caller wins. */
    tryAcquire(jobId: string, firedAt: Date): boolean;
    /** Release a previously acquired slot (best-effort, idempotent). */
    release(jobId: string, firedAt: Date): void;
    /** Drop locks older than `olderThanMs` — keeps the table small. */
    purgeOlderThan(olderThanMs: number, now?: Date): number;
    close(): void;
}

export function createCronLock(dbPath: string): CronLock {
    const resolved = path.resolve(dbPath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const db = createSqliteDatabase(resolved);
    ensureLockSchema(db);

    return {
        tryAcquire(jobId, firedAt) {
            const slot = toMinuteSlot(firedAt);
            const now = new Date().toISOString();
            try {
                db.prepare(`
                    INSERT INTO cron_locks (job_id, minute_slot, acquired_at)
                    VALUES (?, ?, ?)
                `).run(jobId, slot, now);
                return true;
            } catch (err) {
                if (isUniqueConstraintError(err)) {
                    return false;
                }
                throw err;
            }
        },

        release(jobId, firedAt) {
            const slot = toMinuteSlot(firedAt);
            db.prepare(`
                DELETE FROM cron_locks WHERE job_id = ? AND minute_slot = ?
            `).run(jobId, slot);
        },

        purgeOlderThan(olderThanMs, now = new Date()) {
            // Purge by minute_slot — the slot is the *scheduled* fire time, and
            // is deterministic across processes. Using acquired_at (insertion
            // wall clock) would make purge flaky when clocks drift.
            //
            // The shared DatabaseLike.run() signature returns void, so we
            // count first to report how many rows we're about to drop. Both
            // statements share the same DB handle and this method isn't on a
            // hot path, so two queries is fine.
            const threshold = new Date(now.getTime() - olderThanMs).toISOString();
            const countRow = db.prepare(
                'SELECT COUNT(*) AS n FROM cron_locks WHERE minute_slot < ?',
            ).get(threshold) as { n: number } | undefined;
            const toDelete = countRow?.n ?? 0;
            if (toDelete > 0) {
                db.prepare('DELETE FROM cron_locks WHERE minute_slot < ?').run(threshold);
            }
            return toDelete;
        },

        close() {
            db.close();
        },
    };
}

function toMinuteSlot(d: Date): string {
    // Minute-precision ISO — the same scheduled fire minute across processes
    // must round to the same string. Trim seconds + ms to be safe.
    const floored = new Date(d.getTime());
    floored.setSeconds(0, 0);
    return floored.toISOString();
}

function isUniqueConstraintError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const message = String((err as { message?: unknown }).message ?? '');
    return /UNIQUE constraint failed|constraint failed.*cron_locks/i.test(message);
}

function ensureLockSchema(db: SqliteDatabase): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS cron_locks (
            job_id TEXT NOT NULL,
            minute_slot TEXT NOT NULL,
            acquired_at TEXT NOT NULL,
            PRIMARY KEY (job_id, minute_slot)
        );
        CREATE INDEX IF NOT EXISTS idx_cron_locks_acquired_at
            ON cron_locks(acquired_at);
    `);
}
