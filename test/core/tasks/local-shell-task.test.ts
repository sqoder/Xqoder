// P19a — LocalShellTask tests.

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTaskStore, type TaskStore } from '../../../src/core/tasks/task-store.js';
import { buildSanitizedEnv, runLocalShellTask, startLocalShellTask } from '../../../src/core/tasks/local-shell-task.js';

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runLocalShellTask (foreground)', () => {
    let store: TaskStore;
    let workspace: string;

    beforeEach(() => {
        workspace = tmpDir('xq-shell-fg-');
        store = createTaskStore(path.join(workspace, 'tasks.sqlite'));
    });
    afterEach(() => store.close());

    it('runs a shell command to completion and records exit code + output log', async () => {
        const task = store.create({ title: 'echo hi', type: 'shell', command: 'echo hi' });
        const logDir = path.join(workspace, 'logs');
        const result = await runLocalShellTask({
            task,
            store,
            cwd: workspace,
            logDir,
        });
        expect(result.exitCode).toBe(0);
        expect(result.status).toBe('completed');

        const reloaded = store.get(task.id)!;
        expect(reloaded.status).toBe('completed');
        expect(reloaded.exitCode).toBe(0);
        expect(reloaded.logPath).toBeDefined();
        expect(reloaded.startedAt).toBeDefined();
        expect(reloaded.finishedAt).toBeDefined();

        const logContent = fs.readFileSync(reloaded.logPath!, 'utf8');
        expect(logContent).toContain('hi');
    });

    it('marks task failed with non-zero exit code', async () => {
        const task = store.create({ title: 'fail', type: 'shell', command: 'exit 3' });
        const result = await runLocalShellTask({
            task,
            store,
            cwd: workspace,
            logDir: path.join(workspace, 'logs'),
        });
        expect(result.exitCode).toBe(3);
        expect(result.status).toBe('failed');

        const reloaded = store.get(task.id)!;
        expect(reloaded.status).toBe('failed');
        expect(reloaded.exitCode).toBe(3);
    });

    it('throws when task type is not shell', async () => {
        const task = store.create({ title: 'x', type: 'agent' });
        await expect(
            runLocalShellTask({
                task,
                store,
                cwd: workspace,
                logDir: path.join(workspace, 'logs'),
            }),
        ).rejects.toThrow(/type=shell/);
    });

    it('throws when command is missing', async () => {
        const task = store.create({ title: 'empty', type: 'shell' });
        await expect(
            runLocalShellTask({
                task,
                store,
                cwd: workspace,
                logDir: path.join(workspace, 'logs'),
            }),
        ).rejects.toThrow(/command/);
    });

    it('captures stderr into the same log', async () => {
        const task = store.create({
            title: 'err',
            type: 'shell',
            command: 'echo boom 1>&2; exit 0',
        });
        await runLocalShellTask({
            task,
            store,
            cwd: workspace,
            logDir: path.join(workspace, 'logs'),
        });
        const reloaded = store.get(task.id)!;
        const logContent = fs.readFileSync(reloaded.logPath!, 'utf8');
        expect(logContent).toContain('boom');
    });
});

describe('startLocalShellTask (background)', () => {
    let store: TaskStore;
    let workspace: string;

    beforeEach(() => {
        workspace = tmpDir('xq-shell-bg-');
        store = createTaskStore(path.join(workspace, 'tasks.sqlite'));
    });
    afterEach(() => store.close());

    it('returns a handle with pid and resolves done with exit status', async () => {
        const task = store.create({
            title: 'sleep-echo',
            type: 'shell',
            command: 'echo started; sleep 0.05; echo done',
        });
        const handle = startLocalShellTask({
            task,
            store,
            cwd: workspace,
            logDir: path.join(workspace, 'logs'),
        });
        expect(handle.pid).toBeGreaterThan(0);

        const mid = store.get(task.id)!;
        expect(mid.status).toBe('running');
        expect(mid.pid).toBe(handle.pid);

        const result = await handle.done;
        expect(result.exitCode).toBe(0);
        expect(result.status).toBe('completed');

        const final = store.get(task.id)!;
        expect(final.status).toBe('completed');
        expect(final.logPath).toBeDefined();
        const log = fs.readFileSync(final.logPath!, 'utf8');
        expect(log).toContain('started');
        expect(log).toContain('done');
    });

    it('stop() kills the process and marks task stopped', async () => {
        const task = store.create({
            title: 'long',
            type: 'shell',
            command: 'sleep 10',
        });
        const handle = startLocalShellTask({
            task,
            store,
            cwd: workspace,
            logDir: path.join(workspace, 'logs'),
        });
        // Give the shell a moment to actually spawn before we signal it.
        await new Promise((r) => setTimeout(r, 30));
        handle.stop();
        const result = await handle.done;
        expect(result.status).toBe('stopped');

        const final = store.get(task.id)!;
        expect(final.status).toBe('stopped');
    });
});

// Item 3: env sanitizer
describe('buildSanitizedEnv', () => {
    it('strips API keys and tokens', () => {
        const raw: NodeJS.ProcessEnv = {
            PATH: '/usr/bin',
            HOME: '/home/user',
            ANTHROPIC_API_KEY: 'sk-secret',
            GH_TOKEN: 'ghp_secret',
            OPENAI_API_KEY: 'sk-openai',
            DASHSCOPE_API_KEY: 'ds-secret',
            MY_PASSWORD: 'hunter2',
            MY_SECRET: 'topsecret',
            LANG: 'en_US.UTF-8',
            TERM: 'xterm',
            CUSTOM_VAR: 'keep-me',
        };
        const sanitized = buildSanitizedEnv(raw);
        expect(sanitized['PATH']).toBe('/usr/bin');
        expect(sanitized['HOME']).toBe('/home/user');
        expect(sanitized['LANG']).toBe('en_US.UTF-8');
        expect(sanitized['TERM']).toBe('xterm');
        expect(sanitized['ANTHROPIC_API_KEY']).toBeUndefined();
        expect(sanitized['GH_TOKEN']).toBeUndefined();
        expect(sanitized['OPENAI_API_KEY']).toBeUndefined();
        expect(sanitized['DASHSCOPE_API_KEY']).toBeUndefined();
        expect(sanitized['MY_PASSWORD']).toBeUndefined();
        expect(sanitized['MY_SECRET']).toBeUndefined();
        expect(sanitized['CUSTOM_VAR']).toBe('keep-me');
    });

    it('does not leak API keys when used in startLocalShellTask', async () => {
        const store2 = createTaskStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xq-env-')), 'tasks.sqlite'));
        const workspace2 = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-env-ws-'));
        const task = store2.create({ title: 'env-check', type: 'shell', command: 'printf "%s" "$ANTHROPIC_API_KEY$GH_TOKEN"' });
        const handle = startLocalShellTask({
            task,
            store: store2,
            cwd: workspace2,
            logDir: path.join(workspace2, 'logs'),
            env: buildSanitizedEnv({ ...process.env, ANTHROPIC_API_KEY: 'sk-leaked', GH_TOKEN: 'ghp-leaked' }),
        });
        const result = await handle.done;
        expect(result.status).toBe('completed');
        const log = fs.readFileSync(result.logPath, 'utf8');
        expect(log).not.toContain('sk-leaked');
        expect(log).not.toContain('ghp-leaked');
        store2.close();
    });
});
