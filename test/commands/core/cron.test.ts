// P19b — `xqoder cron` CLI tests.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    runCreate,
    runGet,
    runList,
    runRemove,
    runSetEnabled,
} from '../../../src/commands/core/cron.js';
import {
    __resetCronServiceCacheForTests,
    getCronService,
    type CronService,
} from '../../../src/core/cron/cron-service.js';
import {
    __resetTaskServiceCacheForTests,
    getTaskService,
} from '../../../src/core/tasks/task-service.js';

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface Ctx {
    service: CronService;
    workspace: string;
    lines: string[];
    deps: {
        service: CronService;
        cwd: string;
        writeOutput: (line: string) => void;
    };
}

function setup(): Ctx {
    const workspace = tmpDir('xq-cron-cli-');
    const home = tmpDir('xq-home-');
    getTaskService({
        homeDir: home,
        dbPath: path.join(workspace, 'tasks.sqlite'),
        logDir: path.join(workspace, 'task-logs'),
    });
    const service = getCronService({
        homeDir: home,
        dbPath: path.join(workspace, 'cron.sqlite'),
        defaultCwd: workspace,
    });
    const lines: string[] = [];
    return {
        service,
        workspace,
        lines,
        deps: {
            service,
            cwd: workspace,
            writeOutput: (line) => lines.push(line),
        },
    };
}

describe('cron CLI handlers', () => {
    let ctx: Ctx;

    beforeEach(() => {
        __resetCronServiceCacheForTests();
        __resetTaskServiceCacheForTests();
        ctx = setup();
    });

    afterEach(() => {
        ctx.service.close();
        __resetTaskServiceCacheForTests();
    });

    it('runCreate schedules a shell cron and prints the id + next fire', () => {
        const job = runCreate(
            'brief',
            { at: '0 9 * * *', type: 'shell', command: 'echo hi' },
            ctx.deps,
        );
        expect(job.expression).toBe('0 9 * * *');
        expect(job.enabled).toBe(true);
        expect(ctx.lines.join('\n')).toContain(`Scheduled ${job.id}`);
        expect(ctx.lines.join('\n')).toContain('next fire');
    });

    it('runCreate --disabled stores an inactive job', () => {
        const job = runCreate(
            'paused',
            { at: '0 9 * * *', type: 'shell', command: 'echo hi', disabled: true },
            ctx.deps,
        );
        expect(job.enabled).toBe(false);
        expect(ctx.lines.join('\n')).toContain('(disabled)');
    });

    it('runCreate --json emits JSON output', () => {
        runCreate(
            'brief',
            { at: '0 9 * * *', type: 'shell', command: 'echo hi', json: true },
            ctx.deps,
        );
        const parsed = JSON.parse(ctx.lines[0]!) as { expression: string };
        expect(parsed.expression).toBe('0 9 * * *');
    });

    it('runCreate defaults template.cwd to deps.cwd when not given', () => {
        const job = runCreate(
            'brief',
            { at: '0 9 * * *', type: 'shell', command: 'echo hi' },
            ctx.deps,
        );
        expect(job.template.cwd).toBe(ctx.workspace);
    });

    it('runCreate rejects an invalid cron expression', () => {
        expect(() =>
            runCreate(
                'x',
                { at: 'bogus', type: 'shell', command: 'echo hi' },
                ctx.deps,
            ),
        ).toThrow(/invalid --at/);
    });

    it('runCreate rejects type=shell without --command', () => {
        expect(() =>
            runCreate('x', { at: '0 9 * * *', type: 'shell' }, ctx.deps),
        ).toThrow(/--command/);
    });

    it('runList returns newest first and filters by enabled/disabled', () => {
        runCreate('a', { at: '0 9 * * *', type: 'shell', command: 'a' }, ctx.deps);
        runCreate(
            'b',
            { at: '0 10 * * *', type: 'shell', command: 'b', disabled: true },
            ctx.deps,
        );
        ctx.lines.length = 0;
        const all = runList({}, ctx.deps);
        expect(all.length).toBe(2);
        ctx.lines.length = 0;
        const onlyEnabled = runList({ enabled: true }, ctx.deps);
        expect(onlyEnabled.length).toBe(1);
        expect(onlyEnabled[0]!.template.title).toBe('a');
        ctx.lines.length = 0;
        const onlyDisabled = runList({ disabled: true }, ctx.deps);
        expect(onlyDisabled.length).toBe(1);
        expect(onlyDisabled[0]!.template.title).toBe('b');
    });

    it('runList errors when --enabled and --disabled are combined', () => {
        expect(() =>
            runList({ enabled: true, disabled: true }, ctx.deps),
        ).toThrow(/cannot combine/);
    });

    it('runList prints "No cron jobs found." when store is empty', () => {
        runList({}, ctx.deps);
        expect(ctx.lines.join('\n')).toContain('No cron jobs found.');
    });

    it('runGet throws on unknown id and returns the job otherwise', () => {
        const job = runCreate(
            'a',
            { at: '0 9 * * *', type: 'shell', command: 'a' },
            ctx.deps,
        );
        ctx.lines.length = 0;
        const fetched = runGet(job.id, {}, ctx.deps);
        expect(fetched.id).toBe(job.id);
        expect(() => runGet('cron_missing', {}, ctx.deps)).toThrow(/not found/);
    });

    it('runRemove deletes the job and returns the removed snapshot', () => {
        const job = runCreate(
            'a',
            { at: '0 9 * * *', type: 'shell', command: 'a' },
            ctx.deps,
        );
        ctx.lines.length = 0;
        const removed = runRemove(job.id, {}, ctx.deps);
        expect(removed.id).toBe(job.id);
        expect(ctx.service.store.get(job.id)).toBeNull();
        expect(ctx.lines.join('\n')).toContain(`Removed ${job.id}`);
    });

    it('runSetEnabled toggles enabled flag and recomputes nextFireAt', () => {
        const job = runCreate(
            'a',
            { at: '0 9 * * *', type: 'shell', command: 'a', disabled: true },
            ctx.deps,
        );
        expect(job.nextFireAt).toBeUndefined();
        ctx.lines.length = 0;
        const enabled = runSetEnabled(job.id, true, {}, ctx.deps);
        expect(enabled.enabled).toBe(true);
        expect(enabled.nextFireAt).toBeDefined();
        const disabled = runSetEnabled(job.id, false, {}, ctx.deps);
        expect(disabled.enabled).toBe(false);
        expect(disabled.nextFireAt).toBeUndefined();
    });
});
