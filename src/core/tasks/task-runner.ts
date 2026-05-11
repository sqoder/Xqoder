// P19a — task-runner dispatcher.
//
// Fans out to the right per-type runner. Only LocalShellTask is implemented
// in P19a; other types throw so that tool callers surface a clear error
// instead of silently no-op-ing. Later sub-phases (P19b cron triggers, P19d
// coordinator + agent/remote/monitor tasks) fill in the other arms.

import type { Task } from './task-types.js';
import type { TaskStore } from './task-store.js';
import {
    runLocalShellTask,
    startLocalShellTask,
    type LocalShellTaskHandle,
    type LocalShellTaskResult,
} from './local-shell-task.js';

export interface TaskRunnerDeps {
    store: TaskStore;
    cwd: string;
    logDir: string;
    env?: NodeJS.ProcessEnv;
    shell?: string;
}

export type TaskRunResult = LocalShellTaskResult;
export type TaskHandle = LocalShellTaskHandle;

export async function runTask(task: Task, deps: TaskRunnerDeps): Promise<TaskRunResult> {
    switch (task.type) {
        case 'shell':
            return runLocalShellTask({ task, ...deps });
        case 'agent':
        case 'remote-agent':
        case 'monitor-mcp':
        case 'dream':
        case 'main':
            throw new Error(`Task type not yet implemented in P19a: ${task.type}`);
        default: {
            const exhaustive: never = task.type;
            throw new Error(`Unknown task type: ${String(exhaustive)}`);
        }
    }
}

export function startTask(task: Task, deps: TaskRunnerDeps): TaskHandle {
    switch (task.type) {
        case 'shell':
            return startLocalShellTask({ task, ...deps });
        case 'agent':
        case 'remote-agent':
        case 'monitor-mcp':
        case 'dream':
        case 'main':
            throw new Error(`Task type not yet implemented in P19a: ${task.type}`);
        default: {
            const exhaustive: never = task.type;
            throw new Error(`Unknown task type: ${String(exhaustive)}`);
        }
    }
}
