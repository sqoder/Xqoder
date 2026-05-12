// P19d — RemoteAgentTask runner tests.

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runRemoteAgentTask } from '../../../src/core/tasks/remote-agent-task.js';
import { createTaskStore, type TaskStore } from '../../../src/core/tasks/task-store.js';

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runRemoteAgentTask', () => {
    let store: TaskStore;
    let workspace: string;
    let logDir: string;

    beforeEach(() => {
        workspace = tmpDir('xq-remote-');
        store = createTaskStore(path.join(workspace, 'tasks.sqlite'));
        logDir = path.join(workspace, 'logs');
    });
    afterEach(() => store.close());

    it('rejects non-remote-agent task types', async () => {
        const task = store.create({ title: 'x', type: 'shell', command: 'x' });
        await expect(
            runRemoteAgentTask({ task, store, cwd: workspace, logDir }),
        ).rejects.toThrow(/requires type=remote-agent/);
    });

    it('fails fast when metadata.remote.endpoint is missing', async () => {
        const task = store.create({
            title: 'no-endpoint',
            type: 'remote-agent',
            metadata: { prompt: 'ping' },
        });
        const result = await runRemoteAgentTask({
            task,
            store,
            cwd: workspace,
            logDir,
        });
        expect(result.status).toBe('failed');
        expect(store.get(task.id)?.error).toContain('endpoint');
    });

    it('passes prompt + agent + jwt to the injected fetcher and logs the response', async () => {
        const task = store.create({
            title: 'remote-run',
            type: 'remote-agent',
            metadata: {
                prompt: 'diagnose',
                agent: 'explore',
                remote: { endpoint: 'http://daemon.local/run', jwt: 'jwt-token' },
            },
        });

        let seen: Record<string, unknown> | null = null;
        const result = await runRemoteAgentTask({
            task,
            store,
            cwd: workspace,
            logDir,
            fetcher: async (req) => {
                seen = { endpoint: req.endpoint, jwt: req.jwt, body: req.body };
                return { finalResponse: 'got it', events: ['started', 'done'] };
            },
        });

        expect(result.status).toBe('completed');
        expect(result.finalResponse).toBe('got it');
        expect(seen).not.toBeNull();
        const captured = seen as unknown as {
            endpoint: string;
            jwt: string;
            body: { prompt: string; agent: string; taskId: string };
        };
        expect(captured.endpoint).toBe('http://daemon.local/run');
        expect(captured.jwt).toBe('jwt-token');
        expect(captured.body.prompt).toBe('diagnose');
        expect(captured.body.agent).toBe('explore');
        expect(captured.body.taskId).toBe(task.id);

        const logBody = fs.readFileSync(result.logPath, 'utf-8');
        expect(logBody).toContain('endpoint: http://daemon.local/run');
        expect(logBody).toContain('event: started');
        expect(logBody).toContain('event: done');
        expect(logBody).toContain('response:');
        expect(logBody).toContain('got it');
    });

    it('records failure when fetcher returns an error payload', async () => {
        const task = store.create({
            title: 'remote-err',
            type: 'remote-agent',
            metadata: { prompt: 'x', remote: { endpoint: 'http://daemon/run' } },
        });
        const result = await runRemoteAgentTask({
            task,
            store,
            cwd: workspace,
            logDir,
            fetcher: async () => ({ error: 'upstream 502' }),
        });
        expect(result.status).toBe('failed');
        expect(store.get(task.id)?.error).toContain('upstream 502');
    });

    it('surfaces fetcher throws as failed status + error on task', async () => {
        const task = store.create({
            title: 'remote-throw',
            type: 'remote-agent',
            metadata: { prompt: 'x', remote: { endpoint: 'http://daemon/run' } },
        });
        const result = await runRemoteAgentTask({
            task,
            store,
            cwd: workspace,
            logDir,
            fetcher: async () => {
                throw new Error('connection refused');
            },
        });
        expect(result.status).toBe('failed');
        expect(store.get(task.id)?.error).toContain('connection refused');
    });
});
