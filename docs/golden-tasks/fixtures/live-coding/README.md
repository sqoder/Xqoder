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
  05-denied-permission-alternative/  scenario.txt — permission-denied alternative path
  06-session-resume/                  src/ + test/ + transcript.md — resume mid-task
  07-mcp-readonly/                    inventory.json — read-only resource Q&A
  08-rules-memory/                    CLAUDE.md + .xqoder/notepad.md + src/ — rule loading
  09-diff-approval/                   src/ — approval/diff-preview path
  10-dangerous-bash-denied/           sandbox-log.txt — sandbox denial scenario
```

Each task's README describes the scenario, the acceptance signal, and what
the final agent response must mention. Acceptance is literal-string match
against the final response text (see `expectedAll` / `expectedAny` in the
manifest) — not behavioural assertions against the fixture. A later phase
can tighten scoring into "agent must make the tests pass" once baseline
numbers exist.

## Reset strategy

For `--live` runs, `scripts/run-golden-tasks.ts` calls
`prepareLiveFixtureWorkspace` (see `scripts/lib/prepare-live-fixture-workspace.ts`)
before each task. It copies the template subdir into
`tmp/golden-workspaces/<task-id>/` and runs the agent there. The template
is never mutated. Consequences:

- Every file the agent might touch must be committed — the fixture tree
  must live under version control in this repo.
- The workspace is wiped and repopulated before every task, so state from
  any prior run cannot leak.
- Running the suite twice yields an identical starting state.

For repo-evidence (non-`--live`) runs the agent reads the template directly
and never writes, so no reset is needed.
