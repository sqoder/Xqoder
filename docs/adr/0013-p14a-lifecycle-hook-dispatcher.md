# 0013 · P14a — Lifecycle hook dispatcher

- Status: Accepted
- Date: 2026-05-11
- Phase: P14a

## Context

Phase 14 扩 hook 生态到 OpenClaude 的 10 事件 + 3 handler 类型。施工单
（docs/openclaude-parity/phase-14-lifecycle-hooks.md）规模大:事件扩展、
6 个新生命周期点挂载到 conversation-engine / compact / subagent、
`xqoder hooks add/remove/list/test` CLI、e2e 阻断用例。

单期跑完会把主会话上下文推到 60% 以上,继承 P13 拆子期的做法:

- **P14a(本期)**:事件类型扩展 + 独立 lifecycle dispatcher,不 wiring 调用点,不加 CLI
- P14b:把 6 个生命周期事件挂到 conversation-engine / auto-compact / subagent 调用点
- P14c:Commander 子命令 + UserPromptSubmit deny 的 e2e 阻断用例

## Decisions

### 1) 扩 `SUPPORTED_HOOK_EVENTS` 到 10 事件

`src/infra/shared/types.ts` 里 `SUPPORTED_HOOK_EVENTS` 从
`['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit']`
扩到 10 个:追加 `SessionStart`、`SessionEnd`、`Stop`、`SubagentStop`、
`PreCompact`、`PostCompact`。

下游自动跟进:
- `isHookEventName` / `HookEventName` 类型推导
- `schema.ts` JSON schema 的 hooks 属性自动包含所有新事件
- `config-normalizers-hooks.ts` 的合并 / 过滤逻辑无需改动
- `application/system/hooks.ts` 的 `runShowHooksCommand` 直接显示新事件

### 2) 泛化 handler 执行器签名

`hook-handler-execution.ts` 里 `executeHookHandler` 及内部 command/http/prompt
三个实现都只读 payload 上的 `hook_event_name` 字段(写入 env 用);
同样只读 config 上的 `cwd/projectRoot/sessionId/llmConfig/logger` 这些
**不依赖 `permissionMode`** 的字段。

因此新增两个基础类型到 `hooks.ts`:
- `HookPayloadBase` — 只含 `hook_event_name`、`session_id?`、`cwd`、`project_root`
- `HookRunnerConfigBase` — 不含 `permissionMode`

`ToolHookRunnerConfig` 改为 `extends HookRunnerConfigBase` 加
`permissionMode`,保持工具热路径调用方源代码 0 改动。

工具事件 payload (PreToolUseHookPayload / PostToolUseHookPayload /
PostToolUseFailureHookPayload)改为 `extends HookPayloadBase`,字段不变,
**不破坏 agent-tool-execution.ts 已有 payload 形状**(这是施工单明确列为
"禁止修改"的)。

### 3) 新增 `src/core/agent/lifecycle-hooks.ts`

独立文件,不动 `hooks.ts` 里的工具热路径(`runToolHooks`)。提供:

- 6 个生命周期 payload 接口(SessionStart/End/Stop/SubagentStop/PreCompact/PostCompact),
  全部 `extends HookPayloadBase`
- 6 个 builder 函数(`buildSessionStartPayload` 等),统一"可选字段缺省时不写入属性"
- `dispatchLifecycleHook(event, payload, config)` — 同步阻塞版本,用于
  SessionStart 这种**需要读取 block / additionalContext 的事件**
- `dispatchLifecycleHookFireAndForget(event, payload, config)` — fire-and-forget,
  超时 5s 自动放弃(用 `setTimeout` + `unref`,不 await),专给 Stop /
  SubagentStop / SessionEnd 这种不允许阻塞主流程的事件

### 4) `continue=false` / `decision=block` / `decision=deny` 统一视为 blocked

OpenClaude 里 `UserPromptSubmit` 用 `decision='block'`,`Stop` 用 `decision='deny'`,
而通用拦截用 `continue=false`。本期在 lifecycle dispatcher 里三种都视为
`blocked=true`,以 `reason || stopReason` 为原因文案。工具热路径的语义不变
(`decision=block` only)。

### 5) Barrel 扩展

`src/core/agent/index.ts` 新增导出 `dispatchLifecycleHook` /
`dispatchLifecycleHookFireAndForget` / 6 个 builder / 所有相关类型,为
P14b 调用点直接 `import` 铺路。同时把 `HookPayloadBase` 和
`HookRunnerConfigBase` 也导出,方便测试和未来 handler 自定义。

## 不做 / 搁置到后续子期

- **wiring 到调用点**(SessionStart 在 createConversationTurnStream 首次起始 /
  SessionEnd 在结束 / Stop 每 turn 末 / PreCompact+PostCompact 在 auto-compact
  前后 / SubagentStop 在子 agent 完成)→ P14b
- **`xqoder hooks add/remove/list/test` CLI** → P14c
- **UserPromptSubmit deny 的 e2e 阻断用例** → P14c
- **PostSamplingHooks**(OpenClaude 里 sampling 完成后 / assistant 消息写入前)
  → 施工单明确标记 "v1 不纳入,留 phase-27 评估"

## Validation

- 新增 `test/core/lifecycle-hooks.test.ts`,18 条:
  - `SUPPORTED_HOOK_EVENTS` 包含 10 个事件 / isHookEventName 接受生命周期事件 /
    拒绝未知事件(3 条)
  - 6 个 builder 的 payload 形状 + 可选字段处理(6 条)
  - `dispatchLifecycleHook`:无配置 → 放行 / disableAllHooks → 短路 /
    additionalContext 收集 / `decision=block` → blocked / `continue=false` →
    blocked + stopReason / 多 handler 去重 / 错误不阻塞(7 条)
  - `dispatchLifecycleHookFireAndForget`:同步返回 / 所有事件 name 都能过(2 条)
- `bun run release:check` — **1073 pass / 0 fail**,coverage 68.75% PASS,
  e2e smoke 3 transport 全绿,security hygiene PASS,size guardrail PASS

## 零红线触碰

本期 0 触碰硬/软红线:
- `src/application/chat/verification-gate.ts` 未动
- `src/infra/protocol/events.ts` 未动
- `src/application/chat/conversation-engine.ts` 未动(P14b 会动)
- `src/application/chat/tool-orchestrator.ts` 未动
- `src/application/chat/permission-gate.ts` 未动

## 文件清单

新增:
- `src/core/agent/lifecycle-hooks.ts` (约 250L)
- `test/core/lifecycle-hooks.test.ts` (约 320L, 18 条测试)
- `docs/adr/0013-p14a-lifecycle-hook-dispatcher.md`(本文)

修改:
- `src/infra/shared/types.ts` — `SUPPORTED_HOOK_EVENTS` 从 4 → 10
- `src/core/agent/hooks.ts` — 拆出 `HookPayloadBase` / `HookRunnerConfigBase`;
  `ToolHookRunnerConfig` + 三个工具 payload 改为 `extends ...`
- `src/core/agent/hook-handler-execution.ts` — 签名改用 `HookPayloadBase` +
  `HookRunnerConfigBase`(只读共同字段,工具字段从未被使用)
- `src/core/agent/index.ts` — barrel 扩展导出 lifecycle API + base 类型
