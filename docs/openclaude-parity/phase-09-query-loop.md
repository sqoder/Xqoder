# Phase 09 · Query 主循环对齐（query.ts / QueryEngine.ts）

## 任务目标（必须可验证）

把现有 `conversation-engine.ts`（1150 行）的"循环 + 压缩 + 阻塞 + 验收
"若干功能扩散为 OpenClaude 同名的五个文件：

| OpenClaude 源 | 对标 XQoder 目标 |
|---|---|
| `src/query.ts`（1914 行） | `src/core/runtime/query-loop.ts` |
| `src/QueryEngine.ts`（1430 行） | `src/core/runtime/query-engine.ts` |
| `src/query/config.ts` | `src/core/runtime/query-config.ts` |
| `src/query/deps.ts` | `src/core/runtime/query-deps.ts` |
| `src/query/stopHooks.ts` | `src/core/runtime/query-stop-hooks.ts` |
| `src/query/tokenBudget.ts` | `src/core/runtime/token-budget.ts` |

### 成功判定

- `conversation-engine.ts` 不再自己管 `compactIfNeeded`、重复检测、blocker
  注入，全部委托给 `QueryEngine`。
- `QueryEngine.submitMessage(input)` 是唯一对外入口，返回 AsyncIterable<Event>。
- `query-loop` 按序调用 snip → micro → collapse → autocompact（打通 phase-02）。
- `token-budget` 在每轮前计算剩余 tokens，不足时主动触发 compact
  而不是等 API 拒绝。
- Stop hook 的 5 个检查点：`max_turns / max_tool_calls / max_wall_time /
  duplicate_tool_batch / no_progress` 全部从 `conversation-engine` 抽出。

## 范围与边界

### 允许修改

- 新增 `src/core/runtime/query-*.ts`
- 大幅精简 `src/application/chat/conversation-engine.ts`
  （保留事件 envelope 生成 + 迁移到 QueryEngine）。

### 禁止修改

- 对外公共接口（`runConversationTurn / streamConversationTurn`）保留。

## 改动要点

### 1) QueryEngine 骨架

```ts
export class QueryEngine {
    constructor(private readonly deps: QueryDeps) {}

    async *submitMessage(input: TurnInput): AsyncIterable<ConversationEventEnvelope> {
        const ctx: QueryCtx = { ... };
        while (!ctx.stopped) {
            yield* this.runOneTurn(ctx);
            if (ctx.forcedStop) { yield stopEnvelope(ctx.forcedStop); return; }
            if (ctx.toolCalls.length === 0) { yield stopEnvelope('completed'); return; }
            this.runStopHooks(ctx); // → may set ctx.forcedStop
        }
    }
}
```

### 2) queryLoop 实现

`src/core/runtime/query-loop.ts` 持有 while(true) 主循环，内部调用：

- `snipCompactIfNeeded`
- `microCompact`
- `contextCollapse`
- `autoCompact`
- `recoverFromOverflow`（对应 phase-02 reactive）

按顺序调用；每一级压缩后重算 token 预算；仍不够则抛 `MaxContextError`
降级到 `/compact` 手动触发。

### 3) tokenBudget

```ts
export function estimateTokenBudget(messages, model): { remaining: number; reason: 'ok'|'near'|'exhausted' } {
    const ctxWindow = getContextWindow(model);
    const used = approximateTokens(messages);
    const reserve = 8192; // reserve for completion
    const remaining = ctxWindow - used - reserve;
    const reason = remaining <= 0 ? 'exhausted' : remaining < ctxWindow * 0.1 ? 'near' : 'ok';
    return { remaining, reason };
}
```

### 4) stopHooks

- `max_turns`：与 dep 合并后的 limit 比较。
- `max_tool_calls`：每轮累加 tool 数。
- `max_wall_time`：startedAt 基准。
- `duplicate_tool_batch`：从 `conversation-engine.ts` 迁移 `createToolCallBatchFingerprint`。
- `no_progress`：assistant 两次回复 signature 相同但没有 tool call。

## 验证

- 迁移后旧的 `conversation-engine.test.ts` 继续绿。
- 新增 query-loop 独立单元测试 ≥ 30 条。

## 风险与回退

- **风险**：大规模迁移引入 bug。
  **策略**：分 4 个 sub-PR：
  1. tokenBudget + queryConfig（可先独立落地，不改 caller）。
  2. stopHooks 抽出（conversation-engine 调 stopHooks）。
  3. queryLoop 抽出主循环（conversation-engine 代理）。
  4. QueryEngine wrapper + 删除 conversation-engine 里已迁移的代码。

## 不确定项

- `QueryEngine` 在 OpenClaude 里用到 "context arc"（长期记忆）概念
  （`utils/conversationArc.ts`）。本期不迁移 conversationArc，留到 phase-24。
