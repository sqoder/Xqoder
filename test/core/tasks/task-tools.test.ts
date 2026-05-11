// P19a — TaskCreate/List/Get/Output/Stop/Update tool tests.

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ToolContext } from '../../../src/core/agent/tools/tool.js';
import {
    TaskCreateTool,
    TaskGetTool,
    TaskListTool,
    TaskOutputTool,
    TaskStopTool,
    TaskUpdateTool,
} from '../../../src/core/agent/tools/task-tools.js';
import { getTaskService, type TaskService } from '../../../src/core/tasks/task-service.js';

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeContext(workspace: string): ToolContext {
    return {
        cwd: workspace,
        projectRoot: workspace,
    };
}

describe('task tools', () => {
    let service: TaskService;
    let workspace: string;

    beforeEach(() => {
        workspace = tmpDir('xq-task-tools-');
        const home = tmpDir('xq-home-');
        service = getTaskService({
            homeDir: home,
            dbPath: path.join(workspace, 'tasks.sqlite'),
            logDir: path.join(workspace, 'task-logs'),
        });
    });

    afterEach(() => {
        service.close();
    });

    it('TaskCreateTool creates a pending task by default', async () => {
        const tool = new TaskCreateTool({ service });
        const result = await tool.execute(
            { toolCallId: 'tc1', title: 'hello', type: 'shell', command: 'echo hi' },
            makeContext(workspace),
        );
        expect(result.success).toBe(true);
        const task = (result.metadata as { task: { id: string; status: string } }).task;
        expect(task.status).toBe('pending');
        expect(service.store.get(task.id)?.status).toBe('pending');
    });

    it('TaskCreateTool rejects type=shell without command', async () => {
        const tool = new TaskCreateTool({ service });
        const result = await tool.execute(
            { toolCallId: 'tc2', title: 'empty', type: 'shell' },
            makeContext(workspace),
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('command');
    });

    it('TaskCreateTool with background=true starts the task and returns pid', async () => {
        const tool = new TaskCreateTool({ service });
        const result = await tool.execute(
            {
                toolCallId: 'tc3',
                title: 'bg',
                type: 'shell',
                command: 'echo ok',
                background: true,
            },
            makeContext(workspace),
        );
        expect(result.success).toBe(true);
        const meta = result.metadata as { pid: number; task: { id: string } };
        expect(meta.pid).toBeGreaterThan(0);

        // Let the handle finish.
        const handle = service.getHandle(meta.task.id);
        if (handle) await handle.done;
        expect(service.store.get(meta.task.id)?.status).toBe('completed');
    });

    it('TaskListTool filters by status and returns JSON output', async () => {
        service.store.create({ title: 'a', type: 'shell', command: 'a' });
        const b = service.store.create({ title: 'b', type: 'shell', command: 'b' });
        service.store.update(b.id, { status: 'running' });

        const tool = new TaskListTool({ service });
        const result = await tool.execute({ toolCallId: 'l', status: 'running' }, makeContext(workspace));
        expect(result.success).toBe(true);
        const parsed = JSON.parse(result.output) as Array<{ id: string; status: string }>;
        expect(parsed.length).toBe(1);
        expect(parsed[0]!.status).toBe('running');
    });

    it('TaskGetTool returns task details', async () => {
        const created = service.store.create({ title: 'x', type: 'shell', command: 'x' });
        const tool = new TaskGetTool({ service });
        const result = await tool.execute({ toolCallId: 'g', id: created.id }, makeContext(workspace));
        expect(result.success).toBe(true);
        const parsed = JSON.parse(result.output) as { id: string; title: string };
        expect(parsed.id).toBe(created.id);
        expect(parsed.title).toBe('x');
    });

    it('TaskGetTool surfaces 404 for unknown id', async () => {
        const tool = new TaskGetTool({ service });
        const result = await tool.execute({ toolCallId: 'g2', id: 'task_nope' }, makeContext(workspace));
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('TaskOutputTool reads tail of the log file', async () => {
        const task = service.store.create({ title: 'out', type: 'shell', command: 'echo xyz' });
        const logPath = path.join(service.logDir, `${task.id}.log`);
        fs.mkdirSync(service.logDir, { recursive: true });
        fs.writeFileSync(logPath, 'xyz\n');
        service.store.update(task.id, { status: 'completed', exitCode: 0, logPath });

        const tool = new TaskOutputTool({ service });
        const result = await tool.execute({ toolCallId: 'o', id: task.id }, makeContext(workspace));
        expect(result.success).toBe(true);
        expect(result.output).toContain('xyz');
    });

    it('TaskOutputTool returns empty output when no log yet', async () => {
        const task = service.store.create({ title: 'empty-log', type: 'shell', command: 'x' });
        const tool = new TaskOutputTool({ service });
        const result = await tool.execute({ toolCallId: 'o2', id: task.id }, makeContext(workspace));
        expect(result.success).toBe(true);
        expect(result.output).toBe('');
    });

    it('TaskStopTool signals a running task via its in-process handle', async () => {
        const create = new TaskCreateTool({ service });
        const created = await create.execute(
            { toolCallId: 'tc', title: 'long', type: 'shell', command: 'sleep 10', background: true },
            makeContext(workspace),
        );
        const meta = created.metadata as { task: { id: string } };
        // Wait briefly so the shell actually spawns.
        await new Promise((r) => setTimeout(r, 30));

        const stop = new TaskStopTool({ service });
        const result = await stop.execute({ toolCallId: 's', id: meta.task.id }, makeContext(workspace));
        expect(result.success).toBe(true);
        expect((result.metadata as { signalled: boolean }).signalled).toBe(true);

        const handle = service.getHandle(meta.task.id);
        if (handle) await handle.done;
        expect(service.store.get(meta.task.id)?.status).toBe('stopped');
    });

    it('TaskStopTool is idempotent on already-terminal tasks', async () => {
        const task = service.store.create({ title: 'done', type: 'shell', command: 'x' });
        service.store.update(task.id, { status: 'completed', exitCode: 0 });
        const tool = new TaskStopTool({ service });
        const result = await tool.execute({ toolCallId: 's2', id: task.id }, makeContext(workspace));
        expect(result.success).toBe(true);
        expect((result.metadata as { signalled: boolean }).signalled).toBe(false);
    });

    it('TaskUpdateTool updates title and metadata', async () => {
        const task = service.store.create({
            title: 'old',
            type: 'shell',
            command: 'x',
            metadata: { k: 1 },
        });
        const tool = new TaskUpdateTool({ service });
        const result = await tool.execute(
            { toolCallId: 'u', id: task.id, title: 'new', mergeMetadata: { k2: 'v' } },
            makeContext(workspace),
        );
        expect(result.success).toBe(true);
        const reloaded = service.store.get(task.id)!;
        expect(reloaded.title).toBe('new');
        expect(reloaded.metadata).toEqual({ k: 1, k2: 'v' });
    });

    it('TaskUpdateTool rejects invalid status', async () => {
        const task = service.store.create({ title: 'x', type: 'shell', command: 'x' });
        const tool = new TaskUpdateTool({ service });
        const result = await tool.execute(
            { toolCallId: 'u2', id: task.id, status: 'bogus' },
            makeContext(workspace),
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('invalid status');
    });

    // Item 2: TaskCreateTool must expose buildApprovalRequest for shell tasks
    it('TaskCreateTool.buildApprovalRequest returns an approval request for shell type', async () => {
        const tool = new TaskCreateTool({ service });
        const req = await tool.buildApprovalRequest?.(
            { title: 'test', type: 'shell', command: 'rm -rf /' },
            makeContext(workspace),
        );
        expect(req).toBeDefined();
        expect(req?.toolName).toBe('task_create');
        expect(req?.preview).toContain('rm -rf /');
    });

    it('TaskCreateTool.buildApprovalRequest returns undefined for non-shell types', async () => {
        const tool = new TaskCreateTool({ service });
        const req = await tool.buildApprovalRequest?.(
            { title: 'test', type: 'agent' },
            makeContext(workspace),
        );
        expect(req).toBeUndefined();
    });

    // Item 4: task_stop signal whitelist
    it('TaskStopTool rejects unknown signals', async () => {
        const task = service.store.create({ title: 'x', type: 'shell', command: 'sleep 5' });
        service.store.update(task.id, { status: 'running', pid: 99999 });
        const tool = new TaskStopTool({ service });
        const result = await tool.execute(
            { toolCallId: 's3', id: task.id, signal: 'SIGUSR1' },
            makeContext(workspace),
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/invalid signal/i);
    });

    it('TaskStopTool accepts SIGTERM, SIGINT, SIGKILL', async () => {
        for (const signal of ['SIGTERM', 'SIGINT', 'SIGKILL']) {
            const task = service.store.create({ title: 'x', type: 'shell', command: 'sleep 5' });
            service.store.update(task.id, { status: 'running', pid: 1 });
            const tool = new TaskStopTool({ service });
            const result = await tool.execute(
                { toolCallId: `s-${signal}`, id: task.id, signal },
                makeContext(workspace),
            );
            // May fail to kill pid 1 (init) but should not fail on signal validation
            expect(result.error).not.toMatch(/invalid signal/i);
        }
    });
});
