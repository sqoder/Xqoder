# Daemon/Client Startup Benchmark

- Generated: 2026-03-23T16:42:55.976Z
- Summary: Rust client cold/warm startup and daemon warm attach latency.

## Meta

| Key | Value |
| --- | --- |
| clientBinary | /Users/wangxinglin/Desktop/code/Xqoder/packages/client/target/release/xqoder |
| daemonEntry | /Users/wangxinglin/Desktop/code/Xqoder/packages/daemon/dist/server.js |
| strictMode | PASS |

## Rust Client Startup (ms)

| Metric | Value |
| --- | ---: |
| cold | 2.615 |
| warmMin | 1.474 |
| warmP50 | 1.646 |
| warmP95 | 2.091 |
| warmAvg | 1.699 |
| warmMax | 2.326 |

## Daemon Warm Attach (ms)

| Metric | Value |
| --- | ---: |
| min | 0.031 |
| p50 | 0.049 |
| p95 | 0.647 |
| avg | 0.158 |
| max | 1.016 |

## Acceptance

| Check | Target | Actual | Result |
| --- | --- | --- | --- |
| Client warm startup p95 | < 10ms | 2.091ms | PASS |
| Daemon warm attach p95 | < 10ms | 0.647ms | PASS |
