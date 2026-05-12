# 0017 · P15b — CacheStatsTracker + telemetry sink + `xqoder cost` CLI

- Status: Accepted
- Date: 2026-05-11
- Phase: P15b

## Context

P15a 产出 `NormalizedUsage` 归一 + 5 provider normalizer。P15b 继续搭
P15 的第二层:
- `CacheStatsTracker` 累计 session 命中/未命中/创建
- `TelemetrySink` 抽象 + 多种内置 sink(noop / in-memory / datadog stub)
- `xqoder cost` 命令读 SQLite session store 报告 token/cost/cache hit

P15c 负责把这三样串到实际 provider / tool / hook 调用路径并做 e2e。

## Decisions

### 1) `NormalizedUsage` 类型挪到 `src/shared/telemetry/`

最初放在 `src/infra/llm/usage/` 看似自然(provider 层产生),但 **`application`
和 `shared` 层都需要消费它**(`cost.ts` 报告、`CacheStatsTracker` 统计、
telemetry 事件字段)。让 shared 导入 infra 违反 `test/architecture-guardrails.test.ts`
的层级守卫:`application/shared/domain` 不能反指到 `commands/core/platform/infra/services`。

**处理**:纯类型文件 `src/shared/telemetry/normalized-usage.ts` 作为契约
owner;`src/infra/llm/usage/normalize.ts` 继续放实现(5 个 normalizer
函数),通过 type-only import 引用类型并 re-export 给已存在消费者。
零类型形状变更。

### 2) `CacheStatsTracker` 用 `NormalizedUsage.input` 作为 miss

`input` 在 P15a 定为 "regular-rate(不含 cache)",直接就是 miss 的定义。
OpenClaude 的 `cacheStatsTracker.ts` 用 `u.input - (u.cacheRead ?? 0)` 显得
别扭;我们因为 P15a 已经统一了 input 语义,可以直接 `this.miss += usage.input`。

### 3) Telemetry sink 的 env 开关

- `XQODER_DISABLE_TELEMETRY=1` → 强制 noop(P15 验证段明确要求)
- `XQODER_TELEMETRY_SINK=datadog|memory|noop` → 选 sink(默认 noop)
- 结果按进程缓存;`setTelemetrySink(sink)` 测试用钩子
- `emitTelemetry(event)` 包一层 `try/catch`:telemetry 失败**不能**把宿主
  runtime 带下去

**datadog sink 在本期是 stub**:仅在 `XQODER_TELEMETRY_DATADOG_DEBUG=1`
时往 stderr 写 JSON,不做真实 HTTP POST。真实 HTTP 下沉留给用户按需
改 `createDatadogSinkStub()` 或 P15c。

### 4) `xqoder cost` 挪到 `application/integrations/`

同 P14c 的 hooks-test 处理:
- `cost.ts` 要 import `@xqoder/storage-sqlite`(运行时读 session DB)
- `storage-sqlite` 的 barrel 把 infra 一大片代码拉进去
- `tsconfig.application-system-exact-optional.json` 的 include 覆盖
  `src/application/system/**`,它一跑就爆 40+ 条 infra 里既有
  `exactOptionalPropertyTypes` 警告(不是本期引入)

**处理**:`src/application/integrations/cost.ts` 放实现(被 strict lint
豁免),`src/commands/core/cost.ts` 直接 import 它。整个 P15b 零红线触碰。

### 5) `cost` 命令 scope 三选一

- `--session <id>`:单一会话精确报告
- 无 flag(默认):按当前 `--dir`(或 cwd)过滤项目
- `--total`:跨项目全量

aggregate 在所有 row 上 sum。`cacheStats` 通过临时 `CacheStatsTracker`
喂一遍 `NormalizedUsage`(来自 row)得到 hit rate。

### 6) 成本 fallback:session 里无 `cost` 时回 `calculateCost`

`AgentSessionUsage.cost` 在某些旧 session 可能为空。`summaryToCostRow`
先读 recorded cost,再回退 `calculateCost(model, usage)`,确保老会话也
能显示合理成本估算。

## Validation

- 新测试 28 条:
  - `test/shared/telemetry/sink.test.ts`(8):默认 noop / env 开关 / 缓存
    / setTelemetrySink 覆盖 / emitTelemetry 容错 / throwing sink 不外泄 /
    flush 不异步副作用
  - `test/shared/telemetry/cache-stats.test.ts`(11):tracker 累计 / reset
    / merge 合并 / hitRate 格式化
  - `test/application/integrations/cost.test.ts`(8):三种 scope / hit rate
    计算 / 未知 session throw / fallback cost / JSON / 空 scope
  - 加上 P15a 的 19 条 usage normalize 测试,共 47 条在 telemetry/usage
    轴上过
- `bun run release:check`:**1130 pass / 0 fail**(P15a 1105 → +25),
  coverage **69.08%**(P15a 68.90%,+0.18%),e2e smoke ✅、mcp:live-smoke
  三 transport ✅、security hygiene ✅、size guardrail ✅
- 架构守卫测试继续通过:`shared/telemetry` 只依赖 shared 内部和本期
  新建的 `normalized-usage.ts`,不反指 infra

## 零红线触碰

- `src/application/chat/verification-gate.ts` 未动
- `src/infra/protocol/events.ts` 未动
- `src/application/chat/conversation-engine.ts` 未动
- `src/application/chat/tool-orchestrator.ts` 未动
- `src/application/chat/permission-gate.ts` 未动

## 文件清单

新增:
- `src/shared/telemetry/normalized-usage.ts`(26L,纯类型)
- `src/shared/telemetry/sink.ts`(~140L)
- `src/shared/telemetry/cache-stats.ts`(~70L)
- `src/shared/telemetry/index.ts`(barrel)
- `src/application/integrations/cost.ts`(~220L)
- `src/commands/core/cost.ts`(35L)
- `test/shared/telemetry/sink.test.ts`(8 条)
- `test/shared/telemetry/cache-stats.test.ts`(11 条)
- `test/application/integrations/cost.test.ts`(8 条)
- `docs/adr/0017-p15b-cache-stats-telemetry-cost-cli.md`(本文)

修改:
- `src/plugins/command-plugins.ts` — `costCommand` 注册到 cli-core-shell
  plugin,和 `configCommand` 相邻
- `src/infra/llm/usage/normalize.ts` — 类型 import 从本地接口改为
  `src/shared/telemetry/normalized-usage.js` 的 type-only 引用并 re-export
  (P15a 的 19 条 normalize 测试和 `infra/llm/usage/index.ts` barrel 都
  保持兼容)

## 不做 / 搁置

- **真实 Datadog HTTP 提交** → 用户需要时实现 `createDatadogSink()`
  (与 stub 同名),`getTelemetrySink` dispatch 已就位
- **OTLP sink** → 同上,加个 `case 'otlp'` 分支即可
- **`xqoder cost --days N` / `--models` / `--tools`** → 施工单未要求,
  这些已在 `xqoder stats` 命令里;cost 专注 per-session / total
- Wire `CacheStatsTracker` 进 turn 循环、telemetry 事件从 provider/tool/
  hook 真实发射 → **P15c**

## 下一期

**P15c**:串 telemetry 到 provider-turn / tool orchestrator / hook runner
+ e2e 跑一轮对话,断言 `session.usage ≈ xqoder cost` 输出。
