# Benchmarks Report

- Generated: 2026-03-23T03:00:44.112Z
- Current reports: 4
- Source directory: `docs/benchmarks`

## Overview

| Report | Generated | Samples | Acceptance | Detail |
| --- | --- | ---: | --- | --- |
| Daemon/Client Startup Benchmark | 2026-03-23T02:55:10.222Z | 5 | 2/2 PASS | [markdown](./daemon-startup.md) / [json](./daemon-startup.json) |
| Transcript Memory Benchmark | 2026-03-23T02:55:13.173Z | 2 | 2/2 PASS | [markdown](./memory-transcript.md) / [json](./memory-transcript.json) |
| Transcript Render Benchmark | 2026-03-23T02:55:13.812Z | 2 | 2/2 PASS | [markdown](./render-transcript.md) / [json](./render-transcript.json) |
| Workflow Core Benchmark | 2026-03-23T02:55:14.376Z | 3 | 2/2 PASS | [markdown](./workflow-core.md) / [json](./workflow-core.json) |

## Daemon/Client Startup Benchmark

- Slug: `daemon-startup`
- Generated: 2026-03-23T02:55:10.222Z
- Samples: 5
- Summary: Rust client cold/warm startup and daemon warm attach latency.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Client warm startup p95 | < 10ms | 1.772ms | 2.802ms | PASS |
| Daemon warm attach p95 | < 10ms | 0.67ms | 0.84ms | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Rust Client Startup (ms) | cold | 2.379 |
| Rust Client Startup (ms) | warmMin | 1.394 |
| Rust Client Startup (ms) | warmP50 | 1.543 |
| Rust Client Startup (ms) | warmP95 | 1.772 |
| Rust Client Startup (ms) | warmAvg | 1.553 |
| Rust Client Startup (ms) | warmMax | 2.081 |
| Daemon Warm Attach (ms) | min | 0.032 |
| Daemon Warm Attach (ms) | p50 | 0.061 |
| Daemon Warm Attach (ms) | p95 | 0.670 |
| Daemon Warm Attach (ms) | avg | 0.167 |
| Daemon Warm Attach (ms) | max | 1.462 |

## Transcript Memory Benchmark

- Slug: `memory-transcript`
- Generated: 2026-03-23T02:55:13.173Z
- Samples: 2
- Summary: Measures RSS and frame latency while scrolling a large transcript on the real CLI state/render path with terminal device flush suppressed for stable CI gating.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Peak RSS | < 220MB | 167.14MB | 167.08MB | PASS |
| Frame p95 | < 16ms | 11.565ms | 12.522ms | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Memory (MB) | baselineRssMb | 166.980 |
| Memory (MB) | peakRssMb | 167.140 |
| Memory (MB) | rssDeltaMb | 0.160 |
| Memory (MB) | peakHeapMb | 39.630 |
| Frame Latency (ms) | min | 7.833 |
| Frame Latency (ms) | p50 | 8.841 |
| Frame Latency (ms) | p95 | 11.565 |
| Frame Latency (ms) | avg | 9.405 |
| Frame Latency (ms) | max | 12.042 |

## Transcript Render Benchmark

- Slug: `render-transcript`
- Generated: 2026-03-23T02:55:13.812Z
- Samples: 2
- Summary: Measures transcript block rebuild latency on the real CLI render path.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Transcript rebuild p95 | < 25ms | 3.814ms | 3.867ms | PASS |
| Peak RSS | < 350MB | 83.59MB | 84.14MB | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Latency (ms) | min | 2.248 |
| Latency (ms) | p50 | 2.610 |
| Latency (ms) | p95 | 3.814 |
| Latency (ms) | avg | 2.885 |
| Latency (ms) | max | 6.700 |
| Output Shape | lineCount | 5999 |
| Output Shape | codeBlockCount | 0 |
| Output Shape | entryTotalLines | 5999 |
| Output Shape | peakRssMb | 83.590 |

## Workflow Core Benchmark

- Slug: `workflow-core`
- Generated: 2026-03-23T02:55:14.376Z
- Samples: 3
- Summary: Measures orchestration overhead for the build/fix workflow engine with deterministic fake runtimes.

### Acceptance

| Check | Target | Actual | Previous | Result |
| --- | --- | --- | --- | --- |
| Build flow p95 | < 25ms | 0.355ms | 0.318ms | PASS |
| Fix flow p95 | < 25ms | 0.448ms | 0.463ms | PASS |

### Key Metrics

| Section | Metric | Value |
| --- | --- | ---: |
| Build Flow Latency (ms) | min | 0.006 |
| Build Flow Latency (ms) | p50 | 0.013 |
| Build Flow Latency (ms) | p95 | 0.355 |
| Build Flow Latency (ms) | avg | 0.044 |
| Build Flow Latency (ms) | max | 0.355 |
| Fix Flow Latency (ms) | min | 0.009 |
| Fix Flow Latency (ms) | p50 | 0.029 |
| Fix Flow Latency (ms) | p95 | 0.448 |
| Fix Flow Latency (ms) | avg | 0.058 |
| Fix Flow Latency (ms) | max | 0.448 |
