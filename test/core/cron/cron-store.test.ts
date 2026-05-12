// P19b — cron-store SQLite tests.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    createCronStore,
    type CronStore,
} from '../../../src/core/cron/cron-store.js';

function tmpDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-cron-'));
    return path.join(dir, 'cron.sqlite');
}

describe('createCronStore', () => {
    let store: CronStore;

    beforeEach(() => {
        store = createCronStore(tmpDbPath());
    });

    afterEach(() => {
        store.close();
    });

    it('creates an enabled cron job with computed nextFireAt', () => {
        const now = new Date(2026, 4, 11, 0, 0, 0); // 2026-05-11 00:00 local
        const job = store.create(
            {
                expression: '0 9 * * *',
                template: { title: 'Morning brief', type: 'shell', command: 'echo hi' },
            },
            now,
        );
        expect(job.id).toMatch(/^cron_/);
        expect(job.expression).toBe('0 9 * * *');
        expect(job.enabled).toBe(true);
        expect(job.template.title).toBe('Morning brief');
        expect(job.template.type).toBe('shell');
        expect(job.template.command).toBe('echo hi');
        expect(job.nextFireAt).toBeDefined();
        expect(job.nextFireAt!.getHours()).toBe(9);
        expect(job.nextFireAt!.getMinutes()).toBe(0);
    });

    it('rejects an invalid cron expression', () => {
        expect(() =>
            store.create({
                expression: 'not-a-cron',
                template: { title: 'x', type: 'shell' },
            }),
        ).toThrow(/Invalid cron expression/);
    });

    it('rejects a template missing title', () => {
        expect(() =>
            store.create({
                expression: '* * * * *',
                template: { title: '', type: 'shell' },
            }),
        ).toThrow(/title/);
    });

    it('rejects a template with an unknown task type', () => {
        expect(() =>
            store.create({
                expression: '* * * * *',
                template: { title: 'x', type: 'unknown' as unknown as 'shell' },
            }),
        ).toThrow(/type/);
    });

    it('can create a disabled job with nextFireAt null', () => {
        const job = store.create({
            expression: '* * * * *',
            template: { title: 'x', type: 'shell', command: 'echo x' },
            enabled: false,
        });
        expect(job.enabled).toBe(false);
        expect(job.nextFireAt).toBeUndefined();
    });

    it('lists jobs newest first and filters by enabled', () => {
        store.create({
            expression: '0 9 * * *',
            template: { title: 'a', type: 'shell', command: 'echo a' },
        });
        store.create({
            expression: '0 10 * * *',
            template: { title: 'b', type: 'shell', command: 'echo b' },
            enabled: false,
        });
        const all = store.list();
        expect(all.length).toBe(2);
        const enabled = store.list({ enabled: true });
        expect(enabled.length).toBe(1);
        expect(enabled[0]!.template.title).toBe('a');
    });

    it('update recomputes nextFireAt when enabled toggles on', () => {
        const job = store.create({
            expression: '0 9 * * *',
            template: { title: 'x', type: 'shell', command: 'echo x' },
            enabled: false,
        });
        expect(job.nextFireAt).toBeUndefined();
        const enabled = store.update(job.id, { enabled: true });
        expect(enabled.nextFireAt).toBeDefined();
        expect(enabled.nextFireAt!.getHours()).toBe(9);
    });

    it('update clears nextFireAt when disabling', () => {
        const job = store.create({
            expression: '0 9 * * *',
            template: { title: 'x', type: 'shell', command: 'echo x' },
        });
        const disabled = store.update(job.id, { enabled: false });
        expect(disabled.nextFireAt).toBeUndefined();
    });

    it('update recomputes nextFireAt when expression changes', () => {
        const job = store.create({
            expression: '0 9 * * *',
            template: { title: 'x', type: 'shell', command: 'echo x' },
        });
        const updated = store.update(job.id, { expression: '0 15 * * *' });
        expect(updated.expression).toBe('0 15 * * *');
        expect(updated.nextFireAt!.getHours()).toBe(15);
    });

    it('update rejects a bad expression', () => {
        const job = store.create({
            expression: '0 9 * * *',
            template: { title: 'x', type: 'shell', command: 'echo x' },
        });
        expect(() => store.update(job.id, { expression: 'bogus' })).toThrow(/Invalid cron/);
    });

    it('recordFire updates lastFiredAt and advances nextFireAt', () => {
        const job = store.create({
            expression: '0 9 * * *',
            template: { title: 'x', type: 'shell', command: 'echo x' },
        });
        const firedAt = new Date(2026, 4, 11, 9, 0, 0);
        const after = store.recordFire(job.id, firedAt);
        expect(after.lastFiredAt!.getTime()).toBe(firedAt.getTime());
        expect(after.nextFireAt!.getDate()).toBe(12); // tomorrow 9am
        expect(after.nextFireAt!.getHours()).toBe(9);
    });

    it('delete removes the job', () => {
        const job = store.create({
            expression: '* * * * *',
            template: { title: 'x', type: 'shell', command: 'echo x' },
        });
        store.delete(job.id);
        expect(store.get(job.id)).toBeNull();
    });

    it('persists across store reopens on the same path', () => {
        const db = tmpDbPath();
        const s1 = createCronStore(db);
        const job = s1.create({
            expression: '0 9 * * *',
            template: { title: 'stays', type: 'shell', command: 'echo x' },
        });
        s1.close();
        const s2 = createCronStore(db);
        const reloaded = s2.get(job.id);
        expect(reloaded).not.toBeNull();
        expect(reloaded!.expression).toBe('0 9 * * *');
        s2.close();
    });
});
