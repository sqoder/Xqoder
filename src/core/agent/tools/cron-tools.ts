// P19b — Cron tools (ScheduleCron / CronList / CronRemove).
//
// Mirrors the shape of task-tools.ts so the LLM has a consistent surface
// for scheduling long-running work: `schedule_cron` creates a cron entry
// that materialises a task on each fire, `cron_list` + `cron_remove`
// give introspection and cleanup.

import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';
import {
    getCronService,
    isValidCronExpression,
    type CronJob,
    type CronService,
    type CronTaskTemplate,
} from '@xqoder/core-cron';
import { isTaskType, type TaskType } from '@xqoder/core-tasks';

export interface CronToolsConfig {
    service?: CronService;
}

function resolveService(config: CronToolsConfig | undefined): CronService {
    return config?.service ?? getCronService();
}

function ok(toolCallId: string, output: string, metadata: Record<string, unknown>): ToolResult {
    return { toolCallId, success: true, output, metadata };
}

function fail(toolCallId: string, error: string): ToolResult {
    return { toolCallId, success: false, output: '', error };
}

function cronJobToWire(job: CronJob): Record<string, unknown> {
    return {
        id: job.id,
        expression: job.expression,
        enabled: job.enabled,
        template: job.template,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        ...(job.lastFiredAt ? { lastFiredAt: job.lastFiredAt.toISOString() } : {}),
        ...(job.nextFireAt ? { nextFireAt: job.nextFireAt.toISOString() } : {}),
    };
}

// ---------------------------------------------------------------------------
// ScheduleCronTool
// ---------------------------------------------------------------------------

export class ScheduleCronTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    constructor(private readonly config?: CronToolsConfig) {}

    readonly definition: ToolDefinition = {
        name: 'schedule_cron',
        description:
            'Schedule a cron job that creates a task on each fire. `expression` is a 5-field cron ("min hr dayOfMonth month dayOfWeek"). In P19b only type=shell is runnable; other types are stored but not dispatched.',
        parameters: [
            { name: 'expression', type: 'string', description: '5-field cron expression in local time', required: true },
            { name: 'title', type: 'string', description: 'Title for the task created on each fire', required: true },
            { name: 'type', type: 'string', description: 'Task type (shell|agent|remote-agent|monitor-mcp|dream|main). Default: shell', required: false },
            { name: 'command', type: 'string', description: 'Shell command to run (required when type=shell)', required: false },
            { name: 'cwd', type: 'string', description: 'Working directory for the task (defaults to caller cwd)', required: false },
            { name: 'metadata', type: 'object', description: 'Optional metadata copied onto each created task', required: false },
            { name: 'enabled', type: 'boolean', description: 'Start enabled (default true)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';

        const expression = typeof args['expression'] === 'string' ? args['expression'].trim() : '';
        if (!expression) return fail(toolCallId, 'expression is required');
        if (!isValidCronExpression(expression)) {
            return fail(toolCallId, `invalid cron expression: ${expression}`);
        }

        const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
        if (!title) return fail(toolCallId, 'title is required');

        const typeArg = typeof args['type'] === 'string' ? args['type'].trim() : 'shell';
        if (!isTaskType(typeArg)) return fail(toolCallId, `invalid type: ${typeArg}`);

        const command = typeof args['command'] === 'string' ? args['command'] : undefined;
        if (typeArg === 'shell' && (!command || command.trim().length === 0)) {
            return fail(toolCallId, 'command is required when type=shell');
        }

        const cwd = typeof args['cwd'] === 'string' && args['cwd'].trim().length > 0
            ? args['cwd']
            : context.cwd;

        const metadata =
            args['metadata'] && typeof args['metadata'] === 'object' && !Array.isArray(args['metadata'])
                ? (args['metadata'] as Record<string, unknown>)
                : undefined;

        const template: CronTaskTemplate = { title, type: typeArg as TaskType };
        if (command !== undefined) template.command = command;
        if (cwd) template.cwd = cwd;
        if (metadata) template.metadata = metadata;

        const enabled = args['enabled'] === undefined ? true : args['enabled'] === true;
        const service = resolveService(this.config);

        const job = service.store.create({ expression, template, enabled });
        return ok(
            toolCallId,
            `Scheduled cron ${job.id}${job.nextFireAt ? ` (next fire ${job.nextFireAt.toISOString()})` : ' (disabled)'}.`,
            { cron: cronJobToWire(job) },
        );
    }
}

// ---------------------------------------------------------------------------
// CronListTool
// ---------------------------------------------------------------------------

export class CronListTool implements ITool {
    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    constructor(private readonly config?: CronToolsConfig) {}

    readonly definition: ToolDefinition = {
        name: 'cron_list',
        description: 'List cron jobs newest-first, optionally filtered by enabled state.',
        parameters: [
            { name: 'enabled', type: 'boolean', description: 'Filter by enabled state', required: false },
            { name: 'limit', type: 'number', description: 'Max entries (default 50)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const service = resolveService(this.config);

        const filter: { enabled?: boolean; limit?: number } = {};
        if (typeof args['enabled'] === 'boolean') {
            filter.enabled = args['enabled'];
        }
        if (typeof args['limit'] === 'number' && Number.isFinite(args['limit'])) {
            filter.limit = Math.max(1, Math.min(Math.trunc(args['limit']), 1000));
        } else {
            filter.limit = 50;
        }

        const jobs = service.store.list(filter).map(cronJobToWire);
        return ok(toolCallId, JSON.stringify(jobs, null, 2), { count: jobs.length });
    }
}

// ---------------------------------------------------------------------------
// CronRemoveTool
// ---------------------------------------------------------------------------

export class CronRemoveTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    constructor(private readonly config?: CronToolsConfig) {}

    readonly definition: ToolDefinition = {
        name: 'cron_remove',
        description: 'Remove a cron job by id. Returns the removed job for confirmation.',
        parameters: [
            { name: 'id', type: 'string', description: 'Cron job id', required: true },
        ],
    };

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
        if (!id) return fail(toolCallId, 'id is required');

        const service = resolveService(this.config);
        const job = service.store.get(id);
        if (!job) return fail(toolCallId, `cron job not found: ${id}`);

        service.store.delete(id);
        return ok(toolCallId, `Removed cron ${id}.`, { cron: cronJobToWire(job) });
    }
}
