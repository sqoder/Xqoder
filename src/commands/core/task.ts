// P19a — `xqoder task` CLI group.

import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import {
    getTaskService,
    isTaskStatus,
    isTaskType,
    startTask,
    type Task,
    type TaskService,
    type TaskStatus,
    type TaskType,
} from '@xqoder/core-tasks';
import * as fs from 'node:fs';

export interface TaskCommandDependencies {
    cwd?: string;
    writeOutput?: (output: string) => void;
    service?: TaskService;
}

interface JsonOption {
    json?: boolean;
}

interface CreateOptions extends JsonOption {
    type?: string;
    command?: string;
    background?: boolean;
}

interface ListOptions extends JsonOption {
    status?: string;
    type?: string;
    limit?: string;
}

interface OutputOptions extends JsonOption {
    maxBytes?: string;
}

interface StopOptions extends JsonOption {
    signal?: string;
}

interface UpdateOptions extends JsonOption {
    title?: string;
    status?: string;
}

export function createTaskCommand(deps: TaskCommandDependencies = {}): Command {
    const command = new Command('task').description('Manage long-running tasks (P19a: shell tasks)');

    command
        .command('create')
        .description('Create a task (shell type). Use --background to start and return immediately.')
        .argument('<title>', 'task title')
        .option('--type <type>', 'task type (shell by default)', 'shell')
        .option('--command <command>', 'shell command (required for type=shell)')
        .option('--background', 'start immediately and return without waiting')
        .option('--json', 'output as JSON')
        .action((title: string, options: CreateOptions) => runSafely(() => runCreate(title, options, deps)));

    command
        .command('list')
        .description('List tasks, newest first')
        .option('--status <status>', 'filter by status')
        .option('--type <type>', 'filter by type')
        .option('--limit <n>', 'max rows (default 50)')
        .option('--json', 'output as JSON')
        .action((options: ListOptions) => runSafely(() => runList(options, deps)));

    command
        .command('get')
        .description('Fetch a task by id')
        .argument('<id>', 'task id')
        .option('--json', 'output as JSON')
        .action((id: string, options: JsonOption) => runSafely(() => runGet(id, options, deps)));

    command
        .command('output')
        .description('Read the tail of a task log')
        .argument('<id>', 'task id')
        .option('--max-bytes <n>', 'max bytes from the tail (default 16384)')
        .option('--json', 'output as JSON envelope')
        .action((id: string, options: OutputOptions) => runSafely(() => runOutput(id, options, deps)));

    command
        .command('stop')
        .description('Stop a running task')
        .argument('<id>', 'task id')
        .option('--signal <signal>', 'signal name (default SIGTERM)', 'SIGTERM')
        .option('--json', 'output as JSON')
        .action((id: string, options: StopOptions) => runSafely(() => runStop(id, options, deps)));

    command
        .command('update')
        .description('Update task title or status')
        .argument('<id>', 'task id')
        .option('--title <title>', 'new title')
        .option('--status <status>', 'new status')
        .option('--json', 'output as JSON')
        .action((id: string, options: UpdateOptions) => runSafely(() => runUpdate(id, options, deps)));

    return command;
}

function resolveService(deps: TaskCommandDependencies): TaskService {
    return deps.service ?? getTaskService();
}

function writer(deps: TaskCommandDependencies): (line: string) => void {
    return deps.writeOutput ?? ((line: string) => console.log(line));
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
        ...(typeof task.pid === 'number' ? { pid: task.pid } : {}),
        ...(task.logPath ? { logPath: task.logPath } : {}),
        ...(task.command ? { command: task.command } : {}),
        ...(typeof task.exitCode === 'number' ? { exitCode: task.exitCode } : {}),
        ...(task.error ? { error: task.error } : {}),
    };
}

function formatTaskLine(task: Task): string {
    const ts = task.updatedAt.toISOString().replace('T', ' ').slice(0, 19);
    const status = task.status.padEnd(9);
    const type = task.type.padEnd(12);
    const title = task.title.length > 40 ? `${task.title.slice(0, 37)}...` : task.title;
    return `${task.id}  ${ts}  ${type}  ${status}  ${title}`;
}

export function runCreate(
    title: string,
    options: CreateOptions,
    deps: TaskCommandDependencies,
): Task {
    const service = resolveService(deps);
    const cwd = deps.cwd ?? process.cwd();
    const write = writer(deps);
    const typeArg = options.type ?? 'shell';
    if (!isTaskType(typeArg)) {
        throw new Error(`invalid --type: ${typeArg}`);
    }

    if (typeArg === 'shell' && (!options.command || options.command.trim().length === 0)) {
        throw new Error('--command is required when --type shell');
    }

    const task = service.store.create({
        title,
        type: typeArg as TaskType,
        ...(options.command !== undefined ? { command: options.command } : {}),
    });

    if (!options.background) {
        if (options.json) write(JSON.stringify(taskToWire(task), null, 2));
        else write(`Created ${task.id} (pending, ${task.type}).`);
        return task;
    }

    if (typeArg !== 'shell') {
        throw new Error('--background only supports --type shell in P19a');
    }

    const handle = startTask(task, {
        store: service.store,
        cwd,
        logDir: service.logDir,
    });
    service.registerHandle(task.id, handle);
    const running = service.store.get(task.id) ?? task;

    if (options.json) {
        write(JSON.stringify({ ...taskToWire(running), pid: handle.pid, logPath: handle.logPath }, null, 2));
    } else {
        write(`Started ${task.id} in background (pid=${handle.pid}). Log: ${handle.logPath}`);
    }
    return running;
}

export function runList(options: ListOptions, deps: TaskCommandDependencies): Task[] {
    const service = resolveService(deps);
    const write = writer(deps);
    const filter: { status?: TaskStatus; type?: TaskType; limit?: number } = {};
    if (options.status) {
        if (!isTaskStatus(options.status)) throw new Error(`invalid --status: ${options.status}`);
        filter.status = options.status;
    }
    if (options.type) {
        if (!isTaskType(options.type)) throw new Error(`invalid --type: ${options.type}`);
        filter.type = options.type;
    }
    if (options.limit) {
        const parsed = Number(options.limit);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid --limit: ${options.limit}`);
        filter.limit = Math.trunc(parsed);
    } else {
        filter.limit = 50;
    }

    const tasks = service.store.list(filter);
    if (options.json) {
        write(JSON.stringify(tasks.map(taskToWire), null, 2));
        return tasks;
    }
    if (tasks.length === 0) {
        write('No tasks found.');
        return tasks;
    }
    for (const task of tasks) write(formatTaskLine(task));
    return tasks;
}

export function runGet(id: string, options: JsonOption, deps: TaskCommandDependencies): Task {
    const service = resolveService(deps);
    const write = writer(deps);
    const task = service.store.get(id);
    if (!task) throw new Error(`task not found: ${id}`);
    if (options.json) {
        write(JSON.stringify(taskToWire(task), null, 2));
    } else {
        write(`id: ${task.id}`);
        write(`title: ${task.title}`);
        write(`type: ${task.type}`);
        write(`status: ${task.status}`);
        write(`createdAt: ${task.createdAt.toISOString()}`);
        write(`updatedAt: ${task.updatedAt.toISOString()}`);
        if (task.command) write(`command: ${task.command}`);
        if (task.logPath) write(`logPath: ${task.logPath}`);
        if (typeof task.exitCode === 'number') write(`exitCode: ${task.exitCode}`);
        if (task.error) write(`error: ${task.error}`);
    }
    return task;
}

export function runOutput(
    id: string,
    options: OutputOptions,
    deps: TaskCommandDependencies,
): { output: string; bytes: number; truncated: boolean; logPath?: string } {
    const service = resolveService(deps);
    const write = writer(deps);
    const task = service.store.get(id);
    if (!task) throw new Error(`task not found: ${id}`);
    const maxBytes = options.maxBytes ? Math.max(256, Math.min(Math.trunc(Number(options.maxBytes)), 1_048_576)) : 16_384;
    if (!task.logPath || !fs.existsSync(task.logPath)) {
        if (options.json) write(JSON.stringify({ bytes: 0, truncated: false, output: '' }, null, 2));
        return { output: '', bytes: 0, truncated: false };
    }
    const stat = fs.statSync(task.logPath);
    const start = Math.max(0, stat.size - maxBytes);
    const truncated = start > 0;
    const handle = fs.openSync(task.logPath, 'r');
    try {
        const length = stat.size - start;
        const buffer = Buffer.allocUnsafe(length);
        fs.readSync(handle, buffer, 0, length, start);
        const output = buffer.toString('utf8');
        if (options.json) {
            write(JSON.stringify({ bytes: length, truncated, logPath: task.logPath, output }, null, 2));
        } else {
            write(output);
        }
        return { output, bytes: length, truncated, logPath: task.logPath };
    } finally {
        fs.closeSync(handle);
    }
}

export function runStop(id: string, options: StopOptions, deps: TaskCommandDependencies): Task {
    const service = resolveService(deps);
    const write = writer(deps);
    const task = service.store.get(id);
    if (!task) throw new Error(`task not found: ${id}`);
    if (task.status !== 'running' && task.status !== 'pending') {
        if (options.json) write(JSON.stringify({ signalled: false, task: taskToWire(task) }, null, 2));
        else write(`Task ${id} already terminal (${task.status}).`);
        return task;
    }

    const signal = (options.signal ?? 'SIGTERM') as NodeJS.Signals;
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
            const msg = err instanceof Error ? err.message : String(err);
            if (!/no such process|ESRCH/i.test(msg)) {
                throw new Error(`failed to signal pid ${task.pid}: ${msg}`);
            }
        }
    }

    const updated = service.store.update(id, { status: 'stopped', error: `stopped via ${signal}` });
    if (options.json) {
        write(JSON.stringify({ signalled, signal, task: taskToWire(updated) }, null, 2));
    } else {
        write(`Stopped ${id}${signalled ? '' : ' (no live process)'}.`);
    }
    return updated;
}

export function runUpdate(id: string, options: UpdateOptions, deps: TaskCommandDependencies): Task {
    const service = resolveService(deps);
    const write = writer(deps);
    const existing = service.store.get(id);
    if (!existing) throw new Error(`task not found: ${id}`);
    const patch: { title?: string; status?: TaskStatus } = {};
    if (options.title && options.title.trim().length > 0) patch.title = options.title.trim();
    if (options.status) {
        if (!isTaskStatus(options.status)) throw new Error(`invalid --status: ${options.status}`);
        patch.status = options.status;
    }
    const updated = service.store.update(id, patch);
    if (options.json) write(JSON.stringify(taskToWire(updated), null, 2));
    else write(`Updated ${id}.`);
    return updated;
}

function runSafely(action: () => void): void {
    try {
        action();
    } catch (err) {
        logger.error(`Task command failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

export const taskCommand = createTaskCommand();
