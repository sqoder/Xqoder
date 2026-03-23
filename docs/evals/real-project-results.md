# Real Project Workflow Eval

- Generated: 2026-03-23T03:00:44.108Z
- Summary: Aggregates workflow-history records for non-fixture projects and tracks progress toward the roadmap goal of publishing reproducible real-project build/test/fix coverage.
- Selection mode: targets
- Workflow history: /Users/wangxinglin/.xqoder/data/workflow-history.jsonl
- Real projects: 6
- Real-project runs: 80
- Targets file: /Users/wangxinglin/Desktop/code/Xqoder/docs/evals/real-project-targets.json

## Roadmap Targets

- Projects: 5
- Runs: 15
- Projects with build coverage: 5
- Projects with fix coverage: 5

## Evaluation Protocol

- `build` coverage comes from a deterministic build drill: the runner executes the official `runBuildCommand` flow with an injected no-op generator, then validates the target with its real test suite.
- `test` coverage comes from `xqoder test --dir <projectRoot>` runs against each declared target.
- `fix` coverage comes from a deterministic fix drill: the runner writes a temporary `.xqoder/real-project-fix-drill.json` marker, executes the official `runFixCommand` flow with injected repair logic, and validates the result with the target project's real test suite.

## Acceptance

| Check | Target | Actual | Result |
| --- | --- | --- | --- |
| Captured real projects | >= 5 | 6 | PASS |
| Captured real-project workflow runs | >= 15 | 80 | PASS |
| Projects with build coverage | >= 5 | 6 | PASS |
| Projects with fix coverage | >= 5 | 6 | PASS |
| Overall success rate | >= 0.6 | 1 | PASS |

## Overview

| Metric | Value |
| --- | ---: |
| Overview / totalProjects | 6 |
| Overview / totalRuns | 80 |
| Overview / successfulRuns | 80 |
| Overview / failedRuns | 0 |
| Overview / overallSuccessRate | 1 |
| Flow Success Rate / buildSuccessRate | 1 |
| Flow Success Rate / fixSuccessRate | 1 |
| Flow Success Rate / testSuccessRate | 1 |
| Flow Success Rate / deploySuccessRate | 0 |
| Coverage / projectsWithBuildCoverage | 6 |
| Coverage / projectsWithFixCoverage | 6 |
| Coverage / projectsWithTestCoverage | 6 |
| Coverage / projectsWithDeployCoverage | 0 |

## Project Coverage

| Project | Runs | Success Rate | Build | Fix | Test | Deploy | Last Run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| XQoder Protocol Package | 16 | 1 | 3 | 3 | 10 | 0 | 2026-03-23T02:21:04.306Z |
| XQoder Agent Package | 16 | 1 | 2 | 4 | 10 | 0 | 2026-03-23T02:21:02.151Z |
| XQoder Permissions Package | 15 | 1 | 2 | 3 | 10 | 0 | 2026-03-23T02:21:09.804Z |
| XQoder Plugin SDK Package | 15 | 1 | 2 | 3 | 10 | 0 | 2026-03-23T02:21:08.840Z |
| XQoder Shared Package | 15 | 1 | 2 | 3 | 10 | 0 | 2026-03-23T02:21:06.705Z |
| OpenClaw Monorepo (Optional) | 3 | 1 | 1 | 1 | 1 | 0 | 2026-03-23T02:27:55.608Z |

## XQoder Protocol Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/protocol
- Runs: 16
- Success rate: 1
- First run: 2026-03-23T01:55:16.407Z
- Last run: 2026-03-23T02:21:04.306Z
- Notes: Small protocol package with deterministic build/test/fix drill coverage.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 3 | 1 | 523.7 |
| fix | 3 | 1 | 1 |
| test | 10 | 1 | 529 |
| deploy | 0 | 0 | 0 |

### Observed Commands

- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## XQoder Agent Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/agent
- Runs: 16
- Success rate: 1
- First run: 2026-03-23T01:55:15.466Z
- Last run: 2026-03-23T02:21:02.151Z
- Notes: Stable workspace package used as a deterministic real-project build/test/fix drill target.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 2 | 1 | 2369.5 |
| fix | 4 | 1 | 1.5 |
| test | 10 | 1 | 2294.2 |
| deploy | 0 | 0 | 0 |

### Observed Commands

- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## XQoder Permissions Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/permissions
- Runs: 15
- Success rate: 1
- First run: 2026-03-23T01:55:19.009Z
- Last run: 2026-03-23T02:21:09.804Z
- Notes: Minimal package used to seed baseline real-project build/test/fix drill workflow history.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 2 | 1 | 130.5 |
| fix | 3 | 1 | 1 |
| test | 10 | 1 | 133.4 |
| deploy | 0 | 0 | 0 |

### Observed Commands

- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## XQoder Plugin SDK Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/plugin-sdk
- Runs: 15
- Success rate: 1
- First run: 2026-03-23T01:55:18.484Z
- Last run: 2026-03-23T02:21:08.840Z
- Notes: Plugin SDK package with a focused Vitest suite and deterministic build/test/fix drill coverage.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 2 | 1 | 520 |
| fix | 3 | 1 | 1 |
| test | 10 | 1 | 531.4 |
| deploy | 0 | 0 | 0 |

### Observed Commands

- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## XQoder Shared Package

- Root: /Users/wangxinglin/Desktop/code/Xqoder/packages/shared
- Runs: 15
- Success rate: 1
- First run: 2026-03-23T01:55:17.557Z
- Last run: 2026-03-23T02:21:06.705Z
- Notes: Shared utilities package used for repeatable local build/test/fix drill evaluation.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 2 | 1 | 624 |
| fix | 3 | 1 | 1 |
| test | 10 | 1 | 648.3 |
| deploy | 0 | 0 | 0 |

### Observed Commands

- `npm run test`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`

## OpenClaw Monorepo (Optional)

- Root: /Users/wangxinglin/Desktop/code/openclaw
- Runs: 3
- Success rate: 1
- First run: 2026-03-23T02:27:53.368Z
- Last run: 2026-03-23T02:27:55.608Z
- Repo: https://github.com/openclaw/openclaw
- Notes: Optional external OSS target. Enable manually after validating local dependency install.
- Models: deterministic-build-drill, deterministic-fix-drill
- Agents: eval-drill

### Flow Breakdown

| Flow | Runs | Success Rate | Avg Duration (ms) |
| --- | ---: | ---: | ---: |
| build | 1 | 1 | 794 |
| fix | 1 | 1 | 1 |
| test | 1 | 1 | 2195 |
| deploy | 0 | 0 | 0 |

### Observed Commands

- `pnpm vitest run --config vitest.unit.config.ts src/logger.test.ts`
- `xqoder eval:real-projects --scenario build-drill --phase verify`
- `xqoder eval:real-projects --scenario fix-drill --phase verify`
