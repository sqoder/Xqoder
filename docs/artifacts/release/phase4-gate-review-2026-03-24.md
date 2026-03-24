# Phase 4 Gate Review (2026-03-24)

Generated on: 2026-03-24 (Asia/Shanghai)  
Scope: Day 14 final acceptance preflight / merge readiness

## Executive Summary

- Release artifact snapshots are now aligned to `origin/main` instead of mixing local package metadata with remote tag state.
- The current branch already contains release gate hardening, blocker drills, and unified contract/terminal gates.
- Reviewability planning is now materialized as [theme-pr-plan.md](/Users/wangxinglin/Desktop/code/Xqoder/docs/artifacts/release/theme-pr-plan.md), and the matching extractor is available through [extract-theme-pr-slice.mjs](/Users/wangxinglin/Desktop/code/Xqoder/scripts/extract-theme-pr-slice.mjs) / [theme-pr-extract-common.mjs](/Users/wangxinglin/Desktop/code/Xqoder/scripts/theme-pr-extract-common.mjs).
- Standalone slice validation has now completed the prerequisite chain: `/Users/wangxinglin/Desktop/code/xqoder-session-truth-source`, `/Users/wangxinglin/Desktop/code/xqoder-terminal-boundary-cleanup-fresh`, and `/Users/wangxinglin/Desktop/code/xqoder-storage-decoupling-fresh2` all pass their own theme-scoped gates in isolation.
- `release-gate-hardening` has now been revalidated on `/Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5`, where `pnpm verify:contracts`、`pnpm verify:terminal:main-path`、`pnpm verify:release:blockers`、`pnpm release:check:strict:dry-run` all succeed in the extracted slice.
- `origin/main` is not merge-ready yet: an isolated worktree run confirmed that `pnpm release:check:strict` does not exist on the remote reference.

## Acceptance Snapshot

| Criteria | Status | Evidence |
| --- | --- | --- |
| Release artifact reflects real remote state | ✅ Pass | [latest-index.md](/Users/wangxinglin/Desktop/code/Xqoder/docs/artifacts/release/latest-index.md) and [release-state.json](/Users/wangxinglin/Desktop/code/Xqoder/docs/artifacts/release/release-state.json) now record `origin/main` ref/commit, local-vs-remote version drift, and missing gate scripts |
| Hard release gates are defined on the working branch | ✅ Pass | [release-check-strict.mjs](/Users/wangxinglin/Desktop/code/Xqoder/scripts/release-check-strict.mjs), [verify-contract-gates.mjs](/Users/wangxinglin/Desktop/code/Xqoder/scripts/verify-contract-gates.mjs), [verify-terminal-main-path.mjs](/Users/wangxinglin/Desktop/code/Xqoder/scripts/verify-terminal-main-path.mjs), and [verify-release-blockers.mjs](/Users/wangxinglin/Desktop/code/Xqoder/scripts/verify-release-blockers.mjs) are wired into CI |
| Theme PR split is executable instead of aspirational | ✅ Pass | [theme-pr-plan.md](/Users/wangxinglin/Desktop/code/Xqoder/docs/artifacts/release/theme-pr-plan.md) now proposes `session truth-source / terminal boundary cleanup / server modularization / storage decoupling / release gate hardening` branches, [extract-theme-pr-slice.mjs](/Users/wangxinglin/Desktop/code/Xqoder/scripts/extract-theme-pr-slice.mjs) can materialize those slices into detached worktrees, and the prerequisite chain has been physically validated on `/Users/wangxinglin/Desktop/code/xqoder-session-truth-source`, `/Users/wangxinglin/Desktop/code/xqoder-terminal-boundary-cleanup-fresh`, `/Users/wangxinglin/Desktop/code/xqoder-storage-decoupling-fresh2`, and `/Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5` |
| Latest hardened release-gate slice can execute the planned validation quartet | ✅ Pass | `/Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5` now passes `pnpm verify:contracts`, `pnpm verify:terminal:main-path`, `pnpm verify:release:blockers`, and `pnpm release:check:strict:dry-run` |
| Latest `origin/main` can execute final strict gate | ❌ Fail | Isolated worktree validation on `origin/main @ c9b233b6d4e23223370ad7d22cf2c43cbab41d8f` returned `Command "release:check:strict" not found` |
| Main branch is ready to merge Day 14 closure | ❌ Fail | Remote still lacks `release:check:strict`, `release:check:strict:dry-run`, `capture:release:plans`, `verify:contracts`, `verify:session:recovery`, `verify:terminal:main-path`, and `verify:release:blockers` |

## What Was Actually Closed

### Removed legacy interfaces

- `agent/runtime/cli` non-test source no longer exposes `getSession()/loadSession()` as active session truth-source APIs; only the `session.load` command name compatibility shell remains.
- `storage-sqlite` no longer needs to expose agent-specific session DTOs in-package; the agent bridge was pushed outward into CLI services.
- `report-release-state.mjs` no longer emits a pseudo-remote snapshot assembled from local package version plus remote tags.

### Large files decomposed

- Terminal/TUI main path was split across [editor-command-runner.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/terminal-app/editor-command-runner.ts), [session-runner.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/terminal-app/session-runner.ts), [reducer-viewport.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/terminal-app/reducer-viewport.ts), [reducer-overlay.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/terminal-app/reducer-overlay.ts), [agent-service-session-runtime.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/tui/agent-service-session-runtime.ts), [agent-service-remote-stream.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/tui/agent-service-remote-stream.ts), and [agent-service-local-run.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/tui/agent-service-local-run.ts).
- Server routing was split out of [index.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/server/index.ts) into [system-search-routes.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/server/system-search-routes.ts), [session-core-routes.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/server/session-core-routes.ts), and [stream-routes.ts](/Users/wangxinglin/Desktop/code/Xqoder/packages/cli/src/server/stream-routes.ts).
- `fix.ts` was reduced to orchestration by moving LSP, remediation, validation, and history/session synchronization into dedicated modules.

### Coupling reduced

- Runtime chat append now prefers `SessionStore.appendMessage()` with storage summary fallback, instead of forcing every write through snapshot save.
- `storage-sqlite` uses local runtime session DTOs and no longer directly leans on `@xqoder/agent` / `@xqoder/shared` for its non-test core boundary.
- `shared` was cut back from a single giant `types.ts` aggregator into domain modules for config, project/runtime/test/deploy/workflow, and llm/message/tool protocols.
- Terminal Rust bridge now uses an explicit typed contract instead of `any` / `unknown as` on the main renderer state path.
- `verify:contracts` and `verify:terminal:main-path` are now self-bootstrapping in fresh worktrees: contract gate starts with a dependency build, while terminal main-path now runs source-based `verify:tui` plus `verify-terminal-theme-slice` instead of assuming a full CLI build is already present.

## Gates That Are Now Release Blockers

- `pnpm verify:contracts`
- `pnpm verify:session:recovery`
- `pnpm verify:terminal:main-path`
- `pnpm verify:release:blockers`
- `pnpm release:check:strict`

## Verification Log

1. `git fetch origin`  
   Result: remote snapshot refreshed before artifact capture.
2. `pnpm capture:release:plans`  
   Result: release plans, workflow parity, release state, theme PR plan, latest index, and quality pages refreshed.
3. `node ./scripts/report-release-state.mjs`  
   Result: remote snapshot now explicitly shows `origin/main` version drift and missing strict-gate scripts.
4. `pnpm audit:theme:prs`  
   Result: current diff is now grouped into canonical theme PRs, supporting slices, and explicit noise buckets.
5. `node --test ./scripts/theme-pr-plan-common.test.mjs ./scripts/theme-pr-extract-common.test.mjs`  
   Result: planner rendering and slice copy/delete helpers both passed (`5/5`).
6. `pnpm extract:theme:pr -- --theme release-gate-hardening --dry-run`  
   Result: release-gate-hardening slice now reports `copy=97 / delete=1 / total=98`, and the extractor itself is included in that canonical theme.
7. `node ./scripts/extract-theme-pr-slice.mjs --theme release-gate-hardening --target <tmp>`  
   Result: a temporary worktree was created from `origin/main`, switched onto `codex/release-gate-hardening`, populated with the theme slice, and then removed after status inspection.
8. `git worktree add --detach <tmp> origin/main`  
   Result: isolated verification environment created from the latest remote mainline.
9. `(cd <tmp> && pnpm release:check:strict)`  
   Result: failed immediately because the script is not defined on `origin/main`.
10. `pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening install --frozen-lockfile`  
    Result: standalone `release-gate-hardening` slice can now install cleanly after the extractor pulled in `check-daemon-env.mjs`.
11. `pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening build:cli && pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening verify:release:blockers && pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening release:check:strict:dry-run`  
    Result: standalone slice can build CLI, run blocker drills, and render the strict checklist in isolation.
12. `pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening verify:contracts`  
    Result: failed because `packages/runtime` on the `origin/main` base does not yet contain `event-bus/session-store/runtime-kernel` contract test files, so contract gate hardening cannot be the very first PR to land.
13. `pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening verify:terminal:main-path`  
    Result: failed with `mapAppStateToTUIState is not a function`, confirming that typed terminal renderer cleanup is another prerequisite for making the gate hardening slice independently green.
14. `node ./scripts/extract-theme-pr-slice.mjs --theme storage-decoupling --target /Users/wangxinglin/Desktop/code/xqoder-storage-decoupling-fresh2 --base origin/main --branch codex/storage-decoupling-fresh2 --force`  
    Result: storage decoupling slice was re-materialized with the full `benchmark-common -> quality-report-common -> real-project-eval-report-common -> real-project-targets-common` support chain.
15. `pnpm -C /Users/wangxinglin/Desktop/code/xqoder-storage-decoupling-fresh2 install --no-frozen-lockfile && node /Users/wangxinglin/Desktop/code/xqoder-storage-decoupling-fresh2/scripts/verify-storage-theme-slice.mjs`  
    Result: storage slice now passes runtime/storage typecheck, adapter/runtime contract suites, and `verify:session:recovery` in isolation.
16. `node /Users/wangxinglin/Desktop/code/xqoder-terminal-boundary-cleanup-fresh/scripts/verify-terminal-theme-slice.mjs`  
    Result: terminal slice now passes its full theme-scoped gate in isolation (`terminal-app`、`terminal-core`、`tui` source tests).
17. `pnpm verify:tui && XQODER_INJECT_TERMINAL_REGRESSION=legacy-role-label pnpm verify:tui`  
    Result: the new source-based TUI visual gate passes on the happy path and still fails deterministically under the injected legacy-role-label regression.
18. `pnpm verify:terminal:main-path`  
    Result: terminal main-path now passes on the working branch without relying on a full CLI build, because it runs `verify:tui` and `verify-terminal-theme-slice` directly.
19. `node ./scripts/extract-theme-pr-slice.mjs --theme release-gate-hardening --target /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5 --base origin/main --branch codex/release-gate-hardening-fresh5 --force`  
    Result: a fresh release-gate slice was re-materialized after the gate hardening changes, avoiding stale-worktree contamination.
20. `pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5 install --no-frozen-lockfile && pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5 verify:contracts && pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5 verify:terminal:main-path && pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5 verify:release:blockers && pnpm -C /Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5 release:check:strict:dry-run`  
    Result: the extracted release-gate slice now passes the planned validation quartet end-to-end.

## Decision

Phase 4 / Day 14 current status: **not yet merge-ready on remote mainline**.

## Required Next Steps

1. Use `/Users/wangxinglin/Desktop/code/xqoder-session-truth-source`、`/Users/wangxinglin/Desktop/code/xqoder-terminal-boundary-cleanup-fresh`、`/Users/wangxinglin/Desktop/code/xqoder-storage-decoupling-fresh2`、`/Users/wangxinglin/Desktop/code/xqoder-release-gate-hardening-fresh5` 作为 seeded review worktree，按依赖顺序落 PR，而不是继续在大分支里堆叠变更。
2. Use [theme-pr-plan.md](/Users/wangxinglin/Desktop/code/Xqoder/docs/artifacts/release/theme-pr-plan.md) to peel generated noise / vendored skills out of the current worktree before opening those PRs.
3. Land the prerequisite themes and the already-validated release-gate slice to remote mainline so that `origin/main` actually contains the strict-gate scripts and supporting source.
4. Re-run full `pnpm release:check:strict` on the latest `origin/main` after those slices land; the remaining blocker is remote adoption, not local slice validation anymore.
