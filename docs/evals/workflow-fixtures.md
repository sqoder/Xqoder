# Workflow Fixture Eval

- Generated: 2026-03-23T16:43:00.364Z
- Summary: Evaluates deterministic build/fix/test/deploy workflow fixtures with focused evidence for dependency auto actions, compile-error repair, and deploy validation classification.

## Meta

| Key | Value |
| --- | --- |
| repeats | 3 |
| fixtures | 16 |
| totalRuns | 48 |
| strictMode | PASS |

## Overview

| Metric | Value |
| --- | ---: |
| passedRuns | 48 |
| failedRuns | 0 |
| overallSuccessRate | 1 |
| minFixtureSuccessRate | 1 |

## Flow Success Rate

| Metric | Value |
| --- | ---: |
| buildSuccessRate | 1 |
| fixSuccessRate | 1 |
| testSuccessRate | 1 |
| deploySuccessRate | 1 |

## Automation Evidence

| Metric | Value |
| --- | ---: |
| dependencyAutoActionSuccessRate | 1 |
| compileErrorRepairSuccessRate | 1 |
| deployValidationClassificationRate | 1 |
| dependencyAutoActionEvidenceRuns | 3 |
| compileErrorRepairEvidenceRuns | 3 |
| deployValidationEvidenceRuns | 3 |

## Latency (ms)

| Metric | Value |
| --- | ---: |
| min | 0.006 |
| p50 | 0.046 |
| p95 | 0.366 |
| avg | 0.086 |
| max | 0.427 |

## Fixture Results

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

## Acceptance

| Check | Target | Actual | Result |
| --- | --- | --- | --- |
| Overall success rate | >= 1 | 1 | PASS |
| Per-fixture minimum success rate | >= 1 | 1 | PASS |
| Dependency auto-action fixture success rate | >= 1 | 1 | PASS |
| Compile-error repair fixture success rate | >= 1 | 1 | PASS |
| Deploy validation classification rate | >= 1 | 1 | PASS |
| No unexpected fixture failures | 0 failures | 0 | PASS |
