# Transcript Memory Benchmark

- Generated: 2026-03-23T16:42:58.813Z
- Summary: Measures RSS and frame latency while scrolling a large transcript on the real CLI state/render path with terminal device flush suppressed for stable CI gating.

## Meta

| Key | Value |
| --- | --- |
| transcriptEntries | 3000 |
| iterations | 180 |
| warmupIterations | 40 |
| settleMs | 25 |

## Memory (MB)

| Metric | Value |
| --- | ---: |
| baselineRssMb | 166.590 |
| peakRssMb | 166.770 |
| rssDeltaMb | 0.170 |
| peakHeapMb | 39.660 |

## Frame Latency (ms)

| Metric | Value |
| --- | ---: |
| min | 6.939 |
| p50 | 8.280 |
| p95 | 10.790 |
| avg | 8.552 |
| max | 11.347 |

## Acceptance

| Check | Target | Actual | Result |
| --- | --- | --- | --- |
| Peak RSS | < 220MB | 166.77MB | PASS |
| Frame p95 | < 16ms | 10.79ms | PASS |
