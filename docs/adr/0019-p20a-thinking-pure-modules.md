# 0019 · P20a — thinking/effort/fast-mode/token-extractor pure modules

- Status: Accepted
- Date: 2026-05-11
- Phase: P20a

## Context

Phase 20 要把三个推理维度暴露出来:
- `/think /nothink` → Anthropic `thinking`
- `/effort low|medium|high|xhigh` → OpenAI/Codex `reasoning_effort`
- `/fast` → Anthropic `speed: fast` beta

施工单包含:pure module + provider wiring + CLI + session 持久化 +
`withRetry` 的 fast cooldown trigger。一次吞不下,继续子拆:

- **P20a(本期)**:四个 pure module + 单测,**不触碰 provider 和 CLI**
- P20b:wire 到 provider-turn / Anthropic / OpenAI shim、CLI、session、withRetry

## Decisions

### 1) 模块布局:放在 `src/shared/thinking/`

P20 的 pure 逻辑不依赖任何 provider / session 实现,属于 contract + 纯函数。
放 shared:
- application 层(resolveThinking in conversation-engine)直接用
- infra 层(Anthropic params mapping)直接用
- commands 层(parseEffort)直接用
- 避免 P15b 的架构守卫陷阱(shared → infra 禁行)

### 2) `ThinkingConfig` 统一三维度

```ts
interface ThinkingConfig {
    mode: 'disabled' | 'adaptive' | 'enabled';
    budgetTokens?: number;
    effort?: 'low' | 'medium' | 'high' | 'xhigh';
    fastMode?: 'standard' | 'fast';
}
```

单 struct 承载三维度,避免 `xqoder think on --effort high --fast` 这种
多 flag 叠加时还要查多处。

### 3) `resolveThinking(model, userOverride)` 的三层合并

`DEFAULT_THINKING_CONFIG < 模型默认 < 用户覆盖`。模型默认来自
`shouldEnableThinkingByDefault`:
- `o1 / o3 / o4-mini / gpt-5.1 / gpt-5-codex` → `enabled, effort=medium`
- `claude-sonnet-4 / claude-opus-4` → `adaptive, effort=medium`
- `deepseek-reasoner / deepseek-r1` → `enabled`
- `qwen3 / qwq` → `adaptive`

当 `mode !== 'disabled'` 且 `budgetTokens` 缺省,从 `effort` 派生。
显式 `budgetTokens` 优先。

### 4) Effort mapping

```
low → 2000  medium → 8000  high → 16000  xhigh → 32000  undef → 8000
```

施工单的 `mapEffort(effort)` 没给具体数字,我按 OpenClaude + Anthropic
实际接受范围选了这组(32k 是 Claude 4.x 的 thinking budget 上限,不冒险)。

### 5) `parseEffort` 宽容别名

CLI 和 slash commands 用户可能打 "mid" / "max" / "extreme" /
"extra-high" / "extra_high" / "minimal"。全部归一到 canonical union,
不抛错;未知值返回 undefined,由调用者决定是否 throw。`assertEffort`
在 CLI 的 requiredOption 回调里抛友好信息。

### 6) Fast mode cooldown 放 module-scope

单例状态,跨调用累加:
- `triggerFastModeCooldown(ms=120_000)` 设 `fastCooldownUntil`
- `isFastModeCoolingDown(now)` 查
- `getFastCooldownRemainingMs(now)` 查剩余
- 多次 trigger 取 `max` —— 短 cooldown 不会缩短已在进行的长 cooldown

测试钩子 `__resetFastModeCooldownForTests` 必须命名带 `__`,避免被当成
生产入口使用。

### 7) Token extractor vs ThinkTagFilter 的分工

已有 `src/infra/llm/openai/shim/think-tag-filter.ts`(流式剥除 + 可选
thinking 回调)。本期加 `extractThinking(rawContent)` **针对非流式消费者**
(比如 post-hoc 分析、`xqoder thinkback` 命令 v2):
- 入:完整字符串
- 出:`{ visible, thinking }`

两者协议对齐:同一组 5 个标签(think/thinking/scratchpad/reasoning/
thought),case-insensitive,允许 `< think >` 这种带空白的变体。

## Validation

- 新测试 **38 条**(4 文件):
  - `thinking-config.test.ts`(16):budget map / 各 model family default /
    resolveThinking 三层合并 / disabled 时不派生 budget / isThinkingEnabled
  - `effort.test.ts`(9):canonical / 别名 / undefined / assertEffort 抛
    错 / formatEffort
  - `fast-mode.test.ts`(9):初始态 / 默认 2min / 自定义 ms / 长短叠加
    取 max / 自定义 now 跨门
  - `token-extractor.test.ts`(10):多 block / 大小写 / 带空白标签 /
    孤立 close 保留 / 未闭合 open 吞剩余 / 不含标签原样
- `bun run release:check`:1172 pass / 0 fail(1134 → +38),coverage
  **69.26%**(+0.05%),所有 lint + e2e ✅

## 零红线触碰

- provider-turn / conversation-engine / verification-gate / events.ts
  全部未动
- 新增 only,0 修改文件

## 文件清单

新增:
- `src/shared/thinking/thinking-config.ts`(~110L)
- `src/shared/thinking/effort.ts`(~40L)
- `src/shared/thinking/fast-mode.ts`(~50L)
- `src/shared/thinking/token-extractor.ts`(~70L)
- `src/shared/thinking/index.ts`(barrel)
- `test/shared/thinking/thinking-config.test.ts`(16 条)
- `test/shared/thinking/effort.test.ts`(9 条)
- `test/shared/thinking/fast-mode.test.ts`(9 条)
- `test/shared/thinking/token-extractor.test.ts`(10 条)
- `docs/adr/0019-p20a-thinking-pure-modules.md`(本文)

## 下一期

P20b:
- Wire 到 `src/infra/llm/anthropic/index.ts` 的 `thinking` + `speed` 字段
- Wire 到 `src/infra/llm/openai/shim/provider.ts` 的 `reasoning_effort`
- Wire 到 `src/infra/llm/openai/shim/codex-shim.ts` 的 `reasoning.effort`
- Session metadata 持久化 `ThinkingConfig`
- CLI 新增 `xqoder think|effort|fast`(+ REPL slash 变体由 P11 消化)
- `withRetry` 捕 `fast mode rejected` → `triggerFastModeCooldown`
- e2e:开 thinking 后的请求断言 provider params 含 thinking
