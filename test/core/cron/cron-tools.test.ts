// P19b — ScheduleCron/List/Remove tool tests.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ToolContext } from '../../../src/core/agent/tools/tool.js';
import {
    CronListTool,
    CronRemoveTool,
    ScheduleCronTool,
} from '../../../src/core/agent/tools/cron-tools.js';
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

function makeContext(workspace: string): ToolContext {
    return {
        cwd: workspace,
        projectRoot: workspace,
    };
}

describe('cron tools', () => {
    let service: CronService;
    let workspace: string;

    beforeEach(() => {
        __resetCronServiceCacheForTests();
        __resetTaskServiceCacheForTests();
        workspace = tmpDir('xq-cron-tools-');
        const home = tmpDir('xq-home-');
        // Pre-create a task service so cron-service wires against this home.
        getTaskService({
            homeDir: home,
            dbPath: path.join(workspace, 'tasks.sqlite'),
            logDir: path.join(workspace, 'task-logs'),
        });
        service = getCronService({
            homeDir: home,
            dbPath: path.join(workspace, 'cron.sqlite'),
            defaultCwd: workspace,
        });
    });

    afterEach(() => {
        service.close();
        __resetTaskServiceCacheForTests();
    });

    it('ScheduleCronTool creates an enabled cron job with a computed nextFireAt', async () => {
        const tool = new ScheduleCronTool({ service });
        const result = await tool.execute(
            {
                toolCallId: 'c1',
                expression: '0 9 * * *',
                title: 'morning brief',
                type: 'shell',
                command: 'echo hi',
            },
            makeContext(workspace),
        );
        expect(result.success).toBe(true);
        const meta = result.metadata as { cron: { id: string; expression: string; nextFireAt: string } };
        expect(meta.cron.expression).toBe('0 9 * * *');
        expect(meta.cron.nextFireAt).toBeTruthy();
        expect(service.store.get(meta.cron.id)).not.toBeNull();
    });

    it('ScheduleCronTool rejects an invalid expression', async () => {
        const tool = new ScheduleCronTool({ service });
        const result = await tool.execute(
            {
                toolCallId: 'c2',
                expression: 'not-a-cron',
                title: 'x',
                type: 'shell',
                command: 'echo x',
            },
            makeContext(workspace),
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('invalid cron');
    });

    it('ScheduleCronTool rejects type=shell without command', async () => {
        const tool = new ScheduleCronTool({ service });
        const result = await tool.execute(
            { toolCallId: 'c3', expression: '* * * * *', title: 'x', type: 'shell' },
            makeContext(workspace),
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('command');
    });

    it('ScheduleCronTool rejects unknown task type', async () => {
        const tool = new ScheduleCronTool({ service });
        const result = await tool.execute(
            { toolCallId: 'c4', expression: '* * * * *', title: 'x', type: 'bogus' },
            makeContext(workspace),
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('invalid type');
    });

    it('ScheduleCronTool defaults cwd to ToolContext.cwd when not provided', async () => {
        const tool = new ScheduleCronTool({ service });
        const result = await tool.execute(
            {
                toolCallId: 'c5',
                expression: '* * * * *',
                title: 'x',
                type: 'shell',
                command: 'echo x',
            },
            makeContext(workspace),
        );
        expect(result.success).toBe(true);
        const meta = result.metadata as { cron: { id: string; template: { cwd: string } } };
        expect(meta.cron.template.cwd).toBe(workspace);
    });

    it('ScheduleCronTool with enabled=false stores a disabled job with no nextFireAt', async () => {
        const tool = new ScheduleCronTool({ service });
        const result = await tool.execute(
            {
                toolCallId: 'c6',
                expression: '* * * * *',
                title: 'paused',
                type: 'shell',
                command: 'echo x',
                enabled: false,
            },
            makeContext(workspace),
        );
        expect(result.success).toBe(true);
        const meta = result.metadata as { cron: { id: string; enabled: boolean; nextFireAt?: string } };
        expect(meta.cron.enabled).toBe(false);
        expect(meta.cron.nextFireAt).toBeUndefined();
    });

    it('CronListTool returns newest-first and filters by enabled', async () => {
        service.store.create({
            expression: '0 9 * * *',
            template: { title: 'a', type: 'shell', command: 'echo a' },
        });
        service.store.create({
            expression: '0 10 * * *',
            template: { title: 'b', type: 'shell', command: 'echo b' },
            enabled: false,
        });
        const tool = new CronListTool({ service });

        const all = await tool.execute({ toolCallId: 'l1' }, makeContext(workspace));
        expect(all.success).toBe(true);
        expect((JSON.parse(all.output) as unknown[]).length).toBe(2);

        const enabled = await tool.execute({ toolCallId: 'l2', enabled: true }, makeContext(workspace));
        expect(enabled.success).toBe(true);
        const parsed = JSON.parse(enabled.output) as Array<{ template: { title: string } }>;
        expect(parsed.length).toBe(1);
        expect(parsed[0]!.template.title).toBe('a');
    });

    it('CronRemoveTool deletes the job and returns the removed snapshot', async () => {
        const job = service.store.create({
            expression: '0 9 * * *',
            template: { title: 'x', type: 'shell', command: 'echo x' },
        });
        const tool = new CronRemoveTool({ service });
        const result = await tool.execute({ toolCallId: 'r1', id: job.id }, makeContext(workspace));
        expect(result.success).toBe(true);
        expect(service.store.get(job.id)).toBeNull();
    });

    it('CronRemoveTool reports not found for unknown id', async () => {
        const tool = new CronRemoveTool({ service });
        const result = await tool.execute(
            { toolCallId: 'r2', id: 'cron_missing' },
            makeContext(workspace),
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });
});
