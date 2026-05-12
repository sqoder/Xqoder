// P19a / P19d — task-runner dispatcher.
//
// Fans out to the right per-type runner. P19a covered LocalShellTask; P19d
// adds LocalAgentTask and RemoteAgentTask. monitor-mcp / dream / main still
// throw — MonitorMcpTask lives with the P25 daemon, and main/dream never
// belong to the task-runner surface (main = the interactive session itself;
// dream is an offline planner reserved for a later phase).

import type { LLMProviderConfig } from '@xqoder/shared';
import type { Task } from './task-types.js';
import type { TaskStore } from './task-store.js';
import {
    runLocalShellTask,
    startLocalShellTask,
    type LocalShellTaskHandle,
    type LocalShellTaskResult,
} from './local-shell-task.js';
import {
    runLocalAgentTask,
    type LocalAgentTaskInput,
    type LocalAgentTaskResult,
} from './local-agent-task.js';
import {
    runRemoteAgentTask,
    type RemoteAgentTaskResult,
    type RemoteFetcher,
} from './remote-agent-task.js';

export interface TaskRunnerDeps {
    store: TaskStore;
    cwd: string;
    logDir: string;
    env?: NodeJS.ProcessEnv;
    shell?: string;
    /** LLM config used by LocalAgentTask when no runChild override is supplied. */
    llmConfig?: LLMProviderConfig;
    /** Test hook: inject the local-agent runChild to skip provider creation. */
    localAgentRunnerOverride?: LocalAgentTaskInput['runnerOverride'];
    /** Test hook: inject the remote-agent fetcher. */
    remoteFetcher?: RemoteFetcher;
}

export type TaskRunResult =
    | ({ kind: 'shell' } & LocalShellTaskResult)
    | ({ kind: 'agent' } & LocalAgentTaskResult)
    | ({ kind: 'remote-agent' } & RemoteAgentTaskResult);

export type TaskHandle = LocalShellTaskHandle;

export async function runTask(task: Task, deps: TaskRunnerDeps): Promise<TaskRunResult> {
    switch (task.type) {
        case 'shell': {
            const result = await runLocalShellTask({ task, ...deps });
            return { kind: 'shell', ...result };
        }
        case 'agent': {
            const input: LocalAgentTaskInput = {
                task,
                store: deps.store,
                cwd: deps.cwd,
                logDir: deps.logDir,
                ...(deps.llmConfig ? { llmConfig: deps.llmConfig } : {}),
                ...(deps.localAgentRunnerOverride
                    ? { runnerOverride: deps.localAgentRunnerOverride }
                    : {}),
            };
            const result = await runLocalAgentTask(input);
            return { kind: 'agent', ...result };
        }
        case 'remote-agent': {
            const result = await runRemoteAgentTask({
                task,
                store: deps.store,
                cwd: deps.cwd,
                logDir: deps.logDir,
                ...(deps.remoteFetcher ? { fetcher: deps.remoteFetcher } : {}),
            });
            return { kind: 'remote-agent', ...result };
        }
        case 'monitor-mcp':
        case 'dream':
        case 'main':
            throw new Error(`Task type not yet implemented in P19d: ${task.type}`);
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
            throw new Error(`startTask background mode not implemented for type ${task.type}`);
        default: {
            const exhaustive: never = task.type;
            throw new Error(`Unknown task type: ${String(exhaustive)}`);
        }
    }
}
