// P19a — `xqoder task` CLI tests.

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getTaskService, type TaskService } from '../../../src/core/tasks/task-service.js';
import {
    runCreate,
    runGet,
    runList,
    runOutput,
    runStop,
    runUpdate,
} from '../../../src/commands/core/task.js';

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeService(): { service: TaskService; workspace: string; lines: string[] } {
    const workspace = tmpDir('xq-task-cli-');
    const home = tmpDir('xq-home-');
    const service = getTaskService({
        homeDir: home,
        dbPath: path.join(workspace, 'tasks.sqlite'),
        logDir: path.join(workspace, 'task-logs'),
    });
    const lines: string[] = [];
    return { service, workspace, lines };
}

describe('xqoder task CLI', () => {
    let ctx: ReturnType<typeof makeService>;

    beforeEach(() => {
        ctx = makeService();
    });
    afterEach(() => {
        ctx.service.close();
    });

    it('runCreate without --background creates a pending task and prints human line', () => {
        const task = runCreate(
            'hello',
            { type: 'shell', command: 'echo hi' },
            {
                service: ctx.service,
                cwd: ctx.workspace,
                writeOutput: (line) => ctx.lines.push(line),
            },
        );
        expect(task.status).toBe('pending');
        expect(ctx.lines.join('\n')).toContain(`Created ${task.id}`);
    });

    it('runCreate with --background spawns the task and reports pid', async () => {
        const task = runCreate(
            'bg',
            { type: 'shell', command: 'echo ok', background: true },
            {
                service: ctx.service,
                cwd: ctx.workspace,
                writeOutput: (line) => ctx.lines.push(line),
            },
        );
        expect(task.status).toBe('running');
        const handle = ctx.service.getHandle(task.id);
        expect(handle).toBeDefined();
        await handle!.done;
        expect(ctx.service.store.get(task.id)?.status).toBe('completed');
        expect(ctx.lines.join('\n')).toMatch(/Started .*pid=\d+/);
    });

    it('runCreate --json emits a JSON object', () => {
        const task = runCreate(
            'x',
            { type: 'shell', command: 'x', json: true },
            {
                service: ctx.service,
                cwd: ctx.workspace,
                writeOutput: (line) => ctx.lines.push(line),
            },
        );
        const parsed = JSON.parse(ctx.lines.join('\n')) as { id: string; status: string };
        expect(parsed.id).toBe(task.id);
        expect(parsed.status).toBe('pending');
    });

    it('runCreate rejects --type shell without --command', () => {
        expect(() =>
            runCreate(
                't',
                { type: 'shell' },
                {
                    service: ctx.service,
                    cwd: ctx.workspace,
                    writeOutput: () => {},
                },
            ),
        ).toThrow(/--command/);
    });

    it('runList --json emits an array of tasks', () => {
        ctx.service.store.create({ title: 'a', type: 'shell', command: 'a' });
        ctx.service.store.create({ title: 'b', type: 'shell', command: 'b' });
        runList(
            { json: true },
            {
                service: ctx.service,
                writeOutput: (line) => ctx.lines.push(line),
            },
        );
        const parsed = JSON.parse(ctx.lines.join('\n')) as Array<{ id: string }>;
        expect(parsed.length).toBe(2);
    });

    it('runGet returns a task or throws on 404', () => {
        const created = ctx.service.store.create({ title: 't', type: 'shell', command: 't' });
        const task = runGet(
            created.id,
            { json: true },
            { service: ctx.service, writeOutput: (line) => ctx.lines.push(line) },
        );
        expect(task.id).toBe(created.id);

        expect(() =>
            runGet('task_nope', {}, { service: ctx.service, writeOutput: () => {} }),
        ).toThrow(/not found/);
    });

    it('runOutput reads tail of the log', () => {
        const task = ctx.service.store.create({ title: 'o', type: 'shell', command: 'x' });
        const logPath = path.join(ctx.service.logDir, `${task.id}.log`);
        fs.mkdirSync(ctx.service.logDir, { recursive: true });
        fs.writeFileSync(logPath, 'hello-log');
        ctx.service.store.update(task.id, { logPath, status: 'completed', exitCode: 0 });

        const result = runOutput(task.id, {}, { service: ctx.service, writeOutput: (line) => ctx.lines.push(line) });
        expect(result.output).toContain('hello-log');
    });

    it('runStop marks an already-terminal task without signalling', () => {
        const task = ctx.service.store.create({ title: 't', type: 'shell', command: 'x' });
        ctx.service.store.update(task.id, { status: 'completed', exitCode: 0 });
        const updated = runStop(
            task.id,
            { json: true },
            { service: ctx.service, writeOutput: (line) => ctx.lines.push(line) },
        );
        expect(updated.status).toBe('completed');
        const parsed = JSON.parse(ctx.lines.join('\n')) as { signalled: boolean };
        expect(parsed.signalled).toBe(false);
    });

    it('runUpdate changes title and rejects invalid status', () => {
        const task = ctx.service.store.create({ title: 'old', type: 'shell', command: 'x' });
        const updated = runUpdate(
            task.id,
            { title: 'new' },
            { service: ctx.service, writeOutput: (line) => ctx.lines.push(line) },
        );
        expect(updated.title).toBe('new');

        expect(() =>
            runUpdate(
                task.id,
                { status: 'bogus' },
                { service: ctx.service, writeOutput: () => {} },
            ),
        ).toThrow(/invalid --status/);
    });
});
