# Benchmarks Report

- Generated: 2026-03-24T14:59:11.411Z
- Current reports: 4
- Source directory: `docs/benchmarks`

## Overview

| Report | Generated | Samples | Acceptance | Detail |
| --- | --- | ---: | --- | --- |
| Daemon/Client Startup Benchmark | 2026-03-23T16:42:55.976Z | 9 | 2/2 PASS | [markdown](./daemon-startup.md) / [json](./daemon-startup.json) |
| Transcript Memory Benchmark | 2026-03-23T16:42:58.813Z | 4 | 2/2 PASS | [markdown](./memory-transcript.md) / [json](./memory-transcript.json) |
| Transcript Render Benchmark | 2026-03-23T16:42:59.488Z | 4 | 2/2 PASS | [markdown](./render-transcript.md) / [json](./render-transcript.json) |
| Workflow Core Benchmark | 2026-03-23T16:43:00.089Z | 5 | 2/2 PASS | [markdown](./workflow-core.md) / [json](./workflow-core.json) |

## Daemon/Client Startup Benchmark

- Slug: `daemon-startup`
- Generated: 2026-03-23T16:42:55.976Z
- Samples: 9
- Summary: Rust client cold/warm startup and daemon warm attach latency.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Client warm startup p95 | < 10ms | 2.091ms | 2.289ms | PASS |
| Daemon warm attach p95 | < 10ms | 0.647ms | 0.678ms | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Rust Client Startup (ms) | cold | 2.615 |
| Rust Client Startup (ms) | warmMin | 1.474 |
| Rust Client Startup (ms) | warmP50 | 1.646 |
| Rust Client Startup (ms) | warmP95 | 2.091 |
| Rust Client Startup (ms) | warmAvg | 1.699 |
| Rust Client Startup (ms) | warmMax | 2.326 |
| Daemon Warm Attach (ms) | min | 0.031 |
| Daemon Warm Attach (ms) | p50 | 0.049 |
| Daemon Warm Attach (ms) | p95 | 0.647 |
| Daemon Warm Attach (ms) | avg | 0.158 |
| Daemon Warm Attach (ms) | max | 1.016 |

## Transcript Memory Benchmark

- Slug: `memory-transcript`
- Generated: 2026-03-23T16:42:58.813Z
- Samples: 4
- Summary: Measures RSS and frame latency while scrolling a large transcript on the real CLI state/render path with terminal device flush suppressed for stable CI gating.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Peak RSS | < 220MB | 166.77MB | 167.17MB | PASS |
| Frame p95 | < 16ms | 10.79ms | 12.022ms | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Memory (MB) | baselineRssMb | 166.590 |
| Memory (MB) | peakRssMb | 166.770 |
| Memory (MB) | rssDeltaMb | 0.170 |
| Memory (MB) | peakHeapMb | 39.660 |
| Frame Latency (ms) | min | 6.939 |
| Frame Latency (ms) | p50 | 8.280 |
| Frame Latency (ms) | p95 | 10.790 |
| Frame Latency (ms) | avg | 8.552 |
| Frame Latency (ms) | max | 11.347 |

## Transcript Render Benchmark

- Slug: `render-transcript`
- Generated: 2026-03-23T16:42:59.488Z
- Samples: 4
- Summary: Measures transcript block rebuild latency on the real CLI render path.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Transcript rebuild p95 | < 25ms | 4.116ms | 4.007ms | PASS |
| Peak RSS | < 350MB | 84.33MB | 83.92MB | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Latency (ms) | min | 2.352 |
| Latency (ms) | p50 | 2.773 |
| Latency (ms) | p95 | 4.116 |
| Latency (ms) | avg | 3.036 |
| Latency (ms) | max | 7.067 |
| Output Shape | lineCount | 5999 |
| Output Shape | codeBlockCount | 0 |
| Output Shape | entryTotalLines | 5999 |
| Output Shape | peakRssMb | 84.330 |

## Workflow Core Benchmark

- Slug: `workflow-core`
- Generated: 2026-03-23T16:43:00.089Z
- Samples: 5
- Summary: Measures orchestration overhead for the build/fix workflow engine with deterministic fake runtimes.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Build flow p95 | < 25ms | 0.398ms | 0.32ms | PASS |
| Fix flow p95 | < 25ms | 0.502ms | 0.491ms | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Build Flow Latency (ms) | min | 0.006 |
| Build Flow Latency (ms) | p50 | 0.014 |
| Build Flow Latency (ms) | p95 | 0.398 |
| Build Flow Latency (ms) | avg | 0.047 |
| Build Flow Latency (ms) | max | 0.398 |
| Fix Flow Latency (ms) | min | 0.009 |
| Fix Flow Latency (ms) | p50 | 0.028 |
| Fix Flow Latency (ms) | p95 | 0.502 |
| Fix Flow Latency (ms) | avg | 0.063 |
| Fix Flow Latency (ms) | max | 0.502 |
