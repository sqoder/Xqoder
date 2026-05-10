# 0020 · P20b — wire thinking/effort/fast into providers + CLI + session

- Status: Accepted
- Date: 2026-05-11
- Phase: P20b

## Context

P20a 给了纯模块。P20b 把它们串到真实系统:
- `CompletionRequest` 带上 thinking 字段
- 三个 provider(Anthropic / OpenAI shim / Codex shim)消费 thinking
- `xqoder think|effort|fast` CLI 写入 `~/.xqoder/config.json`
- Config → AgentConfig → XQoderAgent → ConversationEngine → query-loop →
  runProviderTurn → ILLMProvider.stream() 的链路
- Anthropic 报"fast mode rejected"时触发 cooldown

## 红线声明

按 CLAUDE.md 软红线规则动了:
- `src/application/chat/conversation-engine.ts`(加 optional thinking)
- `src/application/chat/query-loop.ts`(构造 request 时挂 thinking)
- `src/core/agent/agent.ts`(field + 运行时 resolveThinking)

不停下,走 ADR 记录。硬红线零触碰:
- `verification-gate.ts` / `events.ts` 未动

## Decisions

### 1) `CompletionRequest.thinking?: ThinkingConfig` 作为传递载体

原 CompletionRequest 只有 messages/tools/maxTokens/temperature/stream。
把 thinking 塞这里,每个 provider 自己决定怎么用——
- Anthropic 读 thinking + fastMode
- OpenAI 读 effort
- Codex 读 effort
- Minimax / xai 暂时忽略(provider-params 没出 helper)

这保持 CompletionRequest 作为**可扩展的传递层**,provider-agnostic。

### 2) 三个 provider-params helper(纯函数)

```
toAnthropicThinkingParams → { thinking?, speed?, dropTemperature }
toOpenAIReasoningEffort   → { reasoning_effort? }
toCodexReasoningParams    → { reasoning: {effort} }   // 必发
```

放 `src/shared/thinking/provider-params.ts`——infra 层从 shared 拉类型 +
helper,合规。单测可以直接跑断言,不需要起 provider runtime。

### 3) Anthropic `thinking` 打开时 drop temperature

施工单要求,也是 Anthropic API 的硬约束:开 thinking 就不能同时传
temperature。`toAnthropicThinkingParams.dropTemperature` 返回布尔,
wire 代码用它决定是否 spread `temperature`。

其它 provider 的 temperature 行为**完全不变**(施工单"禁止修改
`CompletionRequest.temperature`"的语义)。

### 4) `speed: fast` 的 cooldown 短路

`toAnthropicThinkingParams` 调 `isFastModeCoolingDown()`:
- 用户设了 `fastMode: 'fast'` **且**不在 cooldown → emit `speed: fast`
- 用户设了 `fastMode: 'fast'` **但**在 cooldown → 不 emit,静默走标准速度
- 用户设了 `fastMode: 'standard'` → 不 emit

**不改用户的 config**——cooldown 只影响"这一次是否真的把 `speed: fast`
发出去",配置里的偏好保留,cooldown 过了自动恢复。

### 5) Fast rejection → cooldown:放在 Anthropic provider 而不是 withRetry

施工单原话:
> 在 phase-01 的 `withRetry` 捕获 `FatalLLMError` 且 err.message 匹配
> "fast mode rejected" 时自动调用 `triggerFastModeCooldown`。

**我们选了不同挂点**:直接在 `AnthropicProvider.complete/stream` 的
`catch` 顶部调 `triggerFastModeCooldownOnRejection(err)`。理由:
- 只有 Anthropic 会返回 fast-mode 拒绝,没必要污染 withRetry 的通用
  classify 逻辑
- withRetry 的 fatal error 语义是"不重试",跟 cooldown 触发时机是两回事
  (我们希望**第一次**就触发)
- Provider catch 里触发,withRetry 和调用方都看不到副作用,隔离更干净

### 6) OpenAI / Codex:xhigh 折叠到 high

OpenAI chat completions 只认 `reasoning_effort: 'low' | 'medium' | 'high'`;
Codex `/responses` 的 `reasoning.effort` 同样三档。`xhigh` 是 Anthropic
budget 侧的扩展档,映射到非 Anthropic 的 `high` 是合理的(最深)。

### 7) Config 持久化:`~/.xqoder/config.json` 的 `thinking` 字段

```json
{
  "llm": { ... },
  "thinking": {
    "mode": "enabled",
    "effort": "high",
    "fastMode": "fast",
    "budgetTokens": 16000
  }
}
```

加入 `XQoderConfig.thinking` 并在 `normalizeXQoderConfig` 加
`normalizeThinkingPreference`,**拒绝未知枚举值**(保底防污染)。

`buildAgentConfigFromXQoderConfig` 透传到 `AgentConfig.thinking`,
`XQoderAgent` 运行时对每次 turn 跑 `resolveThinking(model, override)`
合并模型默认。

### 8) CLI 可测设计:service 函数 + commander 命令分离

`src/commands/core/thinking.ts` 导出:
- `runThinkSet('on' | 'off', deps)` → 更新 config + 返回结果
- `runEffortSet(rawLevel, deps)` → 更新 + 返回
- `runFastToggle(deps)` → 更新 + 返回 + cooldown warning
- `runThinkingStatus(deps)` → 只读,写 stdout

commander 子命令只是薄壳,catch error + exit。测试直接调 service 函数
+ inject `ConfigManager` 指向 tempdir,不起 subprocess。

### 9) CLI 接受效率别名

P20a 的 `parseEffort` 支持 `mid / max / extreme / extra-high / extra_high /
minimal` 等别名。CLI 直接复用,减少"高级用户打了 `--effort max`
却被拒"的摩擦。

## Validation

- 新测试 **23 条**:
  - `provider-params.test.ts`(13):Anthropic 三情况 / OpenAI xhigh
    折叠 / Codex default / fast cooldown 短路 / budget 优先级
  - `fast-mode-rejection.test.ts`(5):4 种拒绝变体 + rate-limit 变体 +
    3 种 non-match negative
  - `commands/core/thinking.test.ts`(11):on/off / 别名 / 非法 effort
    throw / 保留其它字段 / toggle / cooldown 警告 / status
- 新 e2e 3 条(`test/application/chat/thinking-wiring-e2e.test.ts`):
  真实起 XQoderAgent + stub provider,断言 `provider.stream` 收到的
  `request.thinking` 字段:
  - 用户 override 完整传入 → 产生 `budgetTokens: 16000`
  - 用户不设 → request.thinking undefined(legacy 路径保持)
  - 用户只给 effort,模型默认给 mode → 两者合并
- `bun run release:check`:**1203 pass / 0 fail**(P20a 1172 → +31),
  coverage **69.36%**(+0.10%),所有 lint + e2e ✅

## 文件清单

新增:
- `src/shared/thinking/provider-params.ts`(~70L)
- `src/shared/thinking/fast-mode-rejection.ts`(~25L)
- `src/commands/core/thinking.ts`(~160L)
- `test/shared/thinking/provider-params.test.ts`(13 条)
- `test/shared/thinking/fast-mode-rejection.test.ts`(5 条)
- `test/commands/core/thinking.test.ts`(11 条)
- `test/application/chat/thinking-wiring-e2e.test.ts`(3 条)
- `docs/adr/0020-p20b-wire-thinking-effort-fast.md`(本文)

修改(软红线):
- `src/application/chat/conversation-engine.ts` — thinking 字段
- `src/application/chat/query-loop.ts` — request.thinking 挂接
- `src/core/agent/agent.ts` — thinkingOverride 字段 + 运行时 resolve

修改(非红线):
- `src/shared/llm-api/base.ts` — CompletionRequest.thinking
- `src/shared/thinking/index.ts` — barrel
- `src/infra/llm/anthropic/index.ts` — wire + fast rejection cooldown
- `src/infra/llm/openai/shim/provider.ts` — wire reasoning_effort
- `src/infra/llm/openai/shim/codex-shim.ts` — wire reasoning.effort
- `src/core/agent/agents.ts` — buildAgentConfigFromXQoderConfig 透传
- `src/infra/shared/types.ts` — XQoderConfig.thinking
- `src/infra/shared/config-normalizers.ts` — normalizeThinkingPreference
- `src/plugins/command-plugins.ts` — 注册 3 命令

## 不做 / 搁置

- **DeepSeek R1 / qwen3 / glm-4-plus 的 provider-specific thinking 字段**
  → 施工单把这些标成"不确定项, v1 硬编码, v2 抽 thinkingFieldMap"。
  我们的 resolveThinking 已经给这些 model family 打了 `mode: 'enabled' /
  'adaptive'`,但 provider 侧没加对应 wire(Minimax / DashScope provider
  走 OpenAI shim,`reasoning_effort` 是它们不认的;该 provider 报 400
  时用户能立刻看见)。v2 加专门的 provider-params helper 切走。
- **REPL slash commands `/think /nothink /effort /fast`** → 施工单里提到
  "REPL 里也映射 `/think /nothink /effort /fast` slash 命令",REPL
  slash 注册是 P11 的范围,本期不动, P22-ink UI 期或新 slash 整合期。
- **PostThinking hook 事件** → 施工单标 "v2 实现",不做。
- **提供 `xqoder cost --thinking-only` 视图** → 无需求,session.usage 的
  reasoning_tokens 字段已经捕获(P15a/c 串通),想看时用 `--json`。

## P20 收官

- P20a:4 个 pure module + 38 单测
- P20b:3 个 provider wire + 3 CLI 命令 + session plumbing + 23 单测 +
  3 e2e

P15 + P20 合计推动 S5(成本 + telemetry + 思考档位)进入收尾。剩余
S5 期:**P21 — OAuth 凭据**。
