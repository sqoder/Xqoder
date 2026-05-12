# 0018 · P15c — wire usage + telemetry into provider/tool/hook paths

- Status: Accepted
- Date: 2026-05-11
- Phase: P15c

## Context

P15a 给了 `NormalizedUsage` 归一。P15b 给了 `TelemetrySink` + `CacheStatsTracker`
+ `xqoder cost`。P15c 把**已搭好的骨架串到真实运行路径上**:

- provider turn 结束 → 发 `model.completed` + NormalizedUsage
- tool 执行结束 → 发 `tool.completed`
- hook dispatcher 完成 → 发 `hook.completed`
- e2e 跑一条对话,验证 session.usage 与 telemetry 一致

## 红线声明

本期按 CLAUDE.md 软红线规则改了 `src/application/chat/provider-turn.ts`
(增加 telemetry 发射),不停下,走 ADR 记录。其余被改文件不在红线范围。

零硬红线触碰:
- `src/application/chat/verification-gate.ts` 未动
- `src/infra/protocol/events.ts` 未动

## Decisions

### 1) 挂载点选择

| 事件 | 挂点 | 发射模式 |
|------|------|--------|
| `model.completed` | `provider-turn.ts::runProviderTurn` 成功返回前 | 同步一次 |
| `tool.completed` | `agent-tool-execution.ts` onToolEnd 之后、recordToolExecution 之前 | 同步一次 |
| `hook.completed` (lifecycle) | `lifecycle-hooks.ts::dispatchLifecycleHook` return 前 | 仅在 `handlers.length > 0` 时发射(避免未配置 hook 时噪声) |
| `hook.completed` (tool) | `hooks.ts::runToolHooks` return 前 | 同上 |
| `session.ended` | **本期不挂** | 见 §5 |

### 2) NormalizedUsage 的构造:不走 infra normalizers

最初想法是在 provider-turn 里 import `src/infra/llm/usage` 的
`normalizeUsage`。结果:
- `provider-turn` 在 application 层,infra 的 normalizers 针对 **raw 原始
  payload**,但 application 层拿到的是已经被 LLM provider 折叠过的
  `ConversationProviderUsage`(含 promptTokens/completionTokens/
  cacheReadTokens)
- 直接再走一遍 `normalizeOpenAI` 会对这种折叠 shape 误解析

**处理**:在 `src/shared/telemetry/build-usage.ts` 加一个专用小 helper
`buildNormalizedUsageFromProviderUsage`,把
`ConversationProviderUsage` + provider + model + 已算好的 cost 合成
`NormalizedUsage`,**不复用 infra 通用 normalizers**。逻辑简单:
`regularInput = max(promptTokens - cacheRead - cacheCreate, 0)`。

未来 P15+ 处理 raw provider SDK 事件时(例如直接读 streaming 里的 usage
事件而不走当前 `ConversationProviderUsage` 中间件)可以回去用 infra 的
`normalizeOpenAI/Anthropic/Codex`。两条路各司其职。

### 3) session.id 透传

`TelemetryEvent` 的 `sessionId` 字段都可选。挂点统一用:
```ts
...(source.session.id ? { sessionId: source.session.id } : {}),
```
spread 模式兼容 `exactOptionalPropertyTypes: true`。

### 4) Hook 事件的 `decision` 字段

- Lifecycle:`blocked ? 'block' : 'allow'`
- Tool:优先级链 `decision:'block'` > `permissionDecision:'deny'` >
  `continue===false → 'stop'` > 否则 `'allow'`

`HookLifecycleName` 已在 P15b sink 里声明成 10 个 hook 事件的联合,
`runToolHooks` 里用 `as HookLifecycleName` 收敛类型(tool hook 的事件名
`PreToolUse` / `PostToolUse` 都在该联合里)。

### 5) 不挂 `session.ended` 的理由

`session.ended` 的语义是"整个 session 生命周期结束",XQoder 是 turn-scoped
runtime,跟 P14b 决定不挂 `SessionEnd` 同因——目前没有 session lifecycle
owner。等 P17+(skills / session 生命周期)给出明确归属再挂。

### 6) 测试策略:4 条 e2e 而非 mock

`test/application/chat/telemetry-wiring-e2e.test.ts` 用 stub provider +
内存 sink,**真实跑 `XQoderAgent.run(...)`**,断言:
- 纯文本回复 → 恰好一条 `model.completed`,NormalizedUsage 字段正确
  (input / output / cacheRead / costUsd)
- 带 tool_call 的两 turn → 两条 `model.completed` + 至少一条
  `tool.completed`,tool 名 / success / duration 可见
- 配了 SessionStart hook → 有 `hook.completed` 事件 decision='allow'
- **session.usage 和 telemetry 的 NormalizedUsage 数值一致**
  (`session.promptTokens === modelEvent.usage.input + cacheRead`)

最后一条是本期施工单明确要求的"e2e:跑一轮对话,`session.usage` 与 CLI
`xqoder cost` 一致"——我们通过断言 session.usage 与 NormalizedUsage
(`xqoder cost` 底层也是从 session.usage 回投算的)的关系来证明。

## Validation

- `bun run release:check`:**1134 pass / 0 fail**(P15b 1130 → +4),
  coverage **69.21%**(P15b 69.08%,+0.13%),e2e smoke ✅、
  mcp:live-smoke 三 transport ✅、security hygiene ✅、size guardrail ✅
- 零回归:所有既有 lifecycle-hooks-wiring / query-stop-hooks / 相关测试
  保持通过(1130 → 1134 全通)
- e2e 输出证明 telemetry 会在每次 agent.run 上发射

## 文件清单

新增:
- `src/shared/telemetry/build-usage.ts`(~35L,ConversationProviderUsage →
  NormalizedUsage 小工具)
- `test/application/chat/telemetry-wiring-e2e.test.ts`(4 条 e2e,~220L)
- `docs/adr/0018-p15c-wire-usage-telemetry.md`(本文)

修改(软红线):
- `src/application/chat/provider-turn.ts` — recordUsage 返回 cost;
  runProviderTurn 结束前发 `model.completed`;state 加 `costUsd?`

修改(非红线):
- `src/core/agent/agent-tool-execution.ts` — onToolEnd 后发
  `tool.completed`
- `src/core/agent/lifecycle-hooks.ts` — dispatchLifecycleHook 末尾发
  `hook.completed`(当 handlers.length > 0)
- `src/core/agent/hooks.ts` — runToolHooks 末尾发 `hook.completed`
- `src/shared/telemetry/index.ts` — barrel 导出新 helper

## 不做 / 搁置

- **`session.ended` 事件** → 等 session lifecycle owner(P17+)
- **Datadog HTTP 真实提交** → 用户按需实现,当前 stub 足够
- **`xqoder cost --from-telemetry`**(从 telemetry sink 重建成本)→
  施工单不要求
- P14 的 SubagentStop / SessionStart / Stop fire-and-forget 路径也会
  经过 `dispatchLifecycleHook`,因此 hook.completed 对这些路径同样会
  fire。Fire-and-forget 模式下 telemetry 异步也不影响结果

## 下一期

P15 三子期 a/b/c 全部完成。按 02-execution-order-logic-first:
- S5 已完:P13(MCP) / P14(hooks) / P15(cost + telemetry)
- S5 剩:**P20 — thinking/effort/fastMode** 和 **P21 — OAuth 凭据**

按施工单顺序下一期 **P20**。
