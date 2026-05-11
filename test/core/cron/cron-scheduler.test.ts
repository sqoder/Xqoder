// P19b — cron-scheduler tests.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCronLock, type CronLock } from '../../../src/core/cron/cron-lock.js';
import {
    createCronScheduler,
    type CronDispatchRecord,
    type CronScheduler,
} from '../../../src/core/cron/cron-scheduler.js';
import {
    createCronStore,
    type CronJob,
    type CronStore,
} from '../../../src/core/cron/cron-store.js';

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'xq-cron-sch-'));
}

interface Harness {
    store: CronStore;
    lock: CronLock;
    scheduler: CronScheduler;
    dispatched: Array<{ jobId: string; firedAt: Date }>;
    close: () => void;
}

function makeHarness(opts: {
    dispatch?: (job: CronJob, firedAt: Date) => Promise<void> | void;
    now?: () => Date;
} = {}): Harness {
    const dir = tmpDir();
    const store = createCronStore(path.join(dir, 'cron.sqlite'));
    const lock = createCronLock(path.join(dir, 'cron.sqlite'));
    const dispatched: Array<{ jobId: string; firedAt: Date }> = [];
    const scheduler = createCronScheduler({
        store,
        lock,
        now: opts.now,
        dispatch: async (job, firedAt) => {
            dispatched.push({ jobId: job.id, firedAt });
            if (opts.dispatch) await opts.dispatch(job, firedAt);
        },
    });
    return {
        store,
        lock,
        scheduler,
        dispatched,
        close: () => {
            scheduler.stop();
            lock.close();
            store.close();
        },
    };
}

describe('createCronScheduler', () => {
    let h: Harness;
    afterEach(() => {
        h.close();
    });

    it('fires a job whose nextFireAt has passed', async () => {
        h = makeHarness();
        const creationTime = new Date(2026, 4, 11, 8, 59, 0);
        h.store.create(
            {
                expression: '0 9 * * *',
                template: { title: 'brief', type: 'shell', command: 'echo hi' },
            },
            creationTime,
        );
        const fireTime = new Date(2026, 4, 11, 9, 0, 0);
        const records = await h.scheduler.tick(fireTime);
        expect(records.length).toBe(1);
        expect(records[0]!.error).toBeUndefined();
        expect(h.dispatched.length).toBe(1);
        expect(h.dispatched[0]!.firedAt.getHours()).toBe(9);
    });

    it('does not fire a job whose nextFireAt is still in the future', async () => {
        h = makeHarness();
        const creationTime = new Date(2026, 4, 11, 8, 0, 0);
        h.store.create(
            {
                expression: '0 9 * * *',
                template: { title: 'brief', type: 'shell', command: 'echo hi' },
            },
            creationTime,
        );
        const records = await h.scheduler.tick(new Date(2026, 4, 11, 8, 30, 0));
        expect(records.length).toBe(0);
        expect(h.dispatched.length).toBe(0);
    });

    it('skips disabled jobs', async () => {
        h = makeHarness();
        h.store.create(
            {
                expression: '0 9 * * *',
                template: { title: 'paused', type: 'shell', command: 'echo hi' },
                enabled: false,
            },
            new Date(2026, 4, 11, 0, 0, 0),
        );
        const records = await h.scheduler.tick(new Date(2026, 4, 11, 9, 0, 0));
        expect(records.length).toBe(0);
        expect(h.dispatched.length).toBe(0);
    });

    it('advances nextFireAt after a fire', async () => {
        h = makeHarness();
        const job = h.store.create(
            {
                expression: '0 9 * * *',
                template: { title: 'brief', type: 'shell', command: 'echo hi' },
            },
            new Date(2026, 4, 11, 8, 0, 0),
        );
        await h.scheduler.tick(new Date(2026, 4, 11, 9, 0, 0));
        const after = h.store.get(job.id)!;
        expect(after.lastFiredAt).toBeDefined();
        expect(after.lastFiredAt!.getHours()).toBe(9);
        // Next fire is tomorrow 09:00
        expect(after.nextFireAt!.getDate()).toBe(12);
        expect(after.nextFireAt!.getHours()).toBe(9);
    });

    it('does not re-fire the same slot across repeated ticks at the same minute', async () => {
        h = makeHarness();
        h.store.create(
            {
                expression: '0 9 * * *',
                template: { title: 'brief', type: 'shell', command: 'echo hi' },
            },
            new Date(2026, 4, 11, 8, 0, 0),
        );
        const fireTime = new Date(2026, 4, 11, 9, 0, 0);
        await h.scheduler.tick(fireTime);
        await h.scheduler.tick(fireTime);
        expect(h.dispatched.length).toBe(1);
    });

    it('two scheduler instances on the same DB only dispatch once per slot', async () => {
        // Simulates two xqoder processes sharing the same cron DB —
        // advisory lock must prevent double-dispatch.
        const dir = tmpDir();
        const dbPath = path.join(dir, 'cron.sqlite');
        const storeA = createCronStore(dbPath);
        const storeB = createCronStore(dbPath);
        const lockA = createCronLock(dbPath);
        const lockB = createCronLock(dbPath);
        const dispatched: string[] = [];
        const schA = createCronScheduler({
            store: storeA,
            lock: lockA,
            dispatch: (job) => {
                dispatched.push(`A:${job.id}`);
            },
        });
        const schB = createCronScheduler({
            store: storeB,
            lock: lockB,
            dispatch: (job) => {
                dispatched.push(`B:${job.id}`);
            },
        });
        storeA.create(
            {
                expression: '0 9 * * *',
                template: { title: 'dup', type: 'shell', command: 'echo x' },
            },
            new Date(2026, 4, 11, 8, 0, 0),
        );
        const fireTime = new Date(2026, 4, 11, 9, 0, 0);
        try {
            await schA.tick(fireTime);
            await schB.tick(fireTime);
            expect(dispatched.length).toBe(1);
        } finally {
            schA.stop();
            schB.stop();
            lockA.close();
            lockB.close();
            storeA.close();
            storeB.close();
        }
        // Harness.close in afterEach expects `h` set — give it a no-op one.
        h = {
            store: createCronStore(path.join(tmpDir(), 'noop.sqlite')),
            lock: createCronLock(path.join(tmpDir(), 'noop.sqlite')),
            scheduler: createCronScheduler({
                store: {} as never,
                lock: {} as never,
                dispatch: () => {},
            }),
            dispatched: [],
            close: () => {},
        };
    });

    it('dispatch error is recorded but does not block other jobs', async () => {
        let thrown = false;
        h = makeHarness({
            dispatch: async (job) => {
                if (job.template.title === 'boom') {
                    thrown = true;
                    throw new Error('kaboom');
                }
            },
        });
        h.store.create(
            {
                expression: '0 9 * * *',
                template: { title: 'boom', type: 'shell', command: 'echo x' },
            },
            new Date(2026, 4, 11, 8, 0, 0),
        );
        h.store.create(
            {
                expression: '0 9 * * *',
                template: { title: 'ok', type: 'shell', command: 'echo ok' },
            },
            new Date(2026, 4, 11, 8, 0, 0),
        );
        const records = await h.scheduler.tick(new Date(2026, 4, 11, 9, 0, 0));
        expect(thrown).toBe(true);
        expect(records.length).toBe(2);
        const boomRec = records.find((r) => r.job.template.title === 'boom')!;
        const okRec = records.find((r) => r.job.template.title === 'ok')!;
        expect(boomRec.error).toBeDefined();
        expect(okRec.error).toBeUndefined();
    });

    it('start / stop is idempotent', async () => {
        h = makeHarness({ now: () => new Date(2026, 4, 11, 8, 0, 0) });
        expect(h.scheduler.isRunning()).toBe(false);
        h.scheduler.start();
        expect(h.scheduler.isRunning()).toBe(true);
        h.scheduler.start();
        expect(h.scheduler.isRunning()).toBe(true);
        h.scheduler.stop();
        h.scheduler.stop();
        expect(h.scheduler.isRunning()).toBe(false);
    });

    it('dispatch can be sync', async () => {
        const seen: string[] = [];
        h = makeHarness({
            dispatch: (job) => {
                seen.push(job.id);
            },
        });
        const job = h.store.create(
            {
                expression: '* * * * *',
                template: { title: 'sync', type: 'shell', command: 'echo x' },
            },
            new Date(2026, 4, 11, 8, 0, 0),
        );
        await h.scheduler.tick(new Date(2026, 4, 11, 8, 1, 0));
        expect(seen).toContain(job.id);
    });

    it('returns one record per fired slot even if caller ticks late', async () => {
        // If the scheduler wakes 5 minutes late on "* * * * *", we still
        // only fire *once* per tick — multi-fire catch-up is not a v1 goal.
        h = makeHarness();
        h.store.create(
            {
                expression: '* * * * *',
                template: { title: 'every', type: 'shell', command: 'echo x' },
            },
            new Date(2026, 4, 11, 8, 0, 0),
        );
        const records = await h.scheduler.tick(new Date(2026, 4, 11, 8, 5, 30));
        expect(records.length).toBe(1);
    });
});

describe('CronDispatchRecord', () => {
    it('carries the fire time + job reference', async () => {
        const dir = tmpDir();
        const store = createCronStore(path.join(dir, 'cron.sqlite'));
        const lock = createCronLock(path.join(dir, 'cron.sqlite'));
        const scheduler = createCronScheduler({
            store,
            lock,
            dispatch: () => {},
        });
        try {
            const job = store.create(
                {
                    expression: '0 9 * * *',
                    template: { title: 'x', type: 'shell', command: 'echo x' },
                },
                new Date(2026, 4, 11, 8, 0, 0),
            );
            const fireTime = new Date(2026, 4, 11, 9, 0, 0);
            const records: CronDispatchRecord[] = await scheduler.tick(fireTime);
            expect(records[0]!.jobId).toBe(job.id);
            expect(records[0]!.firedAt.getHours()).toBe(9);
            expect(records[0]!.job.template.title).toBe('x');
        } finally {
            scheduler.stop();
            lock.close();
            store.close();
        }
    });
});
