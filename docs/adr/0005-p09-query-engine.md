# ADR 0005 — P09 QueryEngine + query-loop 抽离

- **Date**: 2026-05-10
- **Status**: Accepted
- **Phase**: P09
- **Related docs**: `docs/openclaude-parity/phase-09-query-loop.md`
- **软红线**: `src/application/chat/conversation-engine.ts`(触碰,需 ADR)

## 背景

`conversation-engine.ts` 在 P02/P05/P08 之后已经到 1129 行,聚合了:

1. 主循环 `executeConversationTurn` (while iteration < maxTurns)
2. 压缩触发 `runTurnWithReactiveCompaction` + `maybeAutoCompact`(P02)
3. 5 种 stop hook(max_turns / max_tool_calls / max_wall_time /
   duplicate_tool_batch / no_progress)
4. 配置解析 `resolveMaxTurns` + 墙钟 `isWallTimeExceeded`
5. read-only recovery tool-call 构造器
6. 事件包络流水线(message.started / status.changed / usage / …)
7. Provider turn 调用(`requestAssistantTurn`)

OpenClaude 对标侧 `query.ts` (1914 行) + `QueryEngine.ts` (1430 行) 通过
分模块(`query/config.ts / deps.ts / stopHooks.ts / tokenBudget.ts`)把
这些职责拆开。我们要的 parity 不是逐文件等价,而是:

- **单入口** `QueryEngine.submitMessage(input)` 返回
  `AsyncIterable<ConversationEventEnvelope>`
- **单循环** query-loop 负责迭代 + 压缩阶梯 + stop hook 检测
- stop hook 是**纯检测器**,返回 directive,不自行 throw

## 决策

### 1) 模块拆分(保持 application 层内)

施工单原文说放到 `src/core/runtime/`。实际跑架构守卫(`test/architecture-guardrails.test.ts`)时发现:**application → core 的 import 被禁止**(第 141 行 `forbiddenLayers: ['commands', 'core', 'platform', 'infra', 'services']`)。

这是软红线之外的另一条硬约束。对齐 P02 `compaction-pipeline.ts` 的先例,
把所有新模块落到 `src/application/chat/` 里:

| 模块 | 行数 | 角色 |
|---|---:|---|
| `query-config.ts` | 34 | `resolveMaxTurns` / `isWallTimeExceeded` / `wouldExceedMaxToolCalls`,纯函数 |
| `token-budget.ts` | 81 | `estimateTokenBudget(messages, model)` → `{ used, remaining, contextWindow, reason: 'ok'|'near'|'exhausted' }`;4-chars-per-token 启发式,用现成的 `getContextWindow` |
| `query-stop-hooks.ts` | 163 | duplicate_tool_batch / no_progress 纯检测器 + `resolveForcedStopDirective` + `resolvePermissionDeniedStopMessage`;无副作用 |
| `query-loop.ts` | 422 | `runQueryLoop(deps, hooks)` 拿到 4 个注入 hook(createStopError / emitAgentEnd / recordToolFollowUpResult / assertProgressOnBlockedContinuation)后承担整个迭代体 |
| `query-engine.ts` | 34 | `QueryEngine` class + `submitMessage` / `runTurn` 门面 |

`conversation-engine.ts` **从 1129 → 644 行**,只剩:
- 公共 export(`runConversationTurn` / `streamConversationTurn` / `runConversationEngine` 保持签名不变,**是稳定契约**)
- 事件包络流水线 `createConversationTurnStream`(触碰事件 envelope,由 `ConversationEventEnvelopeEmitter` 生成,不适合塞进纯循环)
- 4 个 side-effect hook(要吃 `dependencies.emit` / `session`)

### 2) stop hook 改为纯检测器

以前:
```ts
function assertProgressOnBlockedContinuation(input) {
    // 内部 throw createStopError(...)
}
```
现在:
```ts
function detectNoProgressOnBlocker(input): StopDirective | undefined
```
检测器返回 undefined / `{ stopReason, message, agentEndReason }`。
调用方决定要不要 throw + 发事件。这让 stop 逻辑可单测(已加 10+ case)。

### 3) token-budget 先落地,暂不接入 loop

施工单 §3 要求循环用 budget 提前触发 compact。本期**只**把 `estimateTokenBudget` 写好 + 单测覆盖好,**不改 loop 内部调用**。原因:`compaction-pipeline.ts` 的 `runTurnWithReactiveCompaction` 已经能靠 `PromptTooLongError` 反应式回退,主动触发还需要选 snip / micro / autocompact 的 policy。留到 P10 接 feature flag 再打开,风险可控。

## 红线

- **硬红线**:未改动(`verification-gate.ts` / `domain/conversation/events.ts`)
- **软红线**:`conversation-engine.ts` 被大幅精简(-485 行),已额外 lint 全绿 +
  3 个架构守卫用例绿 + 23 个既有 engine 测试绿
- **禁止行为**:未新建 `*-factory.ts` / `*-manager.ts`(新文件是 `query-*.ts`
  / `token-budget.ts`,职责单一名字),未 `as unknown as`,未 `any`,未注释
  golden task

## 验证

- `bun run lint`: 绿
- `bun test test/application/chat/`: 173 pass / 0 fail
- `bun test test/architecture-guardrails.test.ts`: 3 pass / 0 fail(layer 越界被拦下)
- `bun test test/core/agent-conversation-engine-compat.test.ts`: 绿
- 新增测试:
  - `token-budget.test.ts` 10 条
  - `query-config.test.ts` 10 条
  - `query-stop-hooks.test.ts` 24 条(覆盖 5 个 stop 检测 + normalize 辅助)
  - `query-engine.test.ts` 2 条(facade smoke)
  - 合计 **46 新测试**

## 不确定项 / 延后

1. **OpenClaude 的 conversationArc**(长期记忆)未迁移,待 P24
2. **`estimateTokenBudget` 主动触发 compact** 的 policy 待 P10 feature flag
3. 施工单原文要求目标路径 `src/core/runtime/*`,与 layered 架构守卫冲突。
   已在本 ADR §1 记录并改道 `src/application/chat/*`;若后续 P13/P16 要在
   `core/` 复用 QueryEngine,需要先调整守卫放开 `application → core`
   或给 `query-*.ts` 做无依赖化(目前 query-loop 依赖 handleToolFollowUp /
   runProviderTurn 都在 application 层,短期无法搬)。
