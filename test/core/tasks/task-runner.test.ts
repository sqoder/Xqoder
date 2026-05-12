// P19a / P19d — task-runner dispatch tests.

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
        expect(result.kind).toBe('shell');
        expect(result.status).toBe('completed');
        expect(result.exitCode).toBe(0);
    });

    it('dispatches agent type to LocalAgentTask with injected runner', async () => {
        const task = store.create({
            title: 'agent',
            type: 'agent',
            metadata: { prompt: 'hello?' },
        });
        const result = await runTask(task, {
            store,
            cwd: workspace,
            logDir: path.join(workspace, 'logs'),
            localAgentRunnerOverride: async (session) => {
                (session as unknown as {
                    pushMessage: (m: { role: string; content: string }) => void;
                }).pushMessage({ role: 'assistant', content: 'ok' });
            },
        });
        expect(result.kind).toBe('agent');
        expect(result.status).toBe('completed');
        expect(store.get(task.id)?.status).toBe('completed');
    });

    it('dispatches remote-agent type to RemoteAgentTask with injected fetcher', async () => {
        const task = store.create({
            title: 'remote',
            type: 'remote-agent',
            metadata: { prompt: 'ping', remote: { endpoint: 'http://stub/run' } },
        });
        const result = await runTask(task, {
            store,
            cwd: workspace,
            logDir: path.join(workspace, 'logs'),
            remoteFetcher: async () => ({ finalResponse: 'pong' }),
        });
        expect(result.kind).toBe('remote-agent');
        expect(result.status).toBe('completed');
        expect(store.get(task.id)?.status).toBe('completed');
    });

    it('throws for monitor-mcp / dream / main (deferred to later phases)', async () => {
        for (const type of ['monitor-mcp', 'dream', 'main'] as const) {
            const task = store.create({ title: type, type });
            await expect(
                runTask(task, {
                    store,
                    cwd: workspace,
                    logDir: path.join(workspace, 'logs'),
                }),
            ).rejects.toThrow(/not yet implemented/);
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

    it('throws for non-shell types (background mode limited to shell in P19d)', () => {
        for (const type of ['agent', 'remote-agent', 'monitor-mcp', 'dream', 'main'] as const) {
            const task = store.create({ title: type, type });
            expect(() =>
                startTask(task, {
                    store,
                    cwd: workspace,
                    logDir: path.join(workspace, 'logs'),
                }),
            ).toThrow(/background mode not implemented|not yet implemented/);
        }
    });
});
