# Remaining Risk Staging Manifest

This manifest isolates the intended files for the review-finding fixes and the remaining-risk closure work. Existing unrelated modified or untracked files should stay unstaged.

## Intended fix and verification files

- `.github/workflows/ci.yml` — secrets gating and acceptance metrics artifacts for remote GitHub Actions validation.
- `.gitignore` — keeps generated VS Code extension output out of the review diff.
- `package.json` — adds the VS Code approval test gate to `release:check`.
- `docs/golden-tasks/xqoder-live-coding.json` — dry-run/live acceptance metrics manifest required by CI.
- `apps/vscode-extension/src/panel/chat-panel.ts` — uses stream-aware approval keys in the VS Code panel.
- `apps/vscode-extension/src/panel/approval-state.ts` — pure approval key, hydration, and resolve-target helpers.
- `test/vscode-extension/approval-state.test.ts` — regression coverage for stream-safe VS Code approval keys.
- `src/core/agent/tools/sandbox.ts` and `test/core/sandbox-path.test.ts` — symlink-parent sandbox regression.
- `src/core/agent/session/session.ts` and `test/core/session-approval-persistence.test.ts` — stream-safe approval persistence.
- `src/core/agent/session/session-cloners.ts`, `src/core/agent/session/session-metadata.ts`, `src/core/agent/session/session-types.ts`, `src/infra/storage/index.ts`, `src/interfaces/http/server.ts`, `src/interfaces/http/server-stream.ts`, `src/interfaces/http/server-session.ts`, `test/server-stream.test.ts`, and `test/server-session.test.ts` — durable stream-aware approval records and HTTP persistence wiring.
- `scripts/run-golden-tasks.ts`, `src/features/eval/golden-task-runner.ts`, and `test/features/golden-task-runner.test.ts` — rollback metrics regression and CI metrics artifacts.
- `src/core/agent/tools/command-tool.ts` and `test/command-tool.test.ts` — persistent shell cwd isolation.

## Do not stage by default

- Pre-existing product, release, or runtime changes outside the intended files above.
- Generated output under `apps/vscode-extension/out/`.
- Generated release evidence under `docs/release/latest-*` unless a release signoff explicitly needs it.

## Verification status

- `bun run --cwd apps/vscode-extension build` — pass.
- `bun run test:vscode-extension` — pass, 5 tests.
- `bun run release:check` — pass, 439 tests and coverage gate.
- `bun run acceptance:metrics` — pass, dry-run metrics generated.
- `git diff --check` — pass.

## Remote CI status

Remote GitHub Actions validation is still pending because this local repository has no configured Git remote. Add the target GitHub remote, push a clean branch containing only the intended files above, and open a draft PR to collect the runner URL.
