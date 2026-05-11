# ADR 0030 — P19b Cron scheduler + cron tools + cron CLI

- **Status:** Accepted
- **Date:** 2026-05-11
- **Phase:** P19b (sub-phase of P19 · Task V2 + Cron + Worktree + coordinator)
- **Preceding ADR:** ADR 0029 (P19a Task V2 core)
- **Supersedes:** —

## Context

P19a delivered the Task V2 core (store + runner + shell + 6 tools + CLI). The
施工单 (`docs/openclaude-parity/phase-19-tasks-cron-worktree.md`) lists cron
triggers under the 3rd point:

> Cron scheduler — 用 node `setTimeout`(不是 cron lib)自己实现调度:启动时扫
> 所有 enabled cron,最近触发时间 → 排队;触发时 `runTask`。
> `cronTasksLock.ts` 对齐:文件锁防止多进程同时触发。

ADR 0029 pushed this into sub-phase P19b. P19c (worktree) and P19d
(coordinator + remaining task types) remain.

## Decision

### 1. Zero-dependency 5-field cron parser

`src/core/cron/cron-expression.ts` is a pure module that exports:

- `parseCronExpression(raw)` → validated `CronExpression` (pre-expanded sets
  per field + `dayOfMonthRestricted` / `dayOfWeekRestricted` flags)
- `nextFireAt(expr, from)` → next matching `Date`, strictly after `from`,
  bounded by a 4-year scan
- `isValidCronExpression(raw)` → boolean

Rationale:

- Zero third-party cron library — keeps the supply chain narrow (same
  posture as P18 manifest / P19a task store).
- Pre-expanded allowed-value sets make `matches(expr, d)` O(1) per field.
- Standard cron OR-semantics: when both DoM and DoW are restricted,
  we OR them. When exactly one is restricted, we AND (because the
  unrestricted field is a wildcard).
- Local-time semantics: matches user wall-clock, per 施工单 example
  `"0 9 * * *" == "每天 9 点"`. DST is accepted as best-effort
  (documented in the 4-year iteration fence error path).

### 2. SQLite-backed cron job store, separate DB file

`src/core/cron/cron-store.ts` uses `~/.xqoder/data/cron.sqlite` — decoupled
from `tasks.sqlite` and `sessions.sqlite`, same rationale as P19a's
separation: different lifecycles, resetting one should not touch the
others.

Schema:

```sql
CREATE TABLE cron_jobs (
    id TEXT PRIMARY KEY,
    expression TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    template_json TEXT NOT NULL,    -- { title, type, command?, cwd?, metadata? }
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_fired_at TEXT,
    next_fire_at TEXT
);
```

`nextFireAt` is eagerly computed on create / update / `recordFire` so the
scheduler can scan by SQL index rather than recomputing per-tick.

### 3. Advisory lock via unique-row insert (not flock)

`src/core/cron/cron-lock.ts` uses a shared `cron_locks(job_id, minute_slot)`
table keyed PRIMARY KEY. `tryAcquire` inserts; unique-constraint violation
== "another process already claimed this slot".

Rationale:

- 施工单 §风险 flagged flock under Docker bind-mounts as unreliable —
  SQLite's atomic unique-row insert is file-system-agnostic (sqlite
  uses its own POSIX advisory lock below).
- Slot key is `minute_slot` (minute-precision ISO of the scheduled fire
  time), not insertion wall-clock — two processes that both wake at
  `2026-05-11T09:00:07.123Z` and `2026-05-11T09:00:42.456Z` target the
  same slot `2026-05-11T09:00:00.000Z`.
- Purge uses `minute_slot < threshold`, not `acquired_at`, so purge is
  deterministic across processes with clock drift.
- `purgeOlderThan` counts-then-deletes because our shared
  `DatabaseLike.run()` returns `void` (used by both `bun:sqlite` and
  `better-sqlite3`). One extra `SELECT COUNT(*)` is cheap on a table of
  O(recent-minutes) rows.

### 4. Scheduler: pure tick() + thin setTimeout wrapper

`src/core/cron/cron-scheduler.ts`:

- `tick(now?)` — scans `store.list({ enabled: true })`, for each job with
  `nextFireAt <= now`: `lock.tryAcquire(jobId, fireAt)` → if won, call
  the injected `dispatch(job, fireAt)`. Always `store.recordFire(id,
  fireAt)` afterwards (advance regardless of lock outcome → two
  processes converge on the same next minute).
- `start()` / `stop()` — wraps `setTimeout` around earliest
  `nextFireAt`, clamped to `[0, min(maxIdleMs, 2^31-1)]`. Timer is
  `.unref()`-ed so short-lived CLIs exit cleanly.
- `maxIdleMs` default 1 hour — re-tick even with no pending jobs so
  newly-created crons show up without needing an explicit re-start.

Tests drive `tick()` directly with a fixed `Date`, so we don't depend on
real timers.

### 5. CronService singleton + dispatch glue

`src/core/cron/cron-service.ts` mirrors P19a's `task-service.ts` shape:
one cached `{ store, lock, scheduler }` per `dbPath`. The dispatch
callback materialises a `Task` via `taskService.store.create(...)` with
metadata `{ cronJobId, cronFiredAt, cronExpression, …template.metadata }`
then calls `startTask` for shell-type jobs and `registerHandle` so
`task_stop` works on the child. Non-shell types are persisted as pending
rows (audit trail) until later P19d runners plug in.

**The scheduler is NOT auto-started** — gated behind the `CRON_TASKS`
feature flag (default `false`). REPL/daemon bootstrap wiring is left to a
follow-up once the bootstrap itself is mature (P19d area).

### 6. Tools + CLI

Three tools, registered in `agent-default-tools.ts` alongside the six
task tools:

- `schedule_cron` — validate expression, build template, `store.create`
- `cron_list` — `store.list({ enabled?, limit })`, JSON output
- `cron_remove` — `store.delete(id)` with not-found guard

CLI: `xqoder cron create|list|get|remove|enable|disable`, mirrors the
task CLI conventions (`--json`, dep-injectable `writeOutput`, thin
`runSafely` exit-on-throw wrapper). Wired into the `cli-core-shell`
built-in plugin next to `taskCommand`.

## Consequences

### Positive

- Zero new third-party deps (no cron/cronParser/cron-parser/croner).
- Multi-process safety handled without flock (Docker-safe).
- Pure-logic `tick()` is fast to test and to reason about.
- TS alias `@xqoder/core-cron` keeps the architecture guardrail layering
  intact; new guardrail test ensures `core/cron/*` never imports
  `infrastructure/*` or `domain/*`.

### Negative / accepted

- Catch-up semantics: if the scheduler was offline for 30 min and comes
  back at `10:00`, we fire the overdue `09:00` slot **once** and
  advance to `10:00+1min`. No multi-fire backfill. Matches openclaude
  behaviour and avoids the "5-slot burst on laptop wake" footgun.
- Clock-drift tolerance is single-host — clocks on different hosts
  sharing an NFS-mounted `cron.sqlite` could produce double-dispatch
  across minute rollovers. v1 supports single-host only (documented in
  file header).
- 5-field only: no `@yearly`/`@daily`/`?` aliases or seconds field in v1.
  Add in P19d if LLMs keep generating them.

## Alternatives considered

1. **External `cron-parser` dep** — rejected: 300+ kB transitive weight,
   adds an npm dep P18 doesn't need and cron-parser's non-standard
   behaviours (7 in DoW ≡ Sunday) would diverge our semantics.
2. **flock / `proper-lockfile`** — rejected: 施工单 §风险 explicitly
   called out Docker unreliability; sqlite unique-row is a simpler win.
3. **Auto-start scheduler in bootstrap** — rejected for P19b: the
   bootstrap gate + feature-flag plumbing would mix P19b logic with
   REPL work; deferred to P19d where worker agents also land.

## Follow-ups

- P19c: `EnterWorktreeTool` / `ExitWorktreeTool` + worktree manager.
- P19d: wire `cronService.scheduler.start()` into REPL bootstrap when
  `feature('CRON_TASKS')` is true; add `/reload-cron` slash command.
- P19d: non-shell dispatch (agent / remote-agent / monitor-mcp).
- Later: cron expression aliases (`@daily`, `@hourly`), seconds field if
  real usage demands it.

## Validation

- `bun test test/core/cron/` — 39 new tests pass (cron-expression 18,
  cron-store 13, cron-lock 8, cron-scheduler 11, cron-tools 9).
- `bun test test/commands/core/cron.test.ts` — 12 CLI tests pass.
- `bun test test/architecture-guardrails.test.ts` — new `core/cron`
  guardrail passes.
- `bun run release:check` — 1520 pass / 0 fail, coverage 70.86% PASS,
  CLI smoke ✅, mcp live-smoke (stdio/http/sse) ✅, security hygiene ✅,
  size guardrail ✅.
