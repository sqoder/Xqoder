// P19a — barrel for tasks module.

export type {
    Task,
    TaskStatus,
    TaskType,
} from './task-types.js';
export {
    TASK_STATUSES,
    TASK_TYPES,
    TERMINAL_TASK_STATUSES,
    isTaskStatus,
    isTaskType,
    isTerminalStatus,
} from './task-types.js';

export type {
    CreateTaskInput,
    ListTasksFilter,
    TaskStore,
    UpdateTaskPatch,
} from './task-store.js';
export { createTaskStore } from './task-store.js';

export type {
    LocalShellTaskHandle,
    LocalShellTaskInput,
    LocalShellTaskResult,
} from './local-shell-task.js';
export { runLocalShellTask, startLocalShellTask } from './local-shell-task.js';

export type { TaskHandle, TaskRunResult, TaskRunnerDeps } from './task-runner.js';
export { runTask, startTask } from './task-runner.js';

export type { ResolveTaskServiceOptions, TaskService } from './task-service.js';
export {
    __resetTaskServiceCacheForTests,
    getTaskService,
    resolveTaskServicePaths,
} from './task-service.js';
