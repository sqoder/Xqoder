# Phase 19 · Task V2 + Cron + Worktree + coordinator

## 任务目标（必须可验证）

实现 OpenClaude 的长期任务体系：

- **Task V2**：持久化、跨 session 可恢复、可后台执行。
- **Cron**：时间触发任务。
- **Worktree**：把对话挂到 git worktree 上运行。
- **Coordinator**：主 agent 调度，worker 执行（swarm 形态）。

## 对标源

- `openclaude/src/Task.ts`
- `openclaude/src/tasks.ts`
- `openclaude/src/tasks/LocalMainSessionTask.ts`
- `openclaude/src/tasks/DreamTask/**`
- `openclaude/src/tasks/InProcessTeammateTask/**`
- `openclaude/src/tasks/LocalAgentTask/**`
- `openclaude/src/tasks/LocalShellTask/**`
- `openclaude/src/tasks/MonitorMcpTask/**`
- `openclaude/src/tasks/RemoteAgentTask/**`
- `openclaude/src/tasks/stopTask.ts`
- `openclaude/src/tasks/types.ts`
- `openclaude/src/tools/TaskCreateTool / TaskUpdateTool / TaskGetTool /
  TaskListTool / TaskOutputTool / TaskStopTool`
- `openclaude/src/utils/cron.ts / cronScheduler.ts / cronTasks.ts /
  cronJitterConfig.ts / cronTasksLock.ts`
- `openclaude/src/tools/ScheduleCronTool/**`
- `openclaude/src/tools/EnterWorktreeTool / ExitWorktreeTool`
- `openclaude/src/utils/worktree.ts / getWorktreePaths.ts`
- `openclaude/src/coordinator/coordinatorMode.ts`
- `openclaude/src/coordinator/workerAgent.ts`
- `openclaude/src/tools/TeamCreateTool / TeamDeleteTool / SendMessageTool`

### 成功判定

- `xqoder task list` 列出所有 task。
- `xqoder task create "跑一整晚的 refactor" --background` 启动后台 task。
- `xqoder task output <id>` 读后台 task 的输出流。
- `xqoder cron create "每天 9 点拉 PR 报告" --at "0 9 * * *"` 启动。
- `xqoder cron list / remove <id>`。
- `/enter_worktree feature/x` 切到 worktree 会话。
- Coordinator：主 agent 通过 `send_message` 给 worker 派子任务，
  worker 独立工作目录并汇报。

## 范围与边界

### 允许修改

- 新增 `src/core/tasks/`：
  - `task-store.ts`（SQLite 持久化）
  - `task-runner.ts`
  - `task-types.ts`
  - `local-main-session-task.ts`
  - `local-agent-task.ts`
  - `local-shell-task.ts`
  - `monitor-mcp-task.ts`
  - `remote-agent-task.ts`
- 新增 `src/core/cron/`：
  - `cron-scheduler.ts`
  - `cron-store.ts`
  - `cron-lock.ts`
- 新增 `src/core/worktree/`：
  - `worktree-manager.ts`
- 新增 `src/core/coordinator/`：
  - `coordinator-mode.ts`
  - `worker-agent.ts`
- 新增大量 tool：`TaskCreateTool / TaskUpdateTool / TaskGetTool /
  TaskListTool / TaskOutputTool / TaskStopTool / ScheduleCronTool /
  EnterWorktreeTool / ExitWorktreeTool / TeamCreateTool / TeamDeleteTool /
  SendMessageTool`。

### 禁止修改

- `AgentSession` 接口。

## 改动要点

### 1) Task 模型

```ts
interface Task {
    id: string;
    title: string;
    type: 'main' | 'agent' | 'shell' | 'monitor-mcp' | 'remote-agent' | 'dream';
    status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
    createdAt: Date;
    sessionId?: string;
    pid?: number;
    logPath?: string;
    metadata?: Record<string, unknown>;
}
```

### 2) Task runner 入口

```ts
export async function runTask(task: Task, deps): Promise<TaskResult> {
    switch (task.type) {
        case 'agent': return new LocalAgentTask(task, deps).run();
        case 'shell': return new LocalShellTask(task, deps).run();
        case 'monitor-mcp': return new MonitorMcpTask(task, deps).run();
        case 'remote-agent': return new RemoteAgentTask(task, deps).run();
        // ...
    }
}
```

### 3) Cron scheduler

- 用 node `setTimeout`（不是 cron lib）自己实现调度：
  启动时扫所有 enabled cron，最近触发时间 → 排队；触发时 `runTask`。
- `cronTasksLock.ts` 对齐：文件锁防止多进程同时触发。

### 4) Worktree

```ts
export async function enterWorktree(session, branch): Promise<WorktreeSession> {
    const worktreePath = await git.worktreeAdd(branch);
    const child = await session.store.create({
        parent: session.id,
        sourceType: 'worktree',
        cwd: worktreePath,
    });
    return child;
}
```

### 5) Coordinator mode

- feature flag `COORDINATOR_MODE` 打开时，主 session 降级为 "dispatcher"：
  只调工具，不写代码。
- worker agent 为 built-in subagent `general-purpose`，每个 worker 一个
  独立 session。
- 通信用 `send_message` 工具，写共享 scratchpad 目录 `~/.xqoder/swarm/<session>/`
  的 JSON 邮箱文件；worker 轮询。

## 验证

- Unit：task runner 5 种类型的 fixture。
- e2e：`xqoder task create "echo hi" --type shell` → complete with output
  `hi`。

## 风险与回退

- **风险**：cron 时钟漂移 + 文件锁在 Docker 容器里的行为。
  **缓解**：`cronTasksLock` 用 sqlite `PRAGMA advisory_lock` 替代 flock。
- **回退**：`XQODER_FEATURE_CRON_TASKS=0`。

## 不确定项

- `MonitorMcpTask` 是 "常驻 MCP 连接看板" 能力。本期 v1 只跑一次性任务，
  不做持久 monitor。后续可接 phase-25 的 daemon 做 monitor 宿主。
