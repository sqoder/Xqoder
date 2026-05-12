# ADR 0029 — P19a Task V2 core (store + runner + shell + tools + CLI)

Status: Accepted
Date: 2026-05-11
Phase: P19a

## Context

Phase 19 of the OpenClaude parity roadmap bundles four large features —
Task V2, Cron, Worktree, and Coordinator. The施工单 references ~4 000 LOC
across `openclaude/src/{Task,tasks,utils/cron*,utils/worktree*,coordinator}`.
A single-session port violates the 150k token / <1 500 LOC single-phase
budget in CLAUDE.md, so P19 is split into four sub-phases (a/b/c/d).

P19a scopes the foundation that later sub-phases depend on:

- persistent Task store
- runner dispatcher (only LocalShellTask implemented; other types throw
  `not-yet-implemented-in-P19a` so P19b/P19d slot in cleanly)
- LocalShellTask (foreground + background modes)
- 6 model-facing tools (`task_create`, `task_list`, `task_get`,
  `task_output`, `task_stop`, `task_update`)
- `xqoder task ...` CLI group

P19b (cron), P19c (worktree), and P19d (coordinator + other task types)
will build on this layer without touching its shape.

## Decision

### Module layout

New module at `src/core/tasks/`:

- `task-types.ts` — `Task`, `TaskType`, `TaskStatus` + narrowing predicates.
- `task-store.ts` — SQLite-backed CRUD via the existing
  `createSqliteDatabase` shim (bun/node dual runtime). Separate DB file
  (`~/.xqoder/data/tasks.sqlite`) isolated from `sessions.sqlite`, so reset
  or migration does not touch conversation history.
- `local-shell-task.ts` — `runLocalShellTask` (awaits completion) and
  `startLocalShellTask` (returns `{ pid, logPath, done, stop }` for
  background use). Tees stdout/stderr into a per-task log at
  `~/.xqoder/data/task-logs/<id>.log`.
- `task-runner.ts` — `runTask` / `startTask` dispatcher with exhaustive
  switch. Non-shell types throw a clear error; the exhaustiveness check
  makes P19b/P19d additions type-driven.
- `task-service.ts` — process-wide `TaskService` (one cached store per
  DB path + in-flight handle map) so `task_stop` and CLI `stop` can act on
  live children in the current process. Cross-process stop falls back to
  signalling the persisted pid.
- `index.ts` — barrel for the new `@xqoder/core-tasks` alias.

### TypeScript path alias

Registered `@xqoder/core-tasks` as an **application** layer alias in
`tsconfig.json` + `test/architecture-guardrails.test.ts`, matching the
pattern established by P17 (`@xqoder/core-skills`,
`@xqoder/core-output-styles`). This keeps the application layer from
reaching into `src/core/tasks/*` via relative paths while still allowing
infra-like use inside `core/agent/tools`.

### Tools

New file `src/core/agent/tools/task-tools.ts` with six classes:

- `TaskCreateTool` — validates `type` + `command`, supports `background:true`
  to spawn via `startTask` and register the handle in the service.
- `TaskListTool` — optional `status` / `type` / `limit` filters; output is
  JSON-formatted so the model can parse.
- `TaskGetTool` — 404 surfaces as `success:false`.
- `TaskOutputTool` — tails the log file (default 16 KiB, capped at 1 MiB)
  and reports `truncated` when the cap hit.
- `TaskStopTool` — signals via in-process handle first, falls back to
  `process.kill(pid, signal)` for persisted background tasks, then flips
  status to `stopped`. Idempotent on already-terminal tasks.
- `TaskUpdateTool` — title + status + metadata (replace or shallow merge).
  Rejects unknown statuses.

All six register in `registerDefaultAgentTools` so chat sessions can run
background jobs and inspect them without bespoke wiring.

### CLI

`xqoder task create|list|get|output|stop|update` in
`src/commands/core/task.ts`, registered inside the existing
`cli-core-shell` plugin bundle (same place as `skillsCommand` and
`outputStyleCommand`). Both text and `--json` outputs are supported.

### Persistence decisions

- `task-store.ts` owns its own schema and migrations (kept out of
  `session/migrations.ts`) because the task catalog has an independent
  lifecycle from conversation state. A future migration only needs to
  touch the dedicated task DB.
- Terminal statuses (`completed | failed | stopped`) freeze
  `finished_at`; `running` sets `started_at`. `UpdateTaskPatch` preserves
  either timestamp once set, so retitling a completed task does not reset
  its history.
- `metadata` is stored as a JSON column with null-safe parsing — a
  corrupted row yields `{}` rather than throwing.

### Stubs for P19b/P19d

Every non-shell arm in `runTask`/`startTask` throws
`Task type not yet implemented in P19a: <type>`. Exhaustive `never`
fallback means P19b/P19d compilation fails immediately if a new type
skips updating the runner.

## Alternatives considered

- **Single combined phase.** Rejected —施工单 规模 + 硬预算铁律。
- **Reuse `sessions.sqlite`.** Rejected — schema coupling would make
  future session table migrations risky.
- **In-memory task map only.** Rejected —施工单 D o D 要求 cross-session
  恢复,这是 Task V2 vs "Task V1" 的核心区别。
- **Own cron lock / worktree driver in P19a.** Rejected — out of scope;
  isolated in P19b/P19c.

## Consequences

- `+33` unit tests (10 store + 7 shell + 4 runner + 12 tools) cover the
  pure modules.
- `+9` CLI tests cover `xqoder task` subcommands including JSON envelopes
  and error cases.
- `release:check` passes: 1448 tests, coverage 70.54%, CLI smoke, MCP
  live smoke (stdio/http/sse), security hygiene, size guardrail all
  green.
- No red-line file touched. Soft red-lines untouched (tools wired via
  `agent-default-tools.ts` which is a registration file, not the
  conversation/orchestrator/permission trio).

## Follow-ups

- **P19b**: cron scheduler + `ScheduleCronTool` + `xqoder cron *`
  (cron lock via SQLite advisory locks per施工单风险缓解).
- **P19c**: worktree manager + `EnterWorktreeTool` / `ExitWorktreeTool`.
- **P19d**: coordinator mode + worker agents + `TeamCreate/Delete/SendMessage`;
  also lights up the remaining task types
  (`agent`, `remote-agent`, `monitor-mcp`, `dream`).
- **P19b prerequisite**: cron trigger calls `runTask`, so Task V2 shape
  must stay stable through P19b.
