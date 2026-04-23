# XQoder Conversation Engine Master Plan v1.0

> 本文件是 XQoder Conversation Engine 总蓝图，不是一次性施工单。
> 所有实现必须遵守 `docs/conversation-engine-slice-prompt.md`。
> 每次只允许交付一个 Slice。
> 任何跨 Slice 真实实现都视为违规。

## Summary

将 XQoder 从 `run-chat.ts + XQoderAgent.run() + MvpRuntimeController` 的分散协作，升级为以 `ConversationEngine` 为唯一 turn 执行入口的统一协议中心。

外层 CLI / TUI / HTTP / headless 只消费稳定事件协议，不再自行决定 agent loop。

施工采用 `Master Plan + Slice Prompt` 双文档模型：Master Plan 定方向，Slice Prompt 控施工；每次只允许交付一个 Slice，任何跨 Slice 的真实实现都视为违规。

## Documentation Set

- 主文档：`docs/xqoder-conversation-engine-master-plan.md`
- 施工约束：`docs/conversation-engine-slice-prompt.md`
- 详细说明文档保留为参考，不作为施工入口：
  - 可迁移为 `docs/xqoder-conversation-engine-implementation-reference.md`

## Core Protocol Decisions

- `ConversationEngine` 是唯一 turn 执行入口。
- `run-chat.ts` 收敛为 interface use case。
- `XQoderAgent.run()` 收敛为 facade。
- 所有 surface 只消费稳定 envelope，不直接依赖裸事件：

```ts
export type ConversationEventEnvelope<
  TType extends ConversationEventType = ConversationEventType,
  TPayload = unknown,
> = {
  schemaVersion: 1
  eventId: string
  sessionId: string
  turnId: string
  timestamp: string
  type: TType
  payload: TPayload
}
```

```ts
interface ConversationEngine {
  runTurn(input: ConversationTurnInput): AsyncIterable<ConversationEventEnvelope>
}
```

- `ConversationEventType` 必须是受控联合类型，不允许 `type: string`。
- 运行时模型固定为三层：
  - `TaskMode`
    - `casual_chat`
    - `project_question`
    - `plan_only`
    - `engineering_edit`
    - `debug_fix`
    - `code_review`
  - `ExecutionCapability`
    - `read_only`
    - `plan`
    - `workspace_write`
  - `ApprovalPolicy`
    - `strict`
    - `balanced`
    - `workspace_auto`
    - `full_auto` // reserved
    - `dangerous_full_access` // reserved
- 任务模式主导工具可见性、默认写能力、是否要求 verifier、是否进入模型；审批策略只对已暴露工具做 `allow / ask / deny`。
- `Command Router` 先于模型执行：
  - 不进模型：`/status`、`/tools`、`/permissions`、`/compact`
  - 受限进模型：`/plan`、`/review`
  - `/implement` 必须依赖 approved plan；没有 approved plan 时转入 `/plan`
- `ToolOrchestrator` 闭环固定为：
  - `PreToolUse`
  - `Permission`
  - `Checkpoint`
  - `Execute`
  - `Collect`
  - `PostToolUse`
  - `Write tool_result`
  - `Emit event`
- `tool_result` 必须同时写给模型上下文、用户可见流、transcript、event store。
- `Event Store` 是事实源；`Transcript` 是模型投影；`Renderer Stream` 是用户投影；`Session Metadata` 是恢复索引。
- `Verification Gate` 是协议级 barrier，固定拆为：
  - `VerificationPlanner`
  - `VerificationRunner`
  - `VerificationEvaluator`
  - `RecoveryController`

## Stop Conditions And Terminal Events

- 停止条件是 `ConversationEngine` 的核心协议，不是测试细节。
- 必做停止条件：
  - `maxTurns`
  - `maxToolCalls`
  - `maxWallTime`
  - `duplicate tool call detection`
  - `no-progress detection`
  - `user cancel`
  - `permission denied`
  - `verification failed`
  - `provider error`
- 统一停止原因：

```ts
export type StopReason =
  | 'completed'
  | 'max_turns'
  | 'max_tool_calls'
  | 'max_wall_time'
  | 'duplicate_tool_call'
  | 'no_progress'
  | 'user_cancelled'
  | 'permission_denied'
  | 'verification_failed'
  | 'provider_error'
```

- 所有 turn 的完成、失败、取消、超限、权限阻断、验证失败，都必须写入事件流并携带 `stopReason`。
- terminal event payload 至少支持：

```ts
export type TurnStoppedPayload = {
  reason: StopReason
  message?: string
}
```

## V1 Boundaries

- V1 只开放以下审批策略：
  - `strict`
  - `balanced`
  - `workspace_auto`
- `full_auto` 与 `dangerous_full_access`：
  - 只保留类型和接口
  - 不暴露 CLI 入口
  - 不暴露 config 默认入口
  - 不进入 V1 可用能力
- `plan_only` 不暴露写工具。
- V1 中所有工作区外写、网络、高风险命令、敏感读取、高风险 MCP 工具，都必须进入 `ask` 或 `deny`。

## Slice Plan With Done Definitions

1. `Slice 0: 基线冻结 / characterization tests`
   - Done:
     - 冻结当前 `chat / agent loop / provider relay / tool result / verification / stream` 主链行为
     - 找出 CLI / TUI / HTTP / headless 当前事件差异
     - 只允许最小测试 seam
     - 不做架构重写
   - Must not:
     - 不重写 `run-chat.ts`
     - 不重写 `agent.ts`
     - 不引入新 engine 主循环

2. `Slice 1: Turn Intake + Command Router`
   - Done:
     - 所有入口都能生成 `ConversationTurnInput`
     - `/plan` 不再作为普通 prompt 进入模型
     - `/status` 可直接返回 runtime event
     - 旧 `ChatTurnInput` 保留兼容 wrapper
     - `Slice 0` 测试全部通过
   - Must not:
     - 不实现 `ConversationEngine` 主循环

3. `Slice 2: Conversation Engine 最小主循环`
   - Done:
     - `ConversationEngine` 成为最小可运行 turn 主循环
     - 支持 `casual_chat`
     - 支持 `plan_only`
     - `engineering_edit` 仅通过 legacy compatibility seam 维持旧行为
     - 不实现新的 `ToolOrchestrator`
     - 不改变现有 permission / checkpoint / verification 语义
     - 接入最小停止条件
   - Must not:
     - 不提前抽 `ToolOrchestrator`
     - 不提前改 `PermissionGate`
     - 不提前改 `VerificationGate`

4. `Slice 3: Provider Event Adapter`
   - Done:
     - provider 原始 shape 不再泄漏到 engine
     - 统一 `message / reasoning / tool / usage / stop / error` 事件
     - 现有 provider adapter 测试通过
   - Must not:
     - 不修改 tool orchestration 语义

5. `Slice 4: Tool Orchestrator + tool_result 回流`
   - Done:
     - 新 `ToolOrchestrator` 正式接管工具执行链
     - `tool_result` 同时写给模型、用户、transcript、event store
     - 固定执行链为 `PreToolUse -> Permission -> Checkpoint -> Execute -> Collect -> PostToolUse`
   - Must not:
     - 不引入新权限策略模型

6. `Slice 5: Permission Gate`
   - Done:
     - 任务模式主导工具暴露
     - 审批策略只裁决已暴露工具
     - `plan_only` 不暴露写工具
     - V1 只开放 `strict / balanced / workspace_auto`
   - Must not:
     - 不开放 `full_auto`
     - 不开放 `dangerous_full_access`

7. `Slice 6: Verification Gate`
   - Done:
     - 拆分 `VerificationPlanner / Runner / Evaluator / RecoveryController`
     - 写文件后不能直接完成
     - `debug_fix` 必须 `reproduce -> fix -> verify`
   - Must not:
     - 不扩展完整 resume 语义

8. `Slice 7: Event Store / Resume / Checkpoint`
   - Done:
     - Event Store 双写上线
     - V1 恢复 transcript、tool history、verification history、checkpoint metadata
     - `Event Store -> TranscriptProjector -> Transcript` 的投影结果，在测试中与当前 snapshot 的 `user / assistant / tool_result` 主体一致
     - pending approval、paused turn、compaction boundary 只预留接口，不在 V1 完整实现
   - Must not:
     - 不提前实现完整 paused turn resume

9. `Slice 8: Surface Adapter 对齐`
   - Done:
     - CLI / TUI / HTTP / headless 都只消费 `ConversationEventEnvelope`
     - 各 surface 不再决定 agent loop
     - 兼容层测试通过
   - Must not:
     - 不破坏既有对外行为，除非已有 compatibility adapter

## Current Repository Progress Assessment (2026-04-23)

- 本仓库的 live worktree 已经继续推进，不能再把 `2026-04-22` 的评估当成当前事实。
- 本次本地校验已确认下列能力已经落地，不应继续在计划文档中标成“未完成”：
  - `ConversationEventEnvelope` 与 `schemaVersion / eventId / sessionId / turnId / timestamp / type / payload`
  - `permission_denied / verification_failed` stop reason
  - `TaskMode / ExecutionCapability / ApprovalPolicy`
  - `plan_only` 写工具隐藏
  - `strict / balanced / workspace_auto` 与工作区外路径 / 网络 / destructive command / 敏感读取矩阵
- 当前真实状态应表述为：`Slice 0-8` 已全部完成，最后一轮 `MvpRuntimeController` 兼容 seam 清理也已完成。
- 本轮收口已确认：
  - `Slice 4`：`ToolOrchestrator` 已通过显式 `toolExecutionPort` 接管 `prepare / invoke / finalize`，stage 记录不再出现 legacy delegation 文案。
  - `Slice 7`：`conversationEventEnvelopes` 已成为新链路唯一事实源；`conversationEvents` 仅保留旧会话 fallback。
  - `Slice 8`：CLI/headless/non-interactive prompt 已统一消费 envelope-stream helper，不再以 `agent.run(...callbacks...)` 作为 surface 主路径。
  - `Compatibility Seam`：`MvpRuntimeController` 已收窄为内部 verification/recovery helper，不再承担 planner prompt / forced-stop / no-tool blocker / finalize-response 这些 turn ownership 逻辑。

### Slice Status

- `Slice 0`：`已完成（表征测试与 surface 边界已冻结）`。
- `Slice 1`：`已完成`。`ConversationTurnInput` 与 command router 已收口。
- `Slice 2`：`已完成`。`ConversationEngine` 已成为主 turn loop，`XQoderAgent.run()` 已退化为 façade。
- `Slice 3`：`已完成`。provider 原始流已统一到 `message / reasoning / tool / usage / stop / error` 协议事件。
- `Slice 4`：`已完成`。`ToolOrchestrator` 已成为应用层唯一工具协议入口，`prepare / invoke / finalize` 分层明确，tool-result artifacts 仍保持多路回流。
- `Slice 5`：`已完成`。`TaskMode / ExecutionCapability / ApprovalPolicy` 三层模型与 V1 权限边界已经进入主链和 focused tests。
- `Slice 6`：`已完成（保留 paused-turn 不扩展）`。`VerificationPlanner / Runner / Evaluator / RecoveryController` 已拆出，写后验证与 `debug_fix` 的 `reproduce -> fix -> verify` 已入主链。
- `Slice 7`：`已完成`。transcript / session detail / resume / share / export 已固定为 `envelopes -> legacy event fallback -> legacy snapshot fallback`，新链路不再把 `conversationEvents` 当 primary source。
- `Slice 8`：`已完成`。HTTP / TUI / CLI / headless / non-interactive surfaces 已统一通过 envelope 协议消费 turn 输出。
- `Compatibility Seam`：`已完成`。`MvpRuntimeController` 只保留 verification/recovery 状态机职责，turn ownership 已移到更薄的 runtime adapter。

### Gap Summary

- 按本计划定义的施工范围，当前已无剩余未完成项。
- `paused-turn` 的完整恢复仍保持“不扩展”范围界定，这不是当前计划的遗留缺口。

## Recommended Next Slice (2026-04-23)

- 当前 Master Plan 已收口，不再存在“下一次真实施工应先做哪个 Slice”的问题。
- 如果后续要继续推进，应另开新 plan 处理明确超出当前范围的事项，例如 paused-turn 完整恢复或新的 surface/protocol 演进。

## Test Plan

- 基线测试覆盖：
  - `turn-intake`
  - `conversation-engine`
  - `provider-event-adapter`
  - `run-chat`
  - `agent-provider`
  - `server-stream`
  - `terminal app` 主链行为
- 状态机测试覆盖：
  - 普通聊天
  - 计划任务
  - 工具回环
  - 写后验证
  - 恢复失败
  - 用户取消
  - `maxTurns / maxToolCalls / maxWallTime / no_progress`
- 权限矩阵测试覆盖：
  - 任务模式
  - 审批策略
  - 工作区外路径
  - 网络
  - destructive command
  - secret access
  - MCP trust
- 恢复测试覆盖：
  - 双写一致性
  - event replay 投影一致性
  - resume 后 transcript/tool/verifier history 可见
- 协议测试覆盖：
  - 每个 envelope 都断言 `schemaVersion / eventId / sessionId / turnId / timestamp / type / payload`
  - 每个 terminal event 都断言 `stopReason`

## Assumptions

- 本文档是 Master Plan v1.0，可作为最终施工基准，但必须与 `docs/conversation-engine-slice-prompt.md` 配套使用。
- 详细“重构实施方案”文档只作为参考说明，不作为主施工入口。
- 施工从 `Slice 0` 开始，按单 Slice、单验证、单复盘推进。
- 对当前仓库状态的实际评估显示：本计划定义的 `Slice 0-8` 与最后一轮 compatibility seam cleanup 均已落地；后续工作应新开计划，而不是继续沿用本节的“下一 Slice”描述。
- 任何 agent 若执行“按文档全部实现”，视为违反施工协议。
