# 0016 · P15a — NormalizedUsage + provider normalizers

- Status: Accepted
- Date: 2026-05-11
- Phase: P15a

## Context

Phase 15 要把成本跟踪 / cache metrics / 多 provider usage 映射 / telemetry
sink 四块对齐 OpenClaude。本期把最底层的 "usage 归一" 做掉,上层还不 wire。

## Sub-phase split

P15 完整施工单很大(5 provider normalizer + CacheStatsTracker + xqoder cost
CLI + telemetry sink + 运行时 wiring + e2e),单期做完会推主会话上下文到
极限。继承 P13/P14 子拆策略:

- **P15a(本期)**: `NormalizedUsage` 接口 + 5 provider 归一函数 + fixture 单测,**不碰 provider 运行路径**
- P15b: `CacheStatsTracker` + `TelemetrySink` 抽象 + `xqoder cost` CLI
- P15c: 把 NormalizedUsage 串进 provider-turn 热路径 + telemetry 事件发射 + e2e

## Decisions

### 1) 新建 `src/infra/llm/usage/` 模块

独立目录,避免和 `src/infra/llm/retry`、`src/infra/llm/anthropic` 等 provider
实现耦合。导出 `normalizeUsage(raw, provider, model) → NormalizedUsage`
(统一入口)加 5 个命名导出(`normalizeAnthropic` / `normalizeOpenAI` /
`normalizeCodex` / `normalizeMinimax` / `normalizeGeneric`)便于直接调用。

### 2) `NormalizedUsage` 字段形状

```ts
interface NormalizedUsage {
    provider: string;
    model: string;
    input: number;          // regular-rate 输入(不含 cache)
    output: number;         // 完成 token
    cacheRead?: number;     // 命中 cache 的 input
    cacheCreate?: number;   // 写入 cache 的 input(Anthropic 有)
    cacheDelete?: number;   // 删除 cache(Anthropic 有)
    reasoning?: number;     // reasoning/thinking token
    costUsd?: number;       // best-effort 成本
}
```

**关键:`input` 不含 cache**。因为不同 provider 报告 prompt tokens 的
约定不同(Anthropic 排除 cache,OpenAI/Codex 包含 cache),统一到
"regular-rate input"后,下游定价 / 命中率 / 遥测都能直接加减不用再
条件判断。

### 3) 各 provider 归一的细节

- **Anthropic**:纯字段名歧义消除。snake_case(`input_tokens` /
  `cache_read_input_tokens`)是 API 原样,`input_tokens` 本就排除 cache;
  camelCase(`promptTokens` / `cacheReadTokens`)是 XQoder 内部已折叠
  shape(`promptTokens = regular + cacheRead + cacheCreate`),需要反推
  regular。用 key 名消歧而不是数值启发式,更可靠。
- **OpenAI**:读 `prompt_tokens_details.cached_tokens`,从 `prompt_tokens`
  减去得到 regular。读 `completion_tokens_details.reasoning_tokens`。
- **Codex**:`/responses` shape 有 `input_tokens_details` 和
  `output_tokens_details`,逻辑同 OpenAI。
- **Minimax**:无 cache 概念;只有 `total_tokens` 时 fallback 到
  `input = total, output = 0`(保全信息不丢)。
- **Generic**:`prompt_tokens` / `promptTokens` / `input_tokens` /
  `inputTokens` 按顺序 try,缺就 0,不抛异常。

### 4) `costUsd` 最佳努力附加

`attachCost(usage)` 把 normalized 反折叠成 `calculateCost` 期望的
`{promptTokens, completionTokens, cacheReadTokens, cacheCreationTokens}`
形状(`promptTokens = input + cacheRead`),复用 P09 既有定价表。模型
未知就不写 `costUsd`。**不破坏既有 model-costs.ts**。

### 5) 兼容性:不触碰既有 provider 代码

本期只产出读函数,`src/infra/llm/anthropic/index.ts` 里的
`buildUsageFromAnthropic`、OpenAI shim 的 usage 推断逻辑都不动。P15c 会
负责替换。

## Validation

- 新测试 19 条(`test/infra/llm/usage/normalize.test.ts`):
  - Anthropic:raw / folded / 零 cache / 别名 provider 派发(4)
  - OpenAI:含 cache_read + reasoning / 无 details / generic OpenAI 兼容
    provider(3)
  - Codex:完整 shape / 空 usage(2)
  - Minimax:完整字段 / 仅 total_tokens / snake_case 变体(3)
  - Generic:camelCase 别名 / 未知 shape / 未知 provider(3)
  - Cost 附加:known model 有 cost / unknown model 无 cost / cacheRead
    走 cached 单价(3)
  - Malformed input:null / undefined / [] / string 全不抛(1)
- `bun run release:check`:**1105 pass / 0 fail**(P14c 1086 → +19),
  coverage **68.90%**(P14c 68.85%,+0.05%),e2e smoke ✅、mcp:live-smoke
  ✅、security hygiene ✅、size guardrail ✅

## 零红线触碰

本期 0 触碰硬/软红线:
- `src/application/chat/verification-gate.ts` 未动
- `src/infra/protocol/events.ts` 未动
- `src/application/chat/conversation-engine.ts` 未动
- `src/application/chat/tool-orchestrator.ts` 未动
- `src/application/chat/permission-gate.ts` 未动

## 文件清单

新增:
- `src/infra/llm/usage/normalize.ts`(~230L,5 normalizer + costUsd 附加)
- `src/infra/llm/usage/index.ts`(barrel)
- `test/infra/llm/usage/normalize.test.ts`(19 条)
- `docs/adr/0016-p15a-normalized-usage.md`(本文)

**本期 0 修改文件**(新增 only)。
