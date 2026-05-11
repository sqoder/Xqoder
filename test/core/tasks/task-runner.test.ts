// P19a — task-runner dispatch tests.

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTaskStore, type TaskStore } from '../../../src/core/tasks/task-store.js';
import { runTask, startTask } from '../../../src/core/tasks/task-runner.js';

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runTask', () => {
    let store: TaskStore;
    let workspace: string;
    beforeEach(() => {
        workspace = tmpDir('xq-runner-');
        store = createTaskStore(path.join(workspace, 'tasks.sqlite'));
    });
    afterEach(() => store.close());

    it('dispatches shell type to LocalShellTask', async () => {
        const task = store.create({ title: 't', type: 'shell', command: 'echo run-ok' });
        const result = await runTask(task, {
            store,
            cwd: workspace,
            logDir: path.join(workspace, 'logs'),
        });
        expect(result.status).toBe('completed');
        expect(result.exitCode).toBe(0);
    });

    it('throws a clear error for agent / remote-agent / monitor-mcp / dream / main', async () => {
        for (const type of ['agent', 'remote-agent', 'monitor-mcp', 'dream', 'main'] as const) {
            const task = store.create({ title: type, type });
            await expect(
                runTask(task, {
                    store,
                    cwd: workspace,
                    logDir: path.join(workspace, 'logs'),
                }),
            ).rejects.toThrow(/not yet implemented in P19a/);
        }
    });
});

describe('startTask', () => {
    let store: TaskStore;
    let workspace: string;
    beforeEach(() => {
        workspace = tmpDir('xq-runner-bg-');
        store = createTaskStore(path.join(workspace, 'tasks.sqlite'));
    });
    afterEach(() => store.close());

    it('returns a handle whose done promise resolves for shell', async () => {
        const task = store.create({ title: 't', type: 'shell', command: 'echo bg-ok' });
        const handle = startTask(task, {
            store,
            cwd: workspace,
            logDir: path.join(workspace, 'logs'),
        });
        expect(handle.pid).toBeGreaterThan(0);
        const result = await handle.done;
        expect(result.status).toBe('completed');
    });

    it('throws for non-shell types', () => {
        const task = store.create({ title: 'x', type: 'agent' });
        expect(() =>
            startTask(task, {
                store,
                cwd: workspace,
                logDir: path.join(workspace, 'logs'),
            }),
        ).toThrow(/not yet implemented in P19a/);
    });
});
