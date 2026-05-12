# ADR 0034 — P24 Session lifecycle (arc / rewind / schema migration)

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P24 (S6 · Session lifecycle)
- **Preceding ADR:** ADR 0033 (P19d Coordinator mode)
- **Supersedes:** —

## Context

The 施工单 `phase-24-session-lifecycle.md` specifies:

1. **Schema migration** — add `permission_mode`, `activated_skills`,
   `parent_session_id` columns to `sessions`.
2. **ConversationArc** — keyword-heuristic topic segmentation.
3. **Rewind** — branch a session at a message index (never destroys original).
4. **CLI** — `xqoder session arc` + `xqoder session rewind`.

Teleport (cloud URL export) and file snapshots are deferred per the 施工单
§4 "v1 only supports `xqoder session export --zip`" note.

## Decision

### 1. Schema migration v4 (`p24_session_lifecycle`)

Three new nullable columns added via `MIGRATIONS` array in
`src/core/agent/session/migrations.ts`:

```sql
ALTER TABLE sessions ADD COLUMN permission_mode TEXT;
ALTER TABLE sessions ADD COLUMN activated_skills TEXT DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
```

`ensureSessionSchema` also calls `ensureColumn` for each new field so
existing DBs that skipped the migration runner are patched on first open.

`PersistedSessionSummary` and `SessionSummary` (application port) both gain
the three new optional/defaulted fields. `SaveSessionInput` gains
`permissionMode?`, `activatedSkills?`, `parentSessionId?`.

### 2. ConversationArc (`src/core/agent/session/arc.ts`)

Pure module, zero deps. Accepts `ArcMessage[]` (structural: `{ role, content? }`)
so it works with both `LLMMessage` and `SessionMessageView` without a
cross-layer import.

Algorithm:
- Scan user messages for topic-shift patterns (regex set).
- Only split if ≥ `MIN_SEGMENT_MESSAGES` (3) have elapsed since the last
  boundary — prevents micro-segments on short exchanges.
- Cap at `MAX_SEGMENTS` (10) to bound output size.
- Segment title = first user message content, truncated at 60 chars.

Exports: `computeArc`, `formatArc`, `ArcMessage`, `ArcSegment`,
`ConversationArc`.

### 3. Session rewind (`src/core/agent/session/rewind.ts`)

`rewindSession(store, input)`:
- Loads the original session; throws `Session not found` if missing.
- Validates `messageIndex` in `[0, messages.length - 1]`; throws
  `out of range` otherwise.
- Creates a new `AgentSession` with messages `[0..messageIndex]` and a
  fresh ID.
- Saves via `store.saveSession({ ..., parentSessionId: original.id })`.
- Returns `{ branchSession, keptMessages, discardedMessages }`.

The original session is never modified — rewind is always a branch.

### 4. CLI: `xqoder session arc` + `xqoder session rewind`

Added to `src/commands/sessions/sessions.ts`:

- `session arc [sessionId] [--json]` — calls `computeArc` on the session's
  messages, prints formatted arc or JSON.
- `session rewind <sessionId> <messageIndex> [--model] [--title] [--json]` —
  calls `rewindSession`, prints branch session ID and stats.

`SessionsCommandDependencies` gains `fullStore?: AgentSessionStore` for
rewind (needs write access, not just the read-only `SessionListPort`).

## Consequences

### Positive

- Session schema is forward-compatible: new columns are nullable/defaulted,
  old code reading the DB ignores them.
- Arc is fast (regex, no LLM call) and useful for `xqoder session arc` UX.
- Rewind is safe: original session preserved, branch carries `parentSessionId`
  for lineage tracking.
- 15 new tests (arc 10, rewind 5) — all green.
- `release:check` 1635 pass / 0 fail.

### Negative / accepted

- Arc quality is heuristic — topic detection accuracy is low for terse
  conversations. Acceptable for v1 display use.
- Teleport (cloud URL export) deferred — `xqoder session export/import` (P21c)
  covers the offline transfer case.
- File snapshots deferred — adds complexity; the rewind branch already
  preserves the message history.

## Alternatives considered

1. **Store arc in DB** — rejected: arc is derived from messages; recomputing
   on demand is cheap and avoids stale data.
2. **Rewind overwrites original** — rejected: destructive; the 施工单 §3
   explicitly says "rewind always generates a branch session".
3. **Use LLM for arc segmentation** — rejected for v1: adds latency and cost
   for a display-only feature.

## Follow-ups

- P25: Bridge / Remote / Daemon.
- Later: file snapshots on rewind, teleport cloud URL.
- Later: improve arc with embedding-based topic clustering.

## Validation

- `bun test test/core/session/arc.test.ts` — 10 tests pass.
- `bun test test/core/session/rewind.test.ts` — 5 tests pass.
- `bun run release:check` — 1635 pass / 0 fail, coverage PASS.
