# Workflow Core Benchmark

- Generated: 2026-03-23T16:43:00.089Z
- Summary: Measures orchestration overhead for the build/fix workflow engine with deterministic fake runtimes.

## Meta

| Key | Value |
| --- | --- |
| iterations | 20 |

## Build Flow Latency (ms)

| Metric | Value |
| --- | ---: |
| min | 0.006 |
| p50 | 0.014 |
| p95 | 0.398 |
| avg | 0.047 |
| max | 0.398 |

## Fix Flow Latency (ms)

| Metric | Value |
| --- | ---: |
| min | 0.009 |
| p50 | 0.028 |
| p95 | 0.502 |
| avg | 0.063 |
| max | 0.502 |

## Acceptance

| Check | Target | Actual | Result |
| --- | --- | --- | --- |
| Build flow p95 | < 25ms | 0.398ms | PASS |
| Fix flow p95 | < 25ms | 0.502ms | PASS |
