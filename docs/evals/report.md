# Evals Report

- Generated: 2026-03-24T14:59:11.412Z
- Current reports: 2
- Source directory: `docs/evals`

## Overview

| Report | Generated | Samples | Acceptance | Detail |
| --- | --- | ---: | --- | --- |
| Real Project Workflow Eval | 2026-03-24T14:59:11.401Z | 1 | 6/6 PASS | [markdown](./real-project-results.md) / [json](./real-project-results.json) |
| Workflow Fixture Eval | 2026-03-23T16:43:00.364Z | 7 | 6/6 PASS | [markdown](./workflow-fixtures.md) / [json](./workflow-fixtures.json) |

## Real Project Workflow Eval

- Slug: `real-project-results`
- Generated: 2026-03-24T14:59:11.401Z
- Samples: 1
- Summary: Aggregates workflow-history records for non-fixture projects and tracks progress toward the roadmap goal of publishing reproducible real-project build/test/fix/deploy coverage.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Captured real projects | >= 5 | 10 | n/a | PASS |
| Captured real-project workflow runs | >= 15 | 129 | n/a | PASS |
| Projects with build coverage | >= 5 | 9 | n/a | PASS |
| Projects with fix coverage | >= 5 | 9 | n/a | PASS |
| Projects with deploy coverage | >= 5 | 9 | n/a | PASS |
| Overall success rate | >= 0.6 | 0.9922 | n/a | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Overview | totalProjects | 10 |
| Overview | totalRuns | 129 |
| Overview | successfulRuns | 128 |
| Overview | failedRuns | 1 |
| Overview | overallSuccessRate | 0.992 |
| Flow Success Rate | buildSuccessRate | 1 |
| Flow Success Rate | fixSuccessRate | 1 |
| Flow Success Rate | testSuccessRate | 1 |
| Flow Success Rate | deploySuccessRate | 0.974 |
| Coverage | projectsWithBuildCoverage | 9 |
| Coverage | projectsWithFixCoverage | 9 |
| Coverage | projectsWithTestCoverage | 10 |
| Coverage | projectsWithDeployCoverage | 9 |
| Target Readiness | declaredTargets | 10 |
| Target Readiness | readyTargets | 9 |
| Target Readiness | syncNeededTargets | 0 |
| Target Readiness | blockedTargets | 1 |
| Target Readiness | disabledTargets | 0 |

### Real Project Coverage

| Project | Runs | Success Rate | Last Run |
| --- | ---: | ---: | --- |
| XQoder Protocol Package | 21 | 1 | 2026-03-23T15:44:22.191Z |
| XQoder Agent Package | 21 | 1 | 2026-03-23T15:44:21.364Z |
| XQoder Permissions Package | 20 | 1 | 2026-03-23T15:44:24.778Z |
| XQoder Plugin SDK Package | 20 | 1 | 2026-03-23T15:44:24.077Z |
| XQoder Shared Package | 20 | 1 | 2026-03-23T15:44:23.286Z |
| Directus Monorepo (Optional) | 7 | 1 | 2026-03-23T15:44:55.584Z |
| OpenClaw Monorepo (Optional) | 7 | 1 | 2026-03-23T15:44:39.048Z |
| OpenCode App Package (Optional) | 6 | 1 | 2026-03-23T15:44:54.927Z |
| OpenCode Core Package (Optional) | 6 | 0.833 | 2026-03-23T15:44:48.695Z |
| Full Stack FastAPI Template (Optional) | 1 | 1 | 2026-03-23T15:53:16.366Z |

### Failure Buckets

| Reason | Count |
| --- | ---: |
| deploy_build_failed | 1 |

## Workflow Fixture Eval

- Slug: `workflow-fixtures`
- Generated: 2026-03-23T16:43:00.364Z
- Samples: 7
- Summary: Evaluates deterministic build/fix/test/deploy workflow fixtures with focused evidence for dependency auto actions, compile-error repair, and deploy validation classification.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Overall success rate | >= 1 | 1 | 1 | PASS |
| Per-fixture minimum success rate | >= 1 | 1 | 1 | PASS |
| Dependency auto-action fixture success rate | >= 1 | 1 | 1 | PASS |
| Compile-error repair fixture success rate | >= 1 | 1 | 1 | PASS |
| Deploy validation classification rate | >= 1 | 1 | 1 | PASS |
| No unexpected fixture failures | 0 failures | 0 | 0 | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Overview | passedRuns | 48 |
| Overview | failedRuns | 0 |
| Overview | overallSuccessRate | 1 |
| Overview | minFixtureSuccessRate | 1 |
| Flow Success Rate | buildSuccessRate | 1 |
| Flow Success Rate | fixSuccessRate | 1 |
| Flow Success Rate | testSuccessRate | 1 |
| Flow Success Rate | deploySuccessRate | 1 |
| Automation Evidence | dependencyAutoActionSuccessRate | 1 |
| Automation Evidence | compileErrorRepairSuccessRate | 1 |
| Automation Evidence | deployValidationClassificationRate | 1 |
| Automation Evidence | dependencyAutoActionEvidenceRuns | 3 |
| Automation Evidence | compileErrorRepairEvidenceRuns | 3 |
| Automation Evidence | deployValidationEvidenceRuns | 3 |
| Latency (ms) | min | 0.006 |
| Latency (ms) | p50 | 0.046 |
| Latency (ms) | p95 | 0.366 |
| Latency (ms) | avg | 0.086 |
| Latency (ms) | max | 0.427 |

### Fixture Coverage

| Fixture | Flow | Success Rate | Passed | Failed | p95 (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| build_success_tests_passed | build | 1 | 3 | 0 | 0.366 |
| build_runtime_failure | build | 1 | 3 | 0 | 0.151 |
| build_test_failure | build | 1 | 3 | 0 | 0.106 |
| build_tests_skipped | build | 1 | 3 | 0 | 0.097 |
| fix_dependency_missing_auto_action | fix | 1 | 3 | 0 | 0.408 |
| fix_immediate_healthy | fix | 1 | 3 | 0 | 0.031 |
| fix_compile_error_single_repair | fix | 1 | 3 | 0 | 0.264 |
| fix_success_on_second_attempt | fix | 1 | 3 | 0 | 0.293 |
| fix_exhausted_attempts | fix | 1 | 3 | 0 | 0.124 |
| fix_repair_exception | fix | 1 | 3 | 0 | 0.427 |
| test_success | test | 1 | 3 | 0 | 0.105 |
| test_skipped | test | 1 | 3 | 0 | 0.028 |
| test_failure | test | 1 | 3 | 0 | 0.057 |
| deploy_success | deploy | 1 | 3 | 0 | 0.148 |
| deploy_validation_failure | deploy | 1 | 3 | 0 | 0.095 |
| deploy_provider_failure | deploy | 1 | 3 | 0 | 0.055 |
