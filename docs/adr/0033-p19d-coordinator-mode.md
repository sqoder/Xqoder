# ADR 0033 — P19d Coordinator mode + cron bootstrap wiring

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P19d (final sub-phase of P19 · Task V2 + Cron + Worktree + coordinator)
- **Preceding ADR:** ADR 0032 (P19c Worktree manager)
- **Supersedes:** —

## Context

P19c delivered the worktree manager. The 施工单
(`docs/openclaude-parity/phase-19-tasks-cron-worktree.md`) lists two
remaining items for P19d:

1. **Cron bootstrap wiring** — `cronService.scheduler.start()` gated behind
   `feature('CRON_TASKS')`, deferred from P19b (ADR 0030 §3 "The scheduler
   is NOT auto-started").
2. **Coordinator mode** — `coordinator-mode.ts`, `worker-agent.ts`,
   `TeamCreateTool / TeamDeleteTool / SendMessageTool`.

## Decision

### 1. Cron bootstrap wiring

`src/infrastructure/agent/tui-agent-service.ts` constructor now calls:

```ts
if (feature('CRON_TASKS')) {
    getCronService().scheduler.start();
}
```

Rationale:

- The TUI agent service constructor is the single process-wide startup point
  for the interactive REPL. Wiring here means the scheduler starts exactly
  once per process, before the first `sendMessage` call.
- `feature('CRON_TASKS')` defaults to `false` — no behaviour change for
  existing users. Enable with `xqoder features enable CRON_TASKS` or
  `XQODER_FEATURE_CRON_TASKS=1`.
- The scheduler's timer is `.unref()`-ed (ADR 0030 §4) so it does not
  prevent process exit in short-lived CLI invocations.

### 2. Core coordinator module: `src/core/coordinator/`

Single file `coordinator-mode.ts` + barrel `index.ts`:

- `isCoordinatorMode()` — reads `XQODER_FEATURE_COORDINATOR_MODE` /
  `COORDINATOR_MODE` env vars directly (no bootstrap dep, no feature-flag
  cache import) so the core layer stays free of infrastructure.
- Scratchpad directory: `~/.xqoder/swarm/<sessionId>/` — matches the
  施工单 §5 spec. `ensureScratchpadDir` / `getScratchpadDir` / `getSwarmDir`
  are pure path helpers.
- Mailbox: `writeToMailbox` / `readMailbox` / `clearMailbox` — JSON array
  files, one per recipient. Append-on-write, read-all, delete-on-clear.
  No locking needed for v1 (single-host, single-process coordinator).
- Team registry: module-level `Map<string, TeamEntry>` — ephemeral,
  process-scoped. Matches openclaude's in-memory team file approach but
  without the filesystem team-file layer (deferred to a follow-up if
  cross-process team discovery is needed).

TS alias `@xqoder/core-coordinator` added to `tsconfig.json`.

### 3. Coordinator tools: 4 tools

`src/core/agent/tools/coordinator-tools.ts` — registered in
`agent-default-tools.ts`:

- `team_create` — validates name, registers in team registry, ensures
  scratchpad dir, returns `{ team, scratchpadDir }`.
- `team_delete` — looks up team, clears mailbox, unregisters.
- `send_message` — writes a `CoordinatorMailboxMessage` to the recipient's
  inbox JSON file. `from` defaults to `"coordinator"`.
- `read_mailbox` — reads all messages for an agent; optional `clear=true`
  to drain the inbox after reading.

`read_mailbox` is a bonus tool not in the original 施工单 but necessary for
workers to poll their inbox without a separate file-read tool call.

### 4. Architecture guardrail

New test in `test/architecture-guardrails.test.ts`:

```ts
it('keeps the core-coordinator layer isolated from infrastructure and domain layers', () => {
    const violations = collectViolations('core/coordinator', ['infrastructure', 'domain']);
    expect(formatViolations(violations)).toBe('');
});
```

## Consequences

### Positive

- Cron scheduler now auto-starts in the REPL when `CRON_TASKS=1` — no
  manual wiring needed.
- Coordinator tools give the LLM a complete swarm communication surface:
  create teams, send messages, read inboxes, delete teams.
- Zero new third-party deps.
- 38 new tests (coordinator-mode 20, coordinator-tools 18) — all green.
- `release:check` 1620 pass / 0 fail.

### Negative / accepted

- Team registry is in-memory only — teams do not survive process restart.
  Persistent team state deferred to a follow-up (would require a new SQLite
  table or team-file layer).
- No worker-agent auto-spawn: `team_create` registers a team but does not
  launch a subagent. The coordinator LLM must call `delegate_task` separately
  to spawn workers. This matches the 施工单 intent (coordinator dispatches
  via tools, not auto-spawn).
- Mailbox has no locking — safe for single-host single-process v1.

## Alternatives considered

1. **Persist teams in SQLite** — rejected for P19d: adds a new DB file for
   ephemeral state; in-memory is sufficient for the coordinator pattern where
   teams live for one session.
2. **Auto-start cron in `cli-main.ts`** — rejected: `cli-main.ts` runs for
   every subcommand including `xqoder task list`; the scheduler should only
   start in the interactive REPL, not in one-shot CLI calls.
3. **Separate `worker-agent.ts` file** — rejected: openclaude's
   `workerAgent.ts` only re-exports `GENERAL_PURPOSE_AGENT` with a different
   `agentType`. XQoder already has `BUILT_IN_AGENTS['general-purpose']`; a
   separate file would be a one-liner wrapper with no new logic.

## Follow-ups

- P20: thinking effort + fast mode.
- Later: persistent team registry (SQLite), cross-process mailbox locking,
  worker auto-spawn on `team_create`.
- Later: `/reload-cron` slash command (ADR 0030 follow-up).

## Validation

- `bun test test/core/coordinator/` — 38 tests pass.
- `bun test test/architecture-guardrails.test.ts` — new `core/coordinator`
  guardrail passes.
- `bun run release:check` — 1620 pass / 0 fail, coverage PASS, all smoke
  tests pass.
