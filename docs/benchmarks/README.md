# Benchmarks

XQoder 的 benchmark 产物统一写到这个目录，并且每一项同时输出：

- `*.json`
- `*.md`
- `history/*.jsonl`（按 `generatedAt` 追加的趋势快照）
- `report.md`（自动聚合的公开总览页）

当前约定的四类指标：

1. `daemon-startup`
2. `render-transcript`
3. `memory-transcript`
4. `workflow-core`

## 运行命令

```bash
pnpm benchmark:startup
pnpm benchmark:render
pnpm benchmark:memory
pnpm benchmark:workflow
pnpm benchmark:all
pnpm benchmark:pr-summary
pnpm docs:quality:reports
```

## 入口页

- 汇总入口：[`docs/quality-report.md`](/Users/wangxinglin/Desktop/code/Xqoder/docs/quality-report.md)
- Benchmark 总览：[`docs/benchmarks/report.md`](/Users/wangxinglin/Desktop/code/Xqoder/docs/benchmarks/report.md)

## 目标

这套目录不是展示用文档，而是后续用于：

- release gate
- 回归对比
- HTML 对比页数据源
- “是否真的超越 OpenCode” 的证据积累

## 当前产物约定

每个 benchmark JSON 至少包含：

- `title`
- `generatedAt`
- `summary`
- `meta`
- `sections`
- `acceptance`

其中：

- `sections` 负责记录机器可读指标
- `acceptance` 负责记录当前门槛和 PASS/FAIL

## 趋势与 PR 摘要

- 每次 benchmark 写入 `docs/benchmarks/history/<slug>.jsonl`
- 可用 `pnpm benchmark:pr-summary` 生成当前仓库的 PR 可读摘要
- 若存在本地 workflow history，摘要会额外附带 workflow success rate、failure buckets 和 7d/30d trend
