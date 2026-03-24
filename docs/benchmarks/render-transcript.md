# Transcript Render Benchmark

- Generated: 2026-03-23T16:42:59.488Z
- Summary: Measures transcript block rebuild latency on the real CLI render path.

## Meta

| Key | Value |
| --- | --- |
| entries | 2000 |
| iterations | 30 |
| baseWidth | 96 |

## Latency (ms)

| Metric | Value |
| --- | ---: |
| min | 2.352 |
| p50 | 2.773 |
| p95 | 4.116 |
| avg | 3.036 |
| max | 7.067 |

## Output Shape

| Metric | Value |
| --- | ---: |
| lineCount | 5999 |
| codeBlockCount | 0 |
| entryTotalLines | 5999 |
| peakRssMb | 84.330 |

## Acceptance

| Check | Target | Actual | Result |
| --- | --- | --- | --- |
| Transcript rebuild p95 | < 25ms | 4.116ms | PASS |
| Peak RSS | < 350MB | 84.33MB | PASS |
