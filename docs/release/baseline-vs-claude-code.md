# Baseline vs Claude Code

Source of truth for "are we making progress?" — the one number that the weekly
scorecard must reconcile against. Updated only after a real (not repo-evidence
fallback) golden-task run.

Last updated: 2026-05-12

## Current state: no fair baseline exists yet

The CLAUDE.md rule says "golden task pass rate must not regress". Until today the
rule was unenforceable because:

- `bun run eval:golden` (default, `repo-evidence` mode) short-circuits the agent
  via `buildGoldenFallbackResponse` at `scripts/run-golden-tasks.ts:95-101`.
  If a deterministic string containing the expected literals can be assembled
  from repo file paths, that string is returned and the agent loop never runs.
  Today's run: 10/10 pass, 10/10 via fallback. This measures the literal
  matcher, not the agent.
- `bun run eval:golden:live` requires `XQODER_LLM_API_KEY` (or a provider-
  specific key). It has never been run against this repo — no artifact exists
  under `docs/release/latest-live-acceptance-metrics.json` from an actual live
  run, and `weekly-scorecard.md` every entry says "golden task: 未重跑".
- `baseline-vs-claude-code.md` (this file) did not exist until now.

Net: every "golden task pass: X/10 → Y/10" line in the scorecard is either
fallback data or not-run data. The regression gate has never fired because it
has nothing to compare against.

## What a real baseline run looks like

1. Export a credential: `export XQODER_LLM_API_KEY=sk-...` plus
   `XQODER_LLM_PROVIDER` (`anthropic` | `openai` | `dashscope` | `gemini` |
   `openrouter`) if not the default, and `XQODER_LLM_MODEL` to pin the model.
2. `bun run eval:golden:live` — this runs 10 tasks in
   `docs/golden-tasks/xqoder-live-coding.json` through `runChatHeadless`, each
   capped at 30 turns, writing to
   `docs/release/latest-live-acceptance-metrics.json` and the matching report.
3. The harness requires ≥ 70 % pass (7/10) to exit 0.

## Blocker (resolved 2026-05-12): fixture tree + scoped reset

Historical note: until 2026-05-12 the manifest pointed every task's `cwd`
at `../..` (the XQoder repo root) and said "in the prepared live-coding
fixture", but no fixture directory existed. A live run would have sent
the agent at the real `src/` tree with edit-intent prompts.

Resolution landed in two pieces:

1. **Fixture tree**: `docs/golden-tasks/fixtures/live-coding/01..10` —
   each subdir holds the minimum content to make its task prompt
   concrete (failing test + buggy impl, TS error file, transcript.md,
   MCP inventory snapshot, etc.). See
   `docs/golden-tasks/fixtures/live-coding/README.md` for the layout
   and the per-task scenarios.
2. **Manifest rewrite**: each task's `cwd` now points at
   `fixtures/live-coding/<task>` instead of `../..`. The agent cannot
   touch `src/` via the golden harness anymore.
3. **Scoped reset**: `scripts/run-golden-tasks.ts::resetFixtureCwd`
   runs `git restore --source=HEAD -- <cwd>` + `git clean -fd -- <cwd>`
   before every task. The function bails out unless `<cwd>` resolves
   under `docs/golden-tasks/fixtures/`, so it can never reset
   anything outside the fixture tree. This keeps the suite idempotent
   even if the agent edits files during a task.

Downstream consequence: every fixture file must be committed. Uncommitted
fixture changes are reverted on the next run.

The live gate is therefore unblocked on the blast-radius axis. What
remains before Run 1 can execute:

- A live LLM credential (`XQODER_LLM_API_KEY` or a provider-specific key).
- A first `bun run eval:golden:live` invocation whose
  `latest-live-acceptance-metrics.json` gets committed (or its hash
  recorded) and referenced in Run 1 below.

No code changes are blocking — only "actually run it once".

## Baseline run log

### Run 0 — 2026-05-12, repo-evidence fallback (not a real baseline)

- Mode: `repo-evidence`, 10/10 pass, 10/10 via `buildGoldenFallbackResponse`.
- Meaning: confirms the harness plumbing (manifest load, report render,
  artifact write) works end-to-end. **Does not** measure agent ability.
- Artifact: `docs/release/latest-acceptance-metrics.json` (mode=repo-evidence).
- Not recorded below — this is infrastructure evidence, not a baseline.

### Run 1 — XQoder live baseline (pending)

Goal: first row of the real baseline. Expected output columns:

| Date | Mode | Provider / model | Passed | Rate | Avg steps | Tool failure rate | Notes |
|------|------|------------------|--------|------|-----------|-------------------|-------|

To be filled after the first `--live` run succeeds.

### Run 2 — Claude Code baseline against same manifest (pending)

Goal: anchor "are we catching up?". Claude Code CLI is pointed at the same 10
tasks in `docs/golden-tasks/xqoder-live-coding.json`, scored by the same
`evaluateGoldenTaskResponse` function (literal matcher). Columns match Run 1
so the two rows are directly comparable.

## Regression gate

Effective once Run 1 exists. Per CLAUDE.md:

- Weekly-scorecard entry must record the live pass rate, not the fallback
  number, and the live artifact must be committed (or its hash recorded).
- If a phase lands and `eval:golden:live` pass count drops below the previous
  live baseline, the phase does not ship — it either fixes the regression or
  documents why the manifest itself needed to change.
- If neither side of the comparison ran live, the rule is inert that week and
  the scorecard must say so explicitly rather than claim a number.

## Honest-audit line for weekly-scorecard.md

Until a live baseline exists, the scorecard "golden task pass" field should
read `not run (repo-evidence fallback only — no agent exercise)` rather than a
fraction. Fraction-shaped numbers imply the agent was measured, which is
untrue for every phase through P27.
