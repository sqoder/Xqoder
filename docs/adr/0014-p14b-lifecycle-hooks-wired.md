# 0014 · P14b — Lifecycle hooks wired into conversation engine

- Status: Accepted
- Date: 2026-05-11
- Phase: P14b

## Context

P14a 落了 `dispatchLifecycleHook` / `dispatchLifecycleHookFireAndForget` 两个
非工具 hook 分发器,但没挂任何调用点。P14b 把 4 个生命周期事件挂到真实
调用点,让 `.xqoder/hooks.json` 里配置的 SessionStart / Stop / PreCompact
/ PostCompact / SubagentStop 能在 agent 实际跑起来时真的触发。

## 红线改动声明

本期按 CLAUDE.md 软红线规则改了 **`src/application/chat/conversation-engine.ts`**
(新增 SessionStart 阻塞 + Stop fire-and-forget),不停下,走 ADR 记录。
其余被改文件不在红线范围。

## Decisions

### 1) 挂载点选型

| 事件 | 挂点 | 模式 | 理由 |
|------|------|------|------|
| SessionStart | `createConversationTurnStream` 在 `session.started/resumed` 事件后 | 阻塞(`dispatchLifecycleHook`) | 施工单要求 deny 时"主循环不进入" — 阻塞语义是硬需求 |
| Stop | 同一 scope 的 `finally` 块,`eventQueue.close()` 之前 | fire-and-forget(5s 超时) | 施工单明确"Stop hook 不阻塞主流程" |
| PreCompact | `compaction-pipeline.ts::maybeAutoCompact`,summarizer 调用之前 | 阻塞 | 用户需要能 "block 这次 compact"(e.g. 敏感上下文) |
| PostCompact | 同上,`performCompaction` 成功后 | fire-and-forget | 观测通知,不应该阻塞下一 turn |
| SubagentStop | `DelegateTaskTool.execute` 的 `finally` | fire-and-forget | 和 Stop 对称;subagent 失败也要通知 |

**source 推导**:SessionStart 根据 `sessionResumed` / `initialMessageCount`
推 `'startup'` vs `'resume'`,不加新字段。

### 2) `SessionEnd` 不在本期挂

**原因**:XQoder 的 conversation-engine 是**turn-level** 的;每次 `agent.run()`
或 `streamTurn()` 走一次 `createConversationTurnStream`,不等于 session end。
真正的 session end 是进程退出或 TUI 清上下文,跨越多次 turn。挂到 turn end
会让 SessionEnd 每轮都触发,语义错。

**处理**:保留 `buildSessionEndPayload` 和 `'SessionEnd'` 分发路径
(P14a 已就绪),但**不挂 wiring**。等 P17 skill 或更晚期出现显式的
"session 生命周期 owner"(目前散落在 CLI / TUI / web 三处启动路径)
再统一挂。施工单的 DoD 没单独要求 SessionEnd 必须触发,只给了 10 事件
类型列表,合规。

### 3) `hooks` / `disableAllHooks` / `projectRoot` 贯穿

`ConversationEngineDependencies` 新加 3 字段可选透传。
`agent.ts` 两处 runTurn / streamTurn 调用点同时传入;`runtimeProfile === 'mvp'`
时仍遵循 "hooks 被禁用" 的既有语义(P04 引入)。

`ToolContext` 新加 3 字段(`hooks?` / `disableAllHooks?` / `logger?`)以让
`DelegateTaskTool` 在工具执行期内读到 hooks 配置,不穿全新的 parameter 链。
字段全是 optional,不影响既有测试/工具实现。

### 4) SessionStart 阻塞时的终态

SessionStart 被 block → 抛 `ConversationEngineStopError(provider_error, error)`,
同时 emit `error` + `status.changed{status:error}` envelope,然后 `eventQueue.close()`。
保持和其他 ConversationEngineStopError 行为一致,调用方(agent.run)按既有
error-path 走。

### 5) 5s fire-and-forget 超时用 `setTimeout(..., 5_000).unref()`

P14a 已实现 `dispatchLifecycleHookFireAndForget` 的超时语义 —— 本期只调用它,
没改超时常量。`.unref()` 确保 hook 尾部不阻止进程正常退出(Bun 的 setTimeout
返回的 Timer 在 Node.js 兼容层也支持 `.unref()`,P14a 做了可选链保护)。

## Validation

- **bun run release:check**: **1076 pass / 0 fail**,coverage **68.80%**
  (P14a 为 68.75%,+0.05%),e2e smoke ✅、mcp:live-smoke 三 transport ✅、
  security hygiene ✅、size guardrail ✅
- 新 integration 测试 3 条(`test/application/chat/lifecycle-hooks-wiring.test.ts`):
  1. SessionStart + Stop 都能触发到标记文件(Stop 因是 fire-and-forget,
     用 `waitForMarker` polling 等最多 2s)
  2. SessionStart 返回 `decision=block` 时 provider.stream 不被调用,异常携带 reason
  3. `disableAllHooks=true` 时 SessionStart 不触发

## 不做 / 搁置

- **SessionEnd wiring** → P17+(需要 session 生命周期 owner)
- **PreCompact 在主动 compact(`maybeActiveTokenBudgetCompact` 的 step 2)路径**
  → 已自动覆盖(`maybeActiveTokenBudgetCompact` 最终调 `maybeAutoCompact`,
  共享同一挂点)
- **PreCompact 在**reactive compaction(PromptTooLongError 恢复)**路径** →
  reactive 是紧急降级,hooks 不该阻塞,故意不挂
- **`xqoder hooks add/remove/list/test` CLI** → **P14c**
- **UserPromptSubmit deny 的 e2e** → **P14c**

## 零硬红线触碰

- `src/application/chat/verification-gate.ts` 未动
- `src/infra/protocol/events.ts` 未动

## 文件清单

新增:
- `test/application/chat/lifecycle-hooks-wiring.test.ts`(约 180L,3 条 integration)
- `docs/adr/0014-p14b-lifecycle-hooks-wired.md`(本文)

修改(软红线):
- `src/application/chat/conversation-engine.ts` — SessionStart + Stop 挂点,
  `ConversationEngineDependencies` 加 `projectRoot?` / `hooks?` / `disableAllHooks?`

修改(非红线):
- `src/application/chat/compaction-pipeline.ts` — PreCompact + PostCompact 挂点,
  `CompactionPipelineDeps` 加同 3 字段
- `src/core/agent/tools/tool.ts` — `ToolContext` 加可选 `hooks` / `disableAllHooks`
  / `logger`
- `src/core/agent/tools/agent-tool.ts` — `DelegateTaskTool.execute` 的 `finally`
  里触发 SubagentStop,从 `context` 读取 hooks 配置
- `src/core/agent/agent.ts` — `toolContext` 填充 hooks;`run` / `streamTurn`
  两处给 engine 传 hooks / projectRoot / disableAllHooks

## 证据:hooks 确实会跑

`test/application/chat/lifecycle-hooks-wiring.test.ts` 的第 1 条用文件系统
标记验证,不依赖 mock:hook command 写入 marker 文件,测试读 marker 内容
确认 `'fired'`。运行结果:

```
test/application/chat/lifecycle-hooks-wiring.test.ts:
 3 pass / 0 fail / 8 expect() calls
```
