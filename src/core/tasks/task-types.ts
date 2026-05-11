// P19a — Task model types shared by task-store, task-runner, and task tools.

export const TASK_TYPES = [
    'main',
    'agent',
    'shell',
    'monitor-mcp',
    'remote-agent',
    'dream',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = [
    'pending',
    'running',
    'completed',
    'failed',
    'stopped',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
    'completed',
    'failed',
    'stopped',
]);

export interface Task {
    id: string;
    title: string;
    type: TaskType;
    status: TaskStatus;
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
    sessionId?: string;
    pid?: number;
    logPath?: string;
    command?: string;
    exitCode?: number;
    error?: string;
    metadata?: Record<string, unknown>;
}

export function isTaskType(value: unknown): value is TaskType {
    return typeof value === 'string' && (TASK_TYPES as readonly string[]).includes(value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
    return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: TaskStatus): boolean {
    return TERMINAL_TASK_STATUSES.has(status);
}
