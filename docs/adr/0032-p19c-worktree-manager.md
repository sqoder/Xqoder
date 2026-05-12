# ADR 0032 — P19c Worktree manager + tools + CLI

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P19c (sub-phase of P19 · Task V2 + Cron + Worktree + coordinator)
- **Preceding ADR:** ADR 0030 (P19b Cron scheduler)
- **Supersedes:** —

## Context

P19b delivered the cron scheduler. The 施工单
(`docs/openclaude-parity/phase-19-tasks-cron-worktree.md`) lists worktree
support as the third sub-phase:

> `EnterWorktreeTool / ExitWorktreeTool` + `worktree.ts / getWorktreePaths.ts`

ADR 0030 deferred this to P19c. P19d (coordinator + remaining task types)
remains.

## Decision

### 1. Zero-infrastructure core module: `src/core/worktree/`

Three files, one barrel:

- `worktree-types.ts` — `WorktreeSession`, `WorktreeInfo`, `AddWorktreeResult`,
  `validateWorktreeSlug`. Pure logic, no I/O.
- `worktree-manager.ts` — thin wrappers around `git worktree` via
  `child_process.execFile` (no execa / analytics / bootstrap deps). Exports:
  `findGitRoot`, `addWorktree`, `removeWorktree`, `listWorktrees`,
  `countWorktreeChanges`, `getCurrentBranch`, `getDefaultBranch`,
  `generateWorktreeSlug`.
- `worktree-session.ts` — module-level singleton tracking the one active
  worktree session per process. Mirrors openclaude's `sessionStorage`
  pattern but without the infrastructure import.
- `index.ts` — barrel re-exporting all public symbols.

TS alias `@xqoder/core-worktree` added to `tsconfig.json`.

Rationale:

- Same posture as `@xqoder/core-tasks` and `@xqoder/core-cron`: zero
  third-party deps, no infrastructure imports, pure-logic core that the
  architecture guardrail can enforce.
- `child_process.execFile` (not `execa`) keeps the supply chain narrow and
  avoids pulling in the CLI dependency chain.

### 2. Slug validation

`validateWorktreeSlug` enforces:

- Non-empty, ≤ 64 chars total.
- Each `/`-separated segment matches `[a-zA-Z0-9._-]+` — rejects `..`,
  absolute paths, spaces, and special chars.

Rationale: worktree path is constructed as
`<gitRoot>/.claude/worktrees/<slug>` via `path.join`. Segment-level
validation prevents path traversal even through `path.join`'s normalisation.

### 3. Worktree placement: `<gitRoot>/.claude/worktrees/<slug>`

Mirrors openclaude's `.claude/worktrees/` convention. The `.claude/`
directory is already used for plans and memory; co-locating worktrees keeps
all Claude-managed state in one place.

Branch name: `slug.replace(/\//g, '-')` — forward slashes in slugs are
valid for naming but git branch names cannot contain them in the same
position.

### 4. EnterWorktreeTool / ExitWorktreeTool

Registered in `agent-default-tools.ts` alongside the task and cron tools.

`enter_worktree`:
- Validates not already in a worktree session (one active at a time).
- Resolves git root from `context.cwd`.
- Calls `addWorktree(gitRoot, slug, baseRef)`.
- Stores the resulting `WorktreeSession` in the module singleton.
- Returns `{ worktreePath, worktreeBranch, sessionId, originalCwd }`.

`exit_worktree`:
- Reads the active session from the singleton.
- `action="keep"`: clears session, no git ops.
- `action="remove"`: checks for uncommitted changes via
  `countWorktreeChanges` (fail-closed: null → refuse). Calls
  `removeWorktree(gitRoot, path, force)`. Clears session.
- `discard_changes=true` skips the safety check and passes `force=true` to
  `git worktree remove`.

### 5. CLI: `xqoder worktree enter|list|remove`

`src/commands/core/worktree.ts` mirrors the task/cron CLI shape:
dep-injectable `writeOutput`, `--json` flag, thin `runSafely` wrapper.
Wired into `src/plugins/command-plugins.ts` alongside `taskCommand` and
`cronCommand`.

Subcommands:
- `enter [--name <slug>] [--base-ref <ref>] [--json]`
- `list [--json]`
- `remove <path> [--force] [--json]`

### 6. Architecture guardrail

New test in `test/architecture-guardrails.test.ts`:

```ts
it('keeps the core-worktree layer isolated from infrastructure and domain layers', () => {
    const violations = collectViolations('core/worktree', ['infrastructure', 'domain']);
    expect(formatViolations(violations)).toBe('');
});
```

## Consequences

### Positive

- Zero new third-party deps.
- `core/worktree` is fully testable without a real git repo (mock
  `worktree-manager` exports).
- Architecture guardrail enforced at the same level as `core/cron`.
- `xqoder worktree` CLI is immediately usable for scripting.

### Negative / accepted

- Single active worktree session per process — matches openclaude v1
  behaviour. Multiple concurrent worktrees deferred to P19d / later.
- No tmux session management (openclaude's `killTmuxSession`) — XQoder
  does not have a tmux integration in P19c scope.
- No hook integration (`executeWorktreeCreateHook`) — deferred to P14
  lifecycle hook wiring in a follow-up.

## Alternatives considered

1. **Reuse `execa`** — rejected: adds a dep the core layer doesn't need;
   `child_process.execFile` is sufficient for the 5 git commands used here.
2. **Store session in SQLite** — rejected: worktree sessions are
   process-scoped (one REPL = one session); a module singleton is simpler
   and avoids a new DB file for ephemeral state.
3. **Auto-enter worktree on `xqoder worktree enter`** — rejected: the CLI
   `enter` subcommand prints the path for the user to `cd` into; the tool
   `enter_worktree` updates `context.cwd` in-process. These are different
   surfaces with different semantics.

## Follow-ups

- P19d: coordinator mode + remaining task types (agent / remote-agent /
  monitor-mcp).
- Later: hook integration for `WorktreeCreate` / `WorktreeRemove` lifecycle
  events.
- Later: multiple concurrent worktree sessions if real usage demands it.

## Validation

- `bun test test/core/worktree/` — worktree-types (11), worktree-session (5),
  worktree-tools (10) tests pass.
- `bun test test/commands/core/worktree.test.ts` — 10 CLI tests pass.
- `bun test test/architecture-guardrails.test.ts` — new `core/worktree`
  guardrail passes.
- `bun run release:check` — all pass.
