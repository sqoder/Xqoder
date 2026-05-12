// P19d — LocalAgentTask runner tests.

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runLocalAgentTask } from '../../../src/core/tasks/local-agent-task.js';
import { createTaskStore, type TaskStore } from '../../../src/core/tasks/task-store.js';

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('runLocalAgentTask', () => {
    let store: TaskStore;
    let workspace: string;
    let logDir: string;

    beforeEach(() => {
        workspace = tmpDir('xq-localagent-');
        store = createTaskStore(path.join(workspace, 'tasks.sqlite'));
        logDir = path.join(workspace, 'logs');
    });
    afterEach(() => store.close());

    it('rejects non-agent task types', async () => {
        const task = store.create({ title: 'x', type: 'shell', command: 'x' });
        await expect(
            runLocalAgentTask({ task, store, cwd: workspace, logDir }),
        ).rejects.toThrow(/requires type=agent/);
    });

    it('writes transcript to log and marks task completed with runner override', async () => {
        const task = store.create({
            title: 'explain',
            type: 'agent',
            metadata: { prompt: 'what is 2+2?' },
        });
        const result = await runLocalAgentTask({
            task,
            store,
            cwd: workspace,
            logDir,
            runnerOverride: async (session) => {
                (session as unknown as {
                    pushMessage: (m: { role: string; content: string }) => void;
                    addUsage: (u: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
                }).pushMessage({ role: 'assistant', content: '4' });
                (session as unknown as {
                    addUsage: (u: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
                }).addUsage({ promptTokens: 10, completionTokens: 1, totalTokens: 11 });
            },
        });

        expect(result.status).toBe('completed');
        expect(result.exitCode).toBe(0);
        expect(result.finalResponse).toBe('4');

        const reloaded = store.get(task.id)!;
        expect(reloaded.status).toBe('completed');
        expect(reloaded.logPath).toBe(result.logPath);

        const logBody = fs.readFileSync(result.logPath, 'utf-8');
        expect(logBody).toContain('response:');
        expect(logBody).toContain('4');
        expect(logBody).toContain('total=11');
    });

    it('records failure and error message when runner throws', async () => {
        const task = store.create({
            title: 'boom',
            type: 'agent',
            metadata: { prompt: 'trigger failure' },
        });
        const result = await runLocalAgentTask({
            task,
            store,
            cwd: workspace,
            logDir,
            runnerOverride: async () => {
                throw new Error('provider offline');
            },
        });

        expect(result.status).toBe('failed');
        expect(result.exitCode).toBe(1);
        const reloaded = store.get(task.id)!;
        expect(reloaded.status).toBe('failed');
        expect(reloaded.error).toContain('provider offline');
        const logBody = fs.readFileSync(result.logPath, 'utf-8');
        expect(logBody).toContain('error: provider offline');
    });

    it('requires llmConfig when no runner override is supplied', async () => {
        const task = store.create({
            title: 'needs-provider',
            type: 'agent',
            metadata: { prompt: 'hello' },
        });
        const result = await runLocalAgentTask({
            task,
            store,
            cwd: workspace,
            logDir,
        });
        expect(result.status).toBe('failed');
        const reloaded = store.get(task.id)!;
        expect(reloaded.error).toContain('llmConfig');
    });
});
