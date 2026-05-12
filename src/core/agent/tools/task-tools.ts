// P19a — Task tools (TaskCreate / TaskList / TaskGet / TaskOutput / TaskStop / TaskUpdate).
//
// These tools front the @xqoder/core-tasks service with a consistent JSON
// surface so the LLM can create, inspect, and stop long-running tasks.

import * as fs from 'node:fs';
import type { ToolDefinition, ToolResult } from '@xqoder/shared';
import type { ITool, ToolContext } from './tool.js';
import {
    getTaskService,
    type TaskService,
} from '@xqoder/core-tasks';
import {
    isTaskStatus,
    isTaskType,
    startTask,
    type Task,
    type TaskStatus,
    type TaskType,
} from '@xqoder/core-tasks';

export interface TaskToolsConfig {
    service?: TaskService;
}

function resolveService(config: TaskToolsConfig | undefined): TaskService {
    return config?.service ?? getTaskService();
}

function ok(toolCallId: string, output: string, metadata: Record<string, unknown>): ToolResult {
    return { toolCallId, success: true, output, metadata };
}

function fail(toolCallId: string, error: string): ToolResult {
    return { toolCallId, success: false, output: '', error };
}

function taskToWire(task: Task): Record<string, unknown> {
    return {
        id: task.id,
        title: task.title,
        type: task.type,
        status: task.status,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        ...(task.startedAt ? { startedAt: task.startedAt.toISOString() } : {}),
        ...(task.finishedAt ? { finishedAt: task.finishedAt.toISOString() } : {}),
        ...(task.sessionId ? { sessionId: task.sessionId } : {}),
        ...(typeof task.pid === 'number' ? { pid: task.pid } : {}),
        ...(task.logPath ? { logPath: task.logPath } : {}),
        ...(task.command ? { command: task.command } : {}),
        ...(typeof task.exitCode === 'number' ? { exitCode: task.exitCode } : {}),
        ...(task.error ? { error: task.error } : {}),
        ...(task.metadata && Object.keys(task.metadata).length > 0 ? { metadata: task.metadata } : {}),
    };
}

// ---------------------------------------------------------------------------
// TaskCreateTool
// ---------------------------------------------------------------------------

export class TaskCreateTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    constructor(private readonly config?: TaskToolsConfig) {}

    readonly definition: ToolDefinition = {
        name: 'task_create',
        description:
            'Create a new long-running task. Supports type=shell in P19a (other types reserved for later). Set background=true to start immediately and return without waiting for completion.',
        parameters: [
            { name: 'title', type: 'string', description: 'Human-readable title', required: true },
            { name: 'type', type: 'string', description: 'Task type (shell|agent|remote-agent|monitor-mcp|dream|main). Only shell is runnable in P19a.', required: false },
            { name: 'command', type: 'string', description: 'Shell command to execute (required when type=shell)', required: false },
            { name: 'background', type: 'boolean', description: 'If true, start the task in the background and return immediately', required: false },
            { name: 'metadata', type: 'object', description: 'Optional metadata to attach to the task', required: false },
        ],
    };

    buildApprovalRequest(args: Record<string, unknown>): import('./tool.js').ToolApprovalRequest | undefined {
        const typeArg = typeof args['type'] === 'string' ? args['type'].trim() : 'shell';
        if (typeArg !== 'shell') return undefined;
        const command = typeof args['command'] === 'string' ? args['command'] : '(no command)';
        return {
            toolCallId: '',
            toolName: 'task_create',
            summary: `Create shell task: ${command}`,
            reason: 'task_create with type=shell will spawn a shell command.',
            preview: command,
            risk: 'high',
        };
    }

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
        if (!title) return fail(toolCallId, 'title is required');

        const typeArg = typeof args['type'] === 'string' ? args['type'].trim() : 'shell';
        if (!isTaskType(typeArg)) return fail(toolCallId, `invalid type: ${typeArg}`);

        const command = typeof args['command'] === 'string' ? args['command'] : undefined;
        if (typeArg === 'shell' && (!command || command.trim().length === 0)) {
            return fail(toolCallId, 'command is required when type=shell');
        }

        const metadata =
            args['metadata'] && typeof args['metadata'] === 'object' && !Array.isArray(args['metadata'])
                ? (args['metadata'] as Record<string, unknown>)
                : undefined;

        const background = args['background'] === true;
        const service = resolveService(this.config);

        const task = service.store.create({
            title,
            type: typeArg,
            ...(command !== undefined ? { command } : {}),
            ...(context.sessionId ? { sessionId: context.sessionId } : {}),
            ...(metadata ? { metadata } : {}),
        });

        if (!background) {
            return ok(toolCallId, `Created task ${task.id} (pending).`, { task: taskToWire(task) });
        }

        if (typeArg !== 'shell') {
            return fail(toolCallId, `background mode only supports type=shell in P19a (got ${typeArg})`);
        }

        const handle = startTask(task, {
            store: service.store,
            cwd: context.cwd,
            logDir: service.logDir,
        });
        service.registerHandle(task.id, handle);

        const started = service.store.get(task.id) ?? task;
        return ok(toolCallId, `Started task ${task.id} in background (pid=${handle.pid}).`, {
            task: taskToWire(started),
            pid: handle.pid,
            logPath: handle.logPath,
        });
    }
}

// ---------------------------------------------------------------------------
// TaskListTool
// ---------------------------------------------------------------------------

export class TaskListTool implements ITool {
    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    constructor(private readonly config?: TaskToolsConfig) {}

    readonly definition: ToolDefinition = {
        name: 'task_list',
        description: 'List tasks newest-first with optional status / type filters.',
        parameters: [
            { name: 'status', type: 'string', description: 'Filter by status', required: false },
            { name: 'type', type: 'string', description: 'Filter by task type', required: false },
            { name: 'limit', type: 'number', description: 'Max entries (default 50)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const service = resolveService(this.config);

        const filter: { status?: TaskStatus; type?: TaskType; limit?: number } = {};
        if (typeof args['status'] === 'string' && args['status'].trim().length > 0) {
            if (!isTaskStatus(args['status'])) return fail(toolCallId, `invalid status: ${args['status']}`);
            filter.status = args['status'];
        }
        if (typeof args['type'] === 'string' && args['type'].trim().length > 0) {
            if (!isTaskType(args['type'])) return fail(toolCallId, `invalid type: ${args['type']}`);
            filter.type = args['type'];
        }
        if (typeof args['limit'] === 'number' && Number.isFinite(args['limit'])) {
            filter.limit = Math.max(1, Math.min(Math.trunc(args['limit']), 1000));
        } else {
            filter.limit = 50;
        }

        const tasks = service.store.list(filter).map(taskToWire);
        return ok(toolCallId, JSON.stringify(tasks, null, 2), { count: tasks.length });
    }
}

// ---------------------------------------------------------------------------
// TaskGetTool
// ---------------------------------------------------------------------------

export class TaskGetTool implements ITool {
    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    constructor(private readonly config?: TaskToolsConfig) {}

    readonly definition: ToolDefinition = {
        name: 'task_get',
        description: 'Fetch a single task by id.',
        parameters: [{ name: 'id', type: 'string', description: 'Task id', required: true }],
    };

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
        if (!id) return fail(toolCallId, 'id is required');

        const service = resolveService(this.config);
        const task = service.store.get(id);
        if (!task) return fail(toolCallId, `task not found: ${id}`);
        return ok(toolCallId, JSON.stringify(taskToWire(task), null, 2), { task: taskToWire(task) });
    }
}

// ---------------------------------------------------------------------------
// TaskOutputTool
// ---------------------------------------------------------------------------

export class TaskOutputTool implements ITool {
    isReadOnly(): boolean {
        return true;
    }

    isConcurrencySafe(): boolean {
        return true;
    }

    constructor(private readonly config?: TaskToolsConfig) {}

    readonly definition: ToolDefinition = {
        name: 'task_output',
        description: 'Read the stdout/stderr log of a task. Returns at most maxBytes from the tail (default 16384).',
        parameters: [
            { name: 'id', type: 'string', description: 'Task id', required: true },
            { name: 'maxBytes', type: 'number', description: 'Max bytes to return from the tail of the log', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
        if (!id) return fail(toolCallId, 'id is required');

        const service = resolveService(this.config);
        const task = service.store.get(id);
        if (!task) return fail(toolCallId, `task not found: ${id}`);
        if (!task.logPath) {
            return ok(toolCallId, '', { task: taskToWire(task), bytes: 0, truncated: false });
        }
        if (!fs.existsSync(task.logPath)) {
            return ok(toolCallId, '', { task: taskToWire(task), bytes: 0, truncated: false, missing: true });
        }

        const maxBytes =
            typeof args['maxBytes'] === 'number' && Number.isFinite(args['maxBytes'])
                ? Math.max(256, Math.min(Math.trunc(args['maxBytes']), 1_048_576))
                : 16_384;

        const stat = fs.statSync(task.logPath);
        const start = Math.max(0, stat.size - maxBytes);
        const truncated = start > 0;
        const handle = fs.openSync(task.logPath, 'r');
        try {
            const length = stat.size - start;
            const buffer = Buffer.allocUnsafe(length);
            fs.readSync(handle, buffer, 0, length, start);
            return ok(toolCallId, buffer.toString('utf8'), {
                task: taskToWire(task),
                bytes: length,
                truncated,
                logPath: task.logPath,
            });
        } finally {
            fs.closeSync(handle);
        }
    }
}

// ---------------------------------------------------------------------------
// TaskStopTool
// ---------------------------------------------------------------------------

export class TaskStopTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    constructor(private readonly config?: TaskToolsConfig) {}

    readonly definition: ToolDefinition = {
        name: 'task_stop',
        description: 'Stop a running task. Sends SIGTERM (default) or a requested signal to the task process.',
        parameters: [
            { name: 'id', type: 'string', description: 'Task id', required: true },
            { name: 'signal', type: 'string', description: 'Signal name (default SIGTERM)', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
        if (!id) return fail(toolCallId, 'id is required');

        const service = resolveService(this.config);
        const task = service.store.get(id);
        if (!task) return fail(toolCallId, `task not found: ${id}`);
        if (task.status !== 'running' && task.status !== 'pending') {
            return ok(toolCallId, `task ${id} already terminal (${task.status}).`, {
                task: taskToWire(task),
                signalled: false,
            });
        }

        const rawSignal = typeof args['signal'] === 'string' ? args['signal'] : 'SIGTERM';
        const ALLOWED_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGKILL']);
        if (!ALLOWED_SIGNALS.has(rawSignal)) {
            return fail(toolCallId, `invalid signal: ${rawSignal}. Allowed: SIGTERM, SIGINT, SIGKILL`);
        }
        const signal = rawSignal as NodeJS.Signals;

        let signalled = false;
        const handle = service.getHandle(id);
        if (handle) {
            handle.stop(signal);
            signalled = true;
        } else if (typeof task.pid === 'number' && task.pid > 0) {
            try {
                process.kill(task.pid, signal);
                signalled = true;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                // ESRCH means process already gone; treat as non-fatal.
                if (!/no such process|ESRCH/i.test(message)) {
                    return fail(toolCallId, `failed to signal pid ${task.pid}: ${message}`);
                }
            }
        }

        const updated = service.store.update(id, {
            status: 'stopped',
            error: `stopped via ${signal}`,
        });
        return ok(toolCallId, `Stopped task ${id}${signalled ? '' : ' (no live process found; marked stopped)'}.`, {
            task: taskToWire(updated),
            signalled,
            signal,
        });
    }
}

// ---------------------------------------------------------------------------
// TaskUpdateTool
// ---------------------------------------------------------------------------

export class TaskUpdateTool implements ITool {
    isConcurrencySafe(): boolean {
        return false;
    }

    constructor(private readonly config?: TaskToolsConfig) {}

    readonly definition: ToolDefinition = {
        name: 'task_update',
        description: 'Update a task title, status, or metadata. Terminal statuses (completed/failed/stopped) freeze the task; use this mainly to retitle or annotate.',
        parameters: [
            { name: 'id', type: 'string', description: 'Task id', required: true },
            { name: 'title', type: 'string', description: 'New title', required: false },
            { name: 'status', type: 'string', description: 'New status', required: false },
            { name: 'metadata', type: 'object', description: 'Replace metadata object', required: false },
            { name: 'mergeMetadata', type: 'object', description: 'Shallow-merge keys into metadata', required: false },
        ],
    };

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = (args['toolCallId'] as string) ?? '';
        const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
        if (!id) return fail(toolCallId, 'id is required');

        const service = resolveService(this.config);
        const current = service.store.get(id);
        if (!current) return fail(toolCallId, `task not found: ${id}`);

        const patch: { title?: string; status?: TaskStatus; metadata?: Record<string, unknown> } = {};

        if (typeof args['title'] === 'string' && args['title'].trim().length > 0) {
            patch.title = args['title'].trim();
        }

        if (typeof args['status'] === 'string') {
            if (!isTaskStatus(args['status'])) return fail(toolCallId, `invalid status: ${args['status']}`);
            patch.status = args['status'];
        }

        const replaceMeta =
            args['metadata'] && typeof args['metadata'] === 'object' && !Array.isArray(args['metadata'])
                ? (args['metadata'] as Record<string, unknown>)
                : undefined;
        const mergeMeta =
            args['mergeMetadata'] && typeof args['mergeMetadata'] === 'object' && !Array.isArray(args['mergeMetadata'])
                ? (args['mergeMetadata'] as Record<string, unknown>)
                : undefined;
        if (replaceMeta) {
            patch.metadata = replaceMeta;
        } else if (mergeMeta) {
            patch.metadata = { ...(current.metadata ?? {}), ...mergeMeta };
        }

        const updated = service.store.update(id, patch);
        return ok(toolCallId, `Updated task ${id}.`, { task: taskToWire(updated) });
    }
}
