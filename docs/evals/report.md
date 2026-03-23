# Evals Report

- Generated: 2026-03-23T03:00:44.113Z
- Current reports: 2
- Source directory: `docs/evals`

## Overview

| Report | Generated | Samples | Acceptance | Detail |
| --- | --- | ---: | --- | --- |
| Real Project Workflow Eval | 2026-03-23T03:00:44.108Z | 1 | 5/5 PASS | [markdown](./real-project-results.md) / [json](./real-project-results.json) |
| Workflow Fixture Eval | 2026-03-23T02:55:14.611Z | 5 | 6/6 PASS | [markdown](./workflow-fixtures.md) / [json](./workflow-fixtures.json) |

## Real Project Workflow Eval

- Slug: `real-project-results`
- Generated: 2026-03-23T03:00:44.108Z
- Samples: 1
- Summary: Aggregates workflow-history records for non-fixture projects and tracks progress toward the roadmap goal of publishing reproducible real-project build/test/fix coverage.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Captured real projects | >= 5 | 6 | n/a | PASS |
| Captured real-project workflow runs | >= 15 | 80 | n/a | PASS |
| Projects with build coverage | >= 5 | 6 | n/a | PASS |
| Projects with fix coverage | >= 5 | 6 | n/a | PASS |
| Overall success rate | >= 0.6 | 1 | n/a | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Overview | totalProjects | 6 |
| Overview | totalRuns | 80 |
| Overview | successfulRuns | 80 |
| Overview | failedRuns | 0 |
| Overview | overallSuccessRate | 1 |
| Flow Success Rate | buildSuccessRate | 1 |
| Flow Success Rate | fixSuccessRate | 1 |
| Flow Success Rate | testSuccessRate | 1 |
| Flow Success Rate | deploySuccessRate | 0 |
| Coverage | projectsWithBuildCoverage | 6 |
| Coverage | projectsWithFixCoverage | 6 |
| Coverage | projectsWithTestCoverage | 6 |
| Coverage | projectsWithDeployCoverage | 0 |

### Real Project Coverage

| Project | Runs | Success Rate | Last Run |
| --- | ---: | ---: | --- |
| XQoder Protocol Package | 16 | 1 | 2026-03-23T02:21:04.306Z |
| XQoder Agent Package | 16 | 1 | 2026-03-23T02:21:02.151Z |
| XQoder Permissions Package | 15 | 1 | 2026-03-23T02:21:09.804Z |
| XQoder Plugin SDK Package | 15 | 1 | 2026-03-23T02:21:08.840Z |
| XQoder Shared Package | 15 | 1 | 2026-03-23T02:21:06.705Z |
| OpenClaw Monorepo (Optional) | 3 | 1 | 2026-03-23T02:27:55.608Z |

## Workflow Fixture Eval

- Slug: `workflow-fixtures`
- Generated: 2026-03-23T02:55:14.611Z
- Samples: 5
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
| Latency (ms) | p50 | 0.043 |
| Latency (ms) | p95 | 0.275 |
| Latency (ms) | avg | 0.079 |
| Latency (ms) | max | 0.430 |

### Fixture Coverage

| Fixture | Flow | Success Rate | Passed | Failed | p95 (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| build_success_tests_passed | build | 1 | 3 | 0 | 0.328 |
| build_runtime_failure | build | 1 | 3 | 0 | 0.204 |
| build_test_failure | build | 1 | 3 | 0 | 0.163 |
| build_tests_skipped | build | 1 | 3 | 0 | 0.114 |
| fix_dependency_missing_auto_action | fix | 1 | 3 | 0 | 0.430 |
| fix_immediate_healthy | fix | 1 | 3 | 0 | 0.029 |
| fix_compile_error_single_repair | fix | 1 | 3 | 0 | 0.222 |
| fix_success_on_second_attempt | fix | 1 | 3 | 0 | 0.275 |
| fix_exhausted_attempts | fix | 1 | 3 | 0 | 0.128 |
| fix_repair_exception | fix | 1 | 3 | 0 | 0.102 |
| test_success | test | 1 | 3 | 0 | 0.106 |
| test_skipped | test | 1 | 3 | 0 | 0.024 |
| test_failure | test | 1 | 3 | 0 | 0.054 |
| deploy_success | deploy | 1 | 3 | 0 | 0.140 |
| deploy_validation_failure | deploy | 1 | 3 | 0 | 0.097 |
| deploy_provider_failure | deploy | 1 | 3 | 0 | 0.053 |
