# Live-coding golden task fixtures

Each subdirectory is the `cwd` for one task in
`docs/golden-tasks/xqoder-live-coding.json`. The agent operates only inside
its own fixture subdir — never against the real XQoder `src/` tree.

## Layout

```
fixtures/live-coding/
  01-bug-fix/              src/ + test/ — failing test, off-by-one bug
  02-api-field/            src/ + test/ — additive API field extension
  03-lint-type-fix/        src/ + tsconfig.json — TS error to repair
  04-test-coverage/        src/ + test/ — TDD regression loop for NaN edge
  05-denied-permission/    src/ + biome.json — read-only alternative path
  06-session-resume/       src/ + test/ + transcript.md — resume mid-task
  07-mcp-readonly/         inventory.json — read-only resource Q&A
  08-rules-memory/         CLAUDE.md + .xqoder/notepad.md — rule loading
  09-diff-approval/        src/ — approval/diff-preview path
  10-dangerous-bash/       data.txt — sandbox denial scenario
```

Each task's README describes the scenario, the acceptance signal, and what
the final agent response must mention. Acceptance is literal-string match
against the final response text (see `expectedAll` / `expectedAny` in the
manifest) — not behavioural assertions against the fixture. A later phase
can tighten scoring into "agent must make the tests pass" once baseline
numbers exist.

## Reset strategy

`scripts/run-golden-tasks.ts` calls `git restore` + `git clean -fd` scoped
to each fixture subdir **before** every task, so every run starts from the
committed baseline regardless of what the agent did on the previous run.
Consequences:

- Every file the agent might touch must be committed — the fixture tree
  must live under version control in this repo.
- Untracked files the agent creates are removed between tasks.
- Running the suite twice yields an identical starting state.

The reset path is deliberately scoped to paths under
`docs/golden-tasks/fixtures/` — the harness refuses to reset anything
outside that prefix. See `resetFixtureCwd` in
`scripts/run-golden-tasks.ts`.
