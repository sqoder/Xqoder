# Real Project Workflow Eval

- Generated: 2026-03-24T14:59:11.401Z
- Summary: Aggregates workflow-history records for non-fixture projects and tracks progress toward the roadmap goal of publishing reproducible real-project build/test/fix/deploy coverage.
- Selection mode: targets
- Workflow history: /Users/wangxinglin/.xqoder/data/workflow-history.jsonl
- Real projects: 10
- Real-project runs: 129
- Targets file: /Users/wangxinglin/Desktop/code/Xqoder/docs/evals/real-project-targets.json
- Declared targets: 10
- Ready targets now: 9
- Sync-needed targets: 0
- Blocked targets: 1
- Disabled targets: 0

## Roadmap Targets

- Projects: 5
- Runs: 15
- Projects with build coverage: 5
- Projects with fix coverage: 5
- Projects with deploy coverage: 5

## Evaluation Protocol

- `build` coverage comes from a deterministic build drill: the runner executes the official `runBuildCommand` flow with an injected no-op generator, then validates the target with its real test suite.
- `test` coverage comes from `xqoder test --dir <projectRoot>` runs against each declared target.
- `fix` coverage comes from a deterministic fix drill: the runner writes a temporary `.xqoder/real-project-fix-drill.json` marker, executes the official `runFixCommand` flow with injected repair logic, and validates the result with the target project's real test suite.
- `deploy` coverage comes from a deterministic deploy drill: the runner executes the official `runDeployCommand` flow with a local deployer that runs the target build command and validates the declared output directory without touching a real cloud account.

## Acceptance

| Check | Target | Actual | Result |
| --- | --- | --- | --- |
| Captured real projects | >= 5 | 10 | PASS |
| Captured real-project workflow runs | >= 15 | 129 | PASS |
| Projects with build coverage | >= 5 | 9 | PASS |
| Projects with fix coverage | >= 5 | 9 | PASS |
| Projects with deploy coverage | >= 5 | 9 | PASS |
| Overall success rate | >= 0.6 | 0.9922 | PASS |

## Overview

| Metric | Value |
| --- | ---: |
| Overview / totalProjects | 10 |
| Overview / totalRuns | 129 |
| Overview / successfulRuns | 128 |
| Overview / failedRuns | 1 |
| Overview / overallSuccessRate | 0.9922 |
| Flow Success Rate / buildSuccessRate | 1 |
| Flow Success Rate / fixSuccessRate | 1 |
| Flow Success Rate / testSuccessRate | 1 |
| Flow Success Rate / deploySuccessRate | 0.9744 |
| Coverage / projectsWithBuildCoverage | 9 |
| Coverage / projectsWithFixCoverage | 9 |
| Coverage / projectsWithTestCoverage | 10 |
| Coverage / projectsWithDeployCoverage | 9 |
| Target Readiness / declaredTargets | 10 |
| Target Readiness / readyTargets | 9 |
| Target Readiness / syncNeededTargets | 0 |
| Target Readiness / blockedTargets | 1 |
| Target Readiness / disabledTargets | 0 |

## Target Readiness

| Target | Enabled | Readiness | Runs | Build | Fix | Test | Deploy | Requirements |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| XQoder Agent Package | yes | ready | 21 | 2 | 4 | 10 | 5 | n/a |
| XQoder Protocol Package | yes | ready | 21 | 3 | 3 | 10 | 5 | n/a |
| XQoder Shared Package | yes | ready | 20 | 2 | 3 | 10 | 5 | n/a |
| XQoder Plugin SDK Package | yes | ready | 20 | 2 | 3 | 10 | 5 | n/a |
| XQoder Permissions Package | yes | ready | 20 | 2 | 3 | 10 | 5 | n/a |
| OpenClaw Monorepo (Optional) | yes | ready | 7 | 1 | 1 | 1 | 4 | cmd=pnpm |
| OpenCode Core Package (Optional) | yes | ready | 6 | 1 | 1 | 1 | 3 | cmd=bun |
| OpenCode App Package (Optional) | yes | ready | 6 | 1 | 1 | 1 | 3 | cmd=bun |
| Directus Monorepo (Optional) | yes | ready | 7 | 1 | 1 | 1 | 4 | cmd=pnpm |
| Full Stack FastAPI Template (Optional) | yes | blocked | 1 | 0 | 0 | 1 | 0 | cmd=uv,python3,docker-compose | paths=.env | checks=postgres@localhost:5432 | blocked: failed readiness checks: postgres@localhost:5432 |

## Project Coverage

| Project | Runs | Success Rate | Build | Fix | Test | Deploy | Last Run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| XQoder Protocol Package | 21 | 1 | 3 | 3 | 10 | 5 | 2026-03-23T15:44:22.191Z |
| XQoder Agent Package | 21 | 1 | 2 | 4 | 10 | 5 | 2026-03-23T15:44:21.364Z |
| XQoder Permissions Package | 20 | 1 | 2 | 3 | 10 | 5 | 2026-03-23T15:44:24.778Z |
| XQoder Plugin SDK Package | 20 | 1 | 2 | 3 | 10 | 5 | 2026-03-23T15:44:24.077Z |
| XQoder Shared Package | 20 | 1 | 2 | 3 | 10 | 5 | 2026-03-23T15:44:23.286Z |
| Directus Monorepo (Optional) | 7 | 1 | 1 | 1 | 1 | 4 | 2026-03-23T15:44:55.584Z |
| OpenClaw Monorepo (Optional) | 7 | 1 | 1 | 1 | 1 | 4 | 2026-03-23T15:44:39.048Z |
| OpenCode App Package (Optional) | 6 | 1 | 1 | 1 | 1 | 3 | 2026-03-23T15:44:54.927Z |
| OpenCode Core Package (Optional) | 6 | 0.8333 | 1 | 1 | 1 | 3 | 2026-03-23T15:44:48.695Z |
| Full Stack FastAPI Template (Optional) | 1 | 1 | 0 | 0 | 1 | 0 | 2026-03-23T15:53:16.366Z |

## XQoder Protocol Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/protocol
- Runs: 21
- Success rate: 1
- First run: 2026-03-23T01:55:16.407Z
- Last run: 2026-03-23T15:44:22.191Z
- Notes: Small protocol package with deterministic build/test/fix drill coverage.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 3 | 1 | 523.7 |
| fix | 3 | 1 | 1 |
| test | 10 | 1 | 529 |
| deploy | 5 | 1 | 537.2 |

### Observed Commands

- `npm run build`
- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## XQoder Agent Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/agent
- Runs: 21
- Success rate: 1
- First run: 2026-03-23T01:55:15.466Z
- Last run: 2026-03-23T15:44:21.364Z
- Notes: Stable workspace package used as a deterministic real-project build/test/fix drill target.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 2 | 1 | 2369.5 |
| fix | 4 | 1 | 1.5 |
| test | 10 | 1 | 2294.2 |
| deploy | 5 | 1 | 1347.4 |

### Observed Commands

- `npm run build`
- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## XQoder Permissions Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/permissions
- Runs: 20
- Success rate: 1
- First run: 2026-03-23T01:55:19.009Z
- Last run: 2026-03-23T15:44:24.778Z
- Notes: Minimal package used to seed baseline real-project build/test/fix drill workflow history.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 2 | 1 | 130.5 |
| fix | 3 | 1 | 1 |
| test | 10 | 1 | 133.4 |
| deploy | 5 | 1 | 430.4 |

### Observed Commands

- `npm run build`
- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## XQoder Plugin SDK Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/plugin-sdk
- Runs: 20
- Success rate: 1
- First run: 2026-03-23T01:55:18.484Z
- Last run: 2026-03-23T15:44:24.077Z
- Notes: Plugin SDK package with a focused Vitest suite and deterministic build/test/fix drill coverage.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 2 | 1 | 520 |
| fix | 3 | 1 | 1 |
| test | 10 | 1 | 531.4 |
| deploy | 5 | 1 | 528.4 |

### Observed Commands

- `npm run build`
- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## XQoder Shared Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/shared
- Runs: 20
- Success rate: 1
- First run: 2026-03-23T01:55:17.557Z
- Last run: 2026-03-23T15:44:23.286Z
- Notes: Shared utilities package used for repeatable local build/test/fix drill evaluation.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 2 | 1 | 624 |
| fix | 3 | 1 | 1 |
| test | 10 | 1 | 648.3 |
| deploy | 5 | 1 | 807 |

### Observed Commands

- `npm run build`
- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## Directus Monorepo (Optional)

- Root: /Users/wangxinglin/Desktop/code/directus/packages/schema-builder
- Runs: 7
- Success rate: 1
- First run: 2026-03-23T14:30:00.772Z
- Last run: 2026-03-23T15:44:55.584Z
- Repo: https://github.com/directus/directus
- Notes: Validated Directus package target using packages/schema-builder with stable build/test/dist output for default external build/deploy drill coverage.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 1 | 1 | 1040 |
| fix | 1 | 1 | 2 |
| test | 1 | 1 | 1125 |
| deploy | 4 | 1 | 703.5 |

### Observed Commands

- `npm run build`
- `pnpm test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## OpenClaw Monorepo (Optional)

- Root: /Users/wangxinglin/Desktop/code/openclaw
- Runs: 7
- Success rate: 1
- First run: 2026-03-23T02:27:53.368Z
- Last run: 2026-03-23T15:44:39.048Z
- Repo: https://github.com/openclaw/openclaw
- Notes: Validated external OSS target with build/test/fix/deploy drill coverage and default-run readiness.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 1 | 1 | 794 |
| fix | 1 | 1 | 1 |
| test | 1 | 1 | 2195 |
| deploy | 4 | 1 | 15567 |

### Observed Commands

- `npm run build`
- `pnpm vitest run --config vitest.unit.config.ts src/logger.test.ts`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## OpenCode App Package (Optional)

- Root: /Users/wangxinglin/Desktop/code/opencode-dev/packages/app
- Runs: 6
- Success rate: 1
- First run: 2026-03-23T15:26:36.096Z
- Last run: 2026-03-23T15:44:54.927Z
- Repo: https://github.com/anomalyco/opencode
- Notes: Validated external OpenCode frontend target with test/fix/build/deploy drill coverage on the local snapshot checkout.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 1 | 1 | 637 |
| fix | 1 | 1 | 2 |
| test | 1 | 1 | 672 |
| deploy | 3 | 1 | 6552 |

### Observed Commands

- `bun run test:unit`
- `npm run build`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## OpenCode Core Package (Optional)

- Root: /Users/wangxinglin/Desktop/code/opencode-dev/packages/opencode
- Runs: 6
- Success rate: 0.8333
- First run: 2026-03-23T15:28:23.499Z
- Last run: 2026-03-23T15:44:48.695Z
- Repo: https://github.com/anomalyco/opencode
- Notes: Validated external OpenCode core target for test/fix/build/deploy drill coverage. Snapshot deploy uses OPENCODE_CHANNEL=latest plus a single-platform build override.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 1 | 1 | 89158 |
| fix | 1 | 1 | 1 |
| test | 1 | 1 | 108075 |
| deploy | 3 | 0.6667 | 6322.7 |

### Failure Buckets

| Bucket | Count |
| --- | ---: |
| deploy_build_failed | 1 |

### Observed Commands

- `bun run build --single`
- `bun test --timeout 30000`
- `npm run build`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## Full Stack FastAPI Template (Optional)

- Root: /Users/wangxinglin/Desktop/code/full-stack-fastapi-template/backend
- Runs: 1
- Success rate: 1
- First run: 2026-03-23T15:53:16.366Z
- Last run: 2026-03-23T15:53:16.366Z
- Repo: https://github.com/fastapi/full-stack-fastapi-template
- Notes: Optional Python backend target with docker-compose-backed local Postgres preparation. Default coverage is test-only for now; deploy/build/fix stay out of scope until the Python workflow drills are promoted.

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 0 | 0 | 0 |
| fix | 0 | 0 | 0 |
| test | 1 | 1 | 5707 |
| deploy | 0 | 0 | 0 |

### Observed Commands

- `uv run bash scripts/test.sh`
