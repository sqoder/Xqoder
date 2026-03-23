# Changelog

All notable changes to XQoder are documented in this file.

## [2026-03-23] - 12-Week Roadmap Milestone

### Added
- Real-project eval pipeline extensibility:
  - target-level `enabled` / `prepareCommand` / `testCommand`
  - dedicated `run-real-project-test-eval.mjs` runner
  - orchestrator options `--no-prepare`, `--prepare-timeout-ms`, `--no-reports`
- External OSS sample target onboarding:
  - `docs/evals/real-project-targets.opensource.json`
  - `docs/evals/real-project-targets.opensource.example.json`
- Platform matrix CI Linux beta job (`macOS + Linux + Windows` structure).
- Integration coverage for automatic-action promotion in fix flow:
  - verifies promotion, safe execution, permissions persistence, and audit logging.
- Phase 4 release gate review artifact:
  - `docs/artifacts/release/phase4-gate-review-2026-03-23.md`
  - tracks remaining remote CI prerequisite for final publish gate.

### Changed
- `ProjectTestRunner` now supports explicit command execution even without `package.json`.
- Real-project build/fix drill scripts accept target-level test command overrides.
- Quality report generation now auto-syncs `docs/opencode-comparison.md` metrics from benchmark/eval JSON reports.
- Golden snapshots refreshed to match current terminal renderer output.
- `verify-week4-navigation` script migrated to current terminal-core APIs (message jump controller + reducer overlay stack), removing stale `renderer-boxes` dependency.

### Verified
- `pnpm --filter @xqoder/cli exec vitest run src/commands/fix.integration.test.ts` passed.
- `pnpm release:check:strict` passed.
- `pnpm release:prepare:rc:strict:capture` generated RC plan artifacts in `docs/artifacts/release/`.
