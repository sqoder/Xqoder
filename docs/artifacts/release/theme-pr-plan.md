# Theme PR Plan

Generated: 2026-03-24T14:59:08.334Z

- Source branch: `codex/phase4-gate-close-20260323`
- Base ref: `origin/main`
- Changed paths: total=`11760`, branch=`10984`, staged=`0`, unstaged=`272`, untracked=`592`

## Canonical Theme PRs

### Session truth-source

- Suggested branch: `codex/session-truth-source`
- Why this slice: 聚焦 session snapshot 真相源、旧 API 退役和恢复链路边界。
- Path count: total=`56`, branch=`8`, staged=`0`, unstaged=`23`, untracked=`33`
- Extraction: `node ./scripts/extract-theme-pr-slice.mjs --theme session-truth-source --target ../xqoder-session-truth-source --base origin/main`
- Validation: `node ./scripts/verify-session-theme-boundary.mjs && node ./scripts/verify-no-agent-compat-imports.mjs && node ./scripts/verify-session-lifecycle.mjs`
- Sample paths:
  - packages/agent/src/project-memory.test.ts
  - packages/agent/src/project-memory.ts
  - packages/agent/src/session/sanitize.test.ts
  - packages/agent/src/session/session.test.ts
  - packages/agent/src/session/session.ts
  - packages/agent/src/session/store.snapshot.test.ts
  - packages/agent/src/session/store.test.ts
  - packages/agent/src/session/store.ts
  - packages/cli/src/commands/acp.test.ts
  - packages/cli/src/commands/acp.ts
  - packages/cli/src/commands/chat.test.ts
  - packages/cli/src/commands/export.test.ts

### Terminal boundary cleanup

- Suggested branch: `codex/terminal-boundary-cleanup`
- Why this slice: 聚焦 terminal-app / terminal-core / tui 主路径削薄与 typed contract 收口。
- Prerequisites: `session-truth-source`, `shared-contract-extraction`, `storage-decoupling`
- Path count: total=`258`, branch=`40`, staged=`0`, unstaged=`109`, untracked=`148`
- Extraction: `node ./scripts/extract-theme-pr-slice.mjs --theme terminal-boundary-cleanup --target ../xqoder-terminal-boundary-cleanup --base origin/main`
- Validation: `node ./scripts/verify-terminal-theme-slice.mjs`
- Sample paths:
  - packages/cli/package.json
  - packages/cli/src/attachment-references.ts
  - packages/cli/src/commands/rollbacks.ts
  - packages/cli/src/context-references.ts
  - packages/cli/src/services/today-session-stats.ts
  - packages/cli/src/terminal-app/autocomplete-controller.test.ts
  - packages/cli/src/terminal-app/autocomplete-controller.ts
  - packages/cli/src/terminal-app/copy-selection-controller.test.ts
  - packages/cli/src/terminal-app/copy-selection-controller.ts
  - packages/cli/src/terminal-app/editor-command-runner.test.ts
  - packages/cli/src/terminal-app/editor-command-runner.ts
  - packages/cli/src/terminal-app/editor-key-controller.test.ts

### Server modularization

- Suggested branch: `codex/server-modularization`
- Why this slice: 聚焦 CLI server 路由拆分、入口削薄和 server 集成回归。
- Path count: total=`6`, branch=`2`, staged=`0`, unstaged=`2`, untracked=`4`
- Extraction: `node ./scripts/extract-theme-pr-slice.mjs --theme server-modularization --target ../xqoder-server-modularization --base origin/main`
- Validation: `pnpm --filter @xqoder/cli typecheck && pnpm --filter @xqoder/cli exec vitest run src/server/index.test.ts`
- Sample paths:
  - packages/cli/src/server/in-memory-client.ts
  - packages/cli/src/server/index.test.ts
  - packages/cli/src/server/index.ts
  - packages/cli/src/server/session-core-routes.ts
  - packages/cli/src/server/stream-routes.ts
  - packages/cli/src/server/system-search-routes.ts

### Storage decoupling

- Suggested branch: `codex/storage-decoupling`
- Why this slice: 聚焦 storage/runtime append 边界、DTO 收口和 runtime session backing-store 解耦。
- Prerequisites: `session-truth-source`, `shared-contract-extraction`
- Path count: total=`16`, branch=`0`, staged=`0`, unstaged=`5`, untracked=`11`
- Extraction: `node ./scripts/extract-theme-pr-slice.mjs --theme storage-decoupling --target ../xqoder-storage-decoupling --base origin/main`
- Validation: `node ./scripts/verify-storage-theme-slice.mjs`
- Sample paths:
  - packages/cli/src/services/runtime-session-backing-store.ts
  - packages/runtime/package.json
  - packages/runtime/src/core/event-bus.contract.test.ts
  - packages/runtime/src/core/event-bus.ts
  - packages/runtime/src/core/index.ts
  - packages/runtime/src/core/registry.smoke.test.ts
  - packages/runtime/src/core/registry.ts
  - packages/runtime/src/core/runtime-kernel.ts
  - packages/runtime/src/index.ts
  - packages/storage-sqlite/package.json
  - packages/storage-sqlite/src/adapter.contract.test.ts
  - packages/storage-sqlite/src/index.ts

### Release gate hardening

- Suggested branch: `codex/release-gate-hardening`
- Why this slice: 聚焦 strict gate、contract/session/terminal blocker、CI 串联与 release artifact 对齐。
- Prerequisites: `session-truth-source`, `terminal-boundary-cleanup`, `storage-decoupling`
- Path count: total=`98`, branch=`23`, staged=`0`, unstaged=`15`, untracked=`73`
- Extraction: `node ./scripts/extract-theme-pr-slice.mjs --theme release-gate-hardening --target ../xqoder-release-gate-hardening --base origin/main`
- Validation: `pnpm verify:contracts && pnpm verify:terminal:main-path && pnpm verify:release:blockers && pnpm release:check:strict:dry-run`
- Sample paths:
  - .github/workflows/benchmark-gates.yml
  - .github/workflows/ci.yml
  - .github/workflows/manual-e2e.yml
  - .github/workflows/platform-matrix.yml
  - .github/workflows/release-gate.yml
  - .github/workflows/renderer-mode-rust-tests.yml
  - .github/workflows/session-recovery.yml
  - docs/artifacts/release/latest-index.md
  - docs/artifacts/release/phase4-gate-review-2026-03-23.md
  - docs/artifacts/release/phase4-gate-review-2026-03-24.md
  - docs/artifacts/release/prepare-beta-strict.txt
  - docs/artifacts/release/prepare-beta.txt

## Supporting Slices

### Shared contract extraction

- Suggested branch: `codex/shared-contract-extraction`
- Why this slice: 承接 Day 12 shared 配置/协议拆分与跨包消费面收口。
- Path count: total=`66`, branch=`12`, staged=`0`, unstaged=`40`, untracked=`25`
- Extraction: `node ./scripts/extract-theme-pr-slice.mjs --theme shared-contract-extraction --target ../xqoder-shared-contract-extraction --base origin/main`
- Validation: `pnpm --filter @xqoder/shared typecheck && pnpm --filter @xqoder/shared exec vitest run src/config.test.ts src/tool-permissions.test.ts src/project-permissions.test.ts && pnpm --filter @xqoder/shared build && pnpm --filter @xqoder/agent typecheck && pnpm --filter @xqoder/cli typecheck`
- Sample paths:
  - packages/agent/package.json
  - packages/agent/src/agent-provider.test.ts
  - packages/agent/src/agent-provider.ts
  - packages/agent/src/agent.permissions.test.ts
  - packages/agent/src/agent.ts
  - packages/agent/src/agents.test.ts
  - packages/agent/src/agents.ts
  - packages/agent/src/deploy/config-generator.test.ts
  - packages/agent/src/deploy/config-generator.ts
  - packages/agent/src/deploy/deployer.ts
  - packages/agent/src/deploy/index.ts
  - packages/agent/src/deploy/project-name.ts

### Fix orchestration cleanup

- Suggested branch: `codex/fix-orchestration`
- Why this slice: 承接 fix command 拆分与 post-fix 校验链路。
- Path count: total=`7`, branch=`1`, staged=`0`, unstaged=`1`, untracked=`5`
- Extraction: `node ./scripts/extract-theme-pr-slice.mjs --theme fix-orchestration --target ../xqoder-fix-orchestration --base origin/main`
- Validation: `pnpm --filter @xqoder/cli typecheck && pnpm --filter @xqoder/cli exec vitest run src/commands/fix.test.ts src/commands/fix.integration.test.ts`
- Sample paths:
  - packages/cli/src/commands/fix-history.ts
  - packages/cli/src/commands/fix-lsp.ts
  - packages/cli/src/commands/fix-remediation.ts
  - packages/cli/src/commands/fix-validation.ts
  - packages/cli/src/commands/fix.integration.test.ts
  - packages/cli/src/commands/fix.test.ts
  - packages/cli/src/commands/fix.ts

### Stability docs only

- Suggested branch: `codex/stability-docs`
- Why this slice: 承接 stability board / baseline / daily log 等纯文档同步面。
- Path count: total=`4`, branch=`0`, staged=`0`, unstaged=`0`, untracked=`4`
- Extraction: `node ./scripts/extract-theme-pr-slice.mjs --theme stability-docs --target ../xqoder-stability-docs --base origin/main`
- Validation: `pnpm verify:quality:reports`
- Sample paths:
  - docs/stability/baseline.md
  - docs/stability/session-truth-source-inventory-2026-03-24.md
  - docs/stability/stability-board.md
  - docs/stability/stability-daily-log.md

## Reviewability Risks

### Skills vendoring

- Why this slice: 本地 agent skill 资产不应该混进 reviewable PR，需先剥离。
- Path count: total=`232`, branch=`0`, staged=`0`, unstaged=`0`, untracked=`232`
- Sample paths:
  - .agents/skills/gstack-autoplan
  - .agents/skills/gstack-benchmark
  - .agents/skills/gstack-browse
  - .agents/skills/gstack-canary
  - .agents/skills/gstack-careful
  - .agents/skills/gstack-cso
  - .agents/skills/gstack-design-consultation
  - .agents/skills/gstack-design-review
  - .agents/skills/gstack-document-release
  - .agents/skills/gstack-freeze
  - .agents/skills/gstack-guard
  - .agents/skills/gstack-investigate

### Generated or noise

- Why this slice: 这些路径不适合作为 reviewable PR 内容，应先清掉或单独处理。
- Path count: total=`10861`, branch=`10861`, staged=`0`, unstaged=`0`, untracked=`0`
- Sample paths:
  - .pnpm-store/v10/files/00/1450656b568e26bfd117638dbf3a604b24867f57391c6a5cd225f73daa4ae2c56d2e2de7e714107ca291b12b3fa97a2326039f09b7661b8917ef61e77c5833
  - .pnpm-store/v10/files/00/179ca79165121f5490874e79dfff329c06fbc1bf1e3869b43cd613496309a2de58b0deda2e24943ec0786b65641004cd2c288921aef9529fb5792b3db24d5a
  - .pnpm-store/v10/files/00/194c86d4fb03dd66f92a96eaee62ff3dfedbb0fb7fe3923103d0697c97f0cdc56365501005f0981719d4e1a65a3a891415b886236130a6406068314f2ccd6b
  - .pnpm-store/v10/files/00/1d1c966d3209a19b37e9587126f8a01cbebbb1180f19f3c2c97617ee1ff55108f3cabb2df88a82114adba6a967c5d6773b873cafcd32bf23fbeedfb6004ca4
  - .pnpm-store/v10/files/00/225de90535878af601689af8780bbde844f7aabf555e4da1de2093df1faf02ac843b7858da664675145f13d4febee195d7b0ac56d15f629b1fc899305b869d
  - .pnpm-store/v10/files/00/22d9f39c97710d5f76cdee47dce7d01c5eda57eaa87c81a51ab6a29b3ed0f6122ebd75634d15c4b7d0e6bfe9bcf60360c90ae39c388cc37cd0fe7c876ae323
  - .pnpm-store/v10/files/00/259eb59667486a18b71d2331aa17230b0d1bcfa937c28a7184fbe55a678a0a11c9208bd79ed38f70a37470f49e5dc083c3d4bbf0473b8dc00cc322b72be135
  - .pnpm-store/v10/files/00/2a442b4d14e3fa23b5c9140e7d98c28e05aae7f89573e1c62000471617a6b80fe520c04f8a05d2b3276052a93eade9787322cd743624e7f3f85615e080ead2
  - .pnpm-store/v10/files/00/2f0c8c7ec6c893f81875a035ef5c4a0f1dbb6ff141072009b5fe5ae26109e9d33e953cf210795a89212639a44f9ca040af15aa572db2065f86aae928abbefb
  - .pnpm-store/v10/files/00/3a6574563563f1cf76778350bf270849ec4fef23d19022ebdd0de2189054e32eca3eca690dac81fdd601f93b086153f0f818b1f091292918b26a65a6df774b
  - .pnpm-store/v10/files/00/3b30be0d424c62bf693915c6c841ba862b68571acc5c03f1b2e2a890a03f459ae80477872dcacbd10b7c9d5725efb1def392068f3a95a8ed6137413747f899
  - .pnpm-store/v10/files/00/44e7c43527a86f6f116069d2b4dd72c13411a7164ae8f818f99be28fd31d5b9505376248fcf14c6516bb3e611aa41120aaf96165dd45098985f0899b50c205

### Unassigned

- Why this slice: 当前规则还没覆盖的路径，需要人工再分流。
- Path count: total=`156`, branch=`37`, staged=`0`, unstaged=`77`, untracked=`57`
- Sample paths:
  - .gitignore
  - CHANGELOG.md
  - Daemon
  - docs/1.md
  - docs/architecture.md
  - docs/artifacts/chat-session-store-injection-allowlist.json
  - docs/artifacts/golden/autocomplete-complete-overlay.actual.txt
  - docs/artifacts/golden/autocomplete-complete-overlay.style.actual.txt
  - docs/artifacts/golden/autocomplete-complete-overlay.style.txt
  - docs/artifacts/golden/autocomplete-complete-overlay.txt
  - docs/artifacts/golden/chinese-message.actual.txt
  - docs/artifacts/golden/chinese-message.style.actual.txt

