# ADR 0042 — P19 follow-up: LocalAgentTask + RemoteAgentTask runners

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P19 follow-up (ties off the 5 remaining arms of `runTask`'s switch)
- **Preceding ADRs:** ADR 0030 (P19a task-runner shell path), ADR 0033
  (P19d coordinator + cron bootstrap)
- **Supersedes:** —

## Context

P19a shipped `runTask` with 6 switch arms — only `shell` was implemented;
`agent`, `remote-agent`, `monitor-mcp`, `dream`, `main` all threw
`"Task type not yet implemented in P19a"`. Coordinator mode and cron in P19d
never re-entered the runner; they only wired the higher-level team / scheduler
surface. That left `task_create --type agent` permanently broken at the runner
boundary, blocking the coordinator pattern (`delegate_task` survived because
it bypasses the task store entirely).

Unblocking coordinator mode end-to-end needs:

- `agent` — a task-layer entry point for a subagent that does not depend on
  a live `ToolContext`. Different from `DelegateTaskTool` (which spawns a
  subagent inside an interactive session).
- `remote-agent` — the task-store-resident version of the P25 bridge/daemon
  handshake: caller provides `metadata.remote.endpoint` (+ optional JWT),
  runner POSTs the prompt, logs the response, updates the store.

`monitor-mcp`, `dream`, `main` stay deferred:

- `monitor-mcp` — depends on P25 daemon lifecycle; phase-19.md §"不确定项"
  explicitly parks it until daemon hosting lands.
- `main` — the interactive session itself; not a runner-dispatched task.
- `dream` — background planning agent; separate roadmap item not in scope.

## Decision

### 1. `src/core/tasks/local-agent-task.ts`

- Uses `forkSubagent` + an `InMemoryChildSession` that implements
  `ForkableChildSession` (same surface the `DelegateTaskTool` uses, but
  standalone — no `ToolContext`, no tool calls).
- Defaults to a single-round-trip `runChild` that calls `provider.complete`
  with the task prompt; the stored assistant message becomes the task's
  final response.
- All three moving parts are injectable:
  - `providerFactory` (defaults to `createLLMProvider` from `@xqoder/agent`),
  - `llmConfig` (required when no runner override is supplied),
  - `runnerOverride` (full `ForkChildRunner` for tests and, later, for the
    daemon to plug in its own multi-turn runner).
- Task metadata carries the prompt:
  - `metadata.prompt` (preferred) — the user-facing task body.
  - `metadata.agent` — one of the five built-in subagent names; falls back
    to `general-purpose` when missing/unknown.
- Log file at `<logDir>/<taskId>.log` captures agent name, prompt,
  assistant response, and usage totals. Store row transitions
  `pending → running → completed|failed` with `logPath` and (on failure)
  `error`.

### 2. `src/core/tasks/remote-agent-task.ts`

- Thin HTTP wrapper. Request shape:
  ```
  POST <metadata.remote.endpoint>
  Authorization: Bearer <metadata.remote.jwt>    // optional
  { taskId, prompt, agent?, metadata? }
  ```
- Response shape tolerates three cases:
  - `{ finalResponse, events? }` → logged and task marked completed,
  - `{ error }` → task marked failed with the returned error,
  - non-JSON → treated as a plain-text `finalResponse`.
- `fetcher` is injectable; default uses `global.fetch` (Bun built-in, no
  new deps). `AbortController` enforces a 10-minute timeout by default.
- Log file captures endpoint, every `events[]` entry, and the final
  response. No request body is logged because task metadata can contain
  arbitrary caller payloads and re-emitting it to disk changes the blast
  radius of the log directory.

### 3. Dispatcher surface changes — `src/core/tasks/task-runner.ts`

- `TaskRunResult` is now a tagged union: `{ kind: 'shell' | 'agent' |
  'remote-agent' } & <per-runner result>`. The `kind` discriminator lets
  callers branch on return type without re-parsing `task.type`.
- `TaskRunnerDeps` gained three optional fields:
  - `llmConfig` — forwarded to LocalAgentTask.
  - `localAgentRunnerOverride` — test hook.
  - `remoteFetcher` — test hook / future daemon hook.
- `startTask` (background mode) still throws for non-shell types; neither
  runner produces a long-running child process that needs a `TaskHandle`.
  Background agent/remote tasks will flow through the daemon instead of
  `startTask` once P25's daemon worker lands.

### 4. Deferred types emit a clearer error

The catch-all for `monitor-mcp | dream | main` now throws
`"Task type not yet implemented in P19d"` and the existing test expects
that phrase. The message change is intentional — P19d's ADR already
documents that monitor-mcp depends on P25 daemon hosting, and `main /
dream` were never in the runner's scope.

## Consequences

### Positive

- `runTask` now covers 3 of 6 arms; the 3 that remain are documented as
  deferred rather than accidentally unimplemented.
- Coordinator mode can spawn real agent tasks through the store, not just
  through `delegate_task`. Mailbox-based swarm workflows have somewhere to
  write results.
- Remote agent tasks match the P25 bridge contract 1:1, so a follow-up can
  swap the default fetcher for the actual daemon client with no runner
  change.
- Test hooks (runner + fetcher) keep these runners fully unit-testable
  without a live provider or network.

### Negative / accepted

- Default LocalAgentTask runner is single-turn, no tools. Multi-turn and
  tool-enabled flows still go through `DelegateTaskTool` inside an
  interactive session. Rationale: the tool pool belongs to the session's
  `ToolContext`; synthesising one for a store-resident task would
  duplicate session state.
- Request bodies are not echoed to the remote log. If a remote debugging
  session needs the outgoing payload, the daemon side has to log it.
- `TaskRunResult` became a discriminated union. Only `task-runner.test.ts`
  held direct consumers; no callers in application/interfaces layers broke
  (verified by repo-wide grep).

## Alternatives considered

1. **Reuse `DelegateTaskTool` directly for `type=agent`** — rejected: the
   tool requires a `ToolContext`, a tool registry, and an open session.
   Synthesising those for a store-resident task adds complexity without
   changing the happy path.
2. **Make `RemoteAgentTask` stream events over WebSocket instead of
   POST** — rejected for v1: the P25 bridge already exposes an HTTP
   endpoint pattern (`/api/bridge/*`); WS streaming is a follow-up once
   `SessionsWebSocket` grows a task-event channel.
3. **Drop `TaskHandle` for agent/remote tasks entirely** — kept the
   option open by leaving `startTask` throwing; when the daemon gains
   worker-process support, it can add its own handle type without
   churning `LocalShellTaskHandle`.

## Follow-ups

- Wire the default `remoteFetcher` to the P25 daemon client once
  `createBridgeApiServer` gains a `/tasks` endpoint.
- Add a streaming `runChild` variant that surfaces intermediate events
  to the task log when the LLM provider supports `provider.stream`.
- Build out the golden-task live-coding fixture so
  `eval:golden:live` can actually run (tracked separately — see
  `docs/release/baseline-vs-claude-code.md`).

## Validation

- `bun test test/core/tasks/local-agent-task.test.ts` — 4 tests pass.
- `bun test test/core/tasks/remote-agent-task.test.ts` — 5 tests pass.
- `bun test test/core/tasks/task-runner.test.ts` — 6 tests pass (4 new
  dispatch + 2 updated throw expectations).
- `bun run release:check` — full pipeline green.
