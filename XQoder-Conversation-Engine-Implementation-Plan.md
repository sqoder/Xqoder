# XQoder Conversation Engine 重构实施方案

## 任务目标（必须可验证）

将当前 XQoder 的对话执行链路，从“`run-chat.ts` + `XQoderAgent.run()` + `MvpRuntimeController` 分散协作”的半重构状态，升级为一个以 `Conversation Engine` 为核心的统一执行协议中心。

该重构的目标不是单纯“抽代码”或“整理文件结构”，而是建立一条稳定、可恢复、可验证、可扩展的 Agent CLI 主链，使 CLI / TUI / HTTP / headless 全部基于同一套 turn 状态机、事件协议、权限策略和验证闭环工作。

### 成功判定

- `ConversationEngine` 成为唯一的 turn 执行入口，外层接口层只消费事件，不再自行决定 agent loop。
- slash command、普通 prompt、session restore、approval、tool execution、verification、compaction、resume 都进入统一事件模型。
- 任何涉及文件写入的 turn，若未通过 verifier gate，不允许直接进入最终完成态。
- CLI / TUI / HTTP / headless 共享同一套 `ConversationEvent` 协议，不再各自维护独立的半兼容事件流。
- `XQoderAgent.run()` 收敛为 façade，`run-chat.ts` 收敛为 interface use case，不再继续膨胀为万能入口。
- 恢复 session 时，除 transcript 外，还能恢复至少：verification history、tool history、compaction summary、approval records、checkpoint metadata。

---

## 背景与上下文

- 项目/系统简介：`XQoder` 是一个 terminal-native AI coding assistant，当前包含 CLI、TUI、HTTP、runtime plugin、session store、tool execution、MVP runtime verifier 等能力。
- 技术栈/架构：TypeScript + Bun，采用 application/domain/infra/core 混合分层，存在新架构和历史实现并存情况。
- 已有约束/规范：
  - 优先最小改动，不做无关重构。
  - 保持现有 session store、tool registry、permissions、runtime plugin 生态可复用。
  - 不应让 UI 层决定 agent 下一步动作。
  - 不应把 plan、approval、verification 作为 prompt 约定交给模型自觉执行。
- 可用输入材料：
  - 当前仓库实现。
  - 用户给出的目标行为结构。
  - 参考产品行为抽象：Codex CLI / Claude Code / Gemini CLI。

### 当前仓库关键现状

当前仓库已经出现了部分正确方向的重构雏形，但还没有形成统一执行协议：

- 已有应用层会话循环雏形：
  - [src/application/chat/conversation-engine.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/conversation-engine.ts)
  - [src/application/chat/turn-intake.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/turn-intake.ts)
  - [src/application/chat/verification-bridge.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/verification-bridge.ts)
  - [src/infra/llm/provider-event-adapter.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/infra/llm/provider-event-adapter.ts)
- 历史核心仍然承担较多执行职责：
  - [src/core/agent/agent.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/agent.ts)
  - [src/core/agent/agent-tool-execution.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/agent-tool-execution.ts)
  - [src/core/agent/mvp/orchestrator.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/mvp/orchestrator.ts)
- session/transcript/verification 已有基础设施：
  - [src/core/agent/session/session.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/session/session.ts)
  - [src/core/agent/session/store.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/session/store.ts)
  - [src/domain/conversation/messages.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/domain/conversation/messages.ts)
  - [src/domain/conversation/events.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/domain/conversation/events.ts)
- CLI/TUI/HTTP 还在各自拼接事件和交互逻辑：
  - [src/application/chat/run-chat.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/run-chat.ts)
  - [src/platform/terminal/app/run-terminal-app.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/platform/terminal/app/run-terminal-app.ts)
  - [src/interfaces/http/server-stream.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/interfaces/http/server-stream.ts)
  - [src/core/agent/agent-provider.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/agent-provider.ts)

---

## 问题/需求定义

### 当前现象/需求

当前 XQoder 的主链已经不再完全耦合在 `agent.ts`，但新的 `application/chat/*` 体系还没有真正成为执行协议中心，导致以下问题：

- turn intake 仍偏向 prompt 归一化，而不是完整的 turn 建模。
- route、mode、plan、structured response 仍较多依赖 prompt 层约定。
- tool execution 和 verifier 虽已抽出桥接层，但仍未提升为协议级 gate。
- CLI / TUI / HTTP / headless 的事件流语义尚未完全统一。
- session resume 主要恢复 transcript 和派生信号，尚未稳定覆盖 approval/checkpoint/compaction 的完整恢复。
- `MvpRuntimeController` 仍承担部分对话流程语义，不利于统一 turn 状态机。

### 触发条件/使用场景

- 用户通过 CLI/TUI/HTTP/headless 发起普通聊天、读项目、计划任务、改代码、调试、review、恢复会话等请求。
- 模型在 turn 中发起 tool call，需要权限判断、checkpoint、执行、结果写回 transcript，并决定是否继续 loop。
- 写入后需要验证、重试、恢复或终止。
- 用户在运行中审批、拒绝、中断、追加输入或恢复先前 session。

### 预期行为

重构完成后，XQoder 应表现为一个以 Conversation Engine 为核心的 Agent CLI：

- 输入不是 prompt，而是 `TurnInput`。
- 输出不是字符串，而是 `ConversationEvent` 流。
- 模型只负责推理和提出 tool intent。
- Engine 负责 turn 生命周期、状态机、停止条件、恢复策略。
- Policy 负责权限判断。
- Tool Orchestrator 负责受控执行。
- Verifier 负责收敛，不允许“应该可以了”式假完成。
- CLI/TUI/HTTP/headless 只是 renderer 或 transport adapter。

---

## 范围与边界（强约束）

### 允许修改

- `src/application/chat/**`
- `src/domain/conversation/**`
- `src/infra/llm/**`
- 新增 `src/infra/tools/**`
- 新增 `src/infra/session/**`
- `src/core/agent/agent.ts`
- `src/core/agent/agent-provider.ts`
- `src/core/agent/mvp/**`
- `src/platform/terminal/app/**`
- `src/interfaces/http/**`

### 禁止修改

- 不应破坏现有对外 CLI 基本使用方式。
- 不应直接移除已有 session 持久化能力。
- 不应一次性推翻 runtime plugin / provider / tool registry 体系。
- 不应在未完成主链稳定前就引入复杂 subagent 调度重构。

### 限制

- 不允许无关重构。
- 优先复用已有 `AgentSession`、`SQLiteSessionStore`、`ToolRegistry`、`permissions`、`runtime plugin` 设施。
- 不确定处必须标注，不能编造未存在的系统能力。
- 先完成统一主链，再扩高级功能。

---

## 执行步骤（必须按顺序）

## 一、问题分析 / 行为建模

### 1. 对标行为拆解

Codex CLI、Claude Code、Gemini CLI 的共同点不是“模型更强”，而是都把一次用户输入视为一个可追踪 turn，并将 turn 拆为如下事件或阶段：

- intake
- routing
- planning
- approval
- tool use
- execution
- verification
- resume
- compaction
- final answer

### 2. 当前系统的表象问题

- 表象 1：`application/chat` 已存在，但还没有一套完整状态机。
- 表象 2：`run-chat.ts`、TUI、HTTP 还在各自拼装事件。
- 表象 3：verifier 还不是 edit task 的强制 gate。
- 表象 4：slash command 仅部分识别，未进入统一 command router。
- 表象 5：resume 是“恢复历史消息”，不是“恢复执行环境”。

### 3. 高概率根因

- 根因 1：执行协议没有唯一中心，导致 loop 语义散在多个模块。
- 根因 2：系统仍有较强的“prompt 驱动”思维，而不是“turn 驱动”思维。
- 根因 3：domain conversation events 与 runtime/app events 并存，缺少 canonical schema。
- 根因 4：MVP runtime controller 仍混有流程语义，conversation engine 还不是最终调度者。

### 4. 待验证原因

- 待验证 1：现有 HTTP/TUI 是否已依赖某些特定 legacy event shape，重构时需要 adapter 层兼容。
- 待验证 2：approval record 是否已经完整持久化，如果没有，需要新增 event store 或扩展 session metadata。
- 待验证 3：checkpoint 恢复粒度是否足以满足 `/restore` 的预期产品行为。

---

## 二、任务拆解（模块级）

重构应按以下模块分层进行：

### 1. 输入层

- `Turn Intake`
- `Command Router`
- `Task Classifier`

职责：

- 归一化用户输入。
- 明确 slash command 和普通 prompt 的分流。
- 决定 route、mode、是否可写、是否需要验证、是否允许工具。

### 2. 状态层

- `TurnState`
- `ConversationMode`
- `SessionBootstrap`
- `CheckpointState`

职责：

- 持有 turn 生命周期状态。
- 记录当前 mode、approval、tool execution、verification、resume 信息。

### 3. 执行层

- `ConversationEngine`
- `ProviderEventAdapter`
- `ToolOrchestrator`
- `PermissionGate`
- `VerificationBridge`

职责：

- 驱动 provider stream。
- 处理 tool call、permission、checkpoint、verification、recovery。
- 保证终止条件和错误收敛。

### 4. 持久化层

- `TranscriptStore`
- `EventStore`
- `CheckpointStore`
- `SessionStore`

职责：

- 保存消息、事件、verification history、tool history、compaction、approval、checkpoint。

### 5. 渲染层

- CLI renderer
- TUI renderer
- HTTP stream adapter
- headless consumer

职责：

- 只消费 `ConversationEvent`，不决定主循环。

---

## 三、逐模块施工单（核心）

## 模块 1：Turn Intake

### 1. 模块名称

`Turn Intake`

### 2. 模块职责

- 接收 CLI/TUI/HTTP/headless 的原始输入。
- 归一化为统一 `TurnInput`。
- 提取 slash command、附件、文件引用、entrypoint、session 目标。

### 3. 涉及文件路径

- [src/application/chat/turn-intake.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/turn-intake.ts)
- 新增：`src/application/chat/command-router.ts`
- 新增：`src/application/chat/task-classifier.ts`
- [src/platform/terminal/app/terminal-local-commands.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/platform/terminal/app/terminal-local-commands.ts)

### 4. 当前问题/能力缺失

- 当前 `turn-intake.ts` 主要处理 prompt、session、runtimeProfile。
- 未形成 `TurnInput` 的统一协议。
- slash command 仍主要停留在 TUI 层识别。

### 5. 根因分析

- 确定：输入建模还停留在“chat use case 输入”级别，而不是“turn 协议输入”级别。

### 6. 具体改动方案

- 将 `ChatTurnInput` 升级为更通用的 `ConversationTurnInput`：

```ts
export interface ConversationTurnInput {
  rawText: string
  normalizedText: string
  attachments: Attachment[]
  referencedFiles: string[]
  slashCommand?: SlashCommand
  cwd: string
  sessionId?: string
  entrypoint: 'cli' | 'tui' | 'http' | 'headless'
}
```

- 将 `resolveChatInteraction()` 的语义迁移到 `task-classifier.ts`。
- 新增 `command-router.ts`，优先解析：
  - `/plan`
  - `/implement`
  - `/review`
  - `/diff`
  - `/restore`
  - `/compact`
  - `/memory`
  - `/tools`
  - `/permissions`
  - `/resume`
  - `/status`
- TUI 仅负责把输入交给 router，不直接决定后续执行策略。

### 7. 改动注意事项

- 保持现有 `runNonInteractivePrompt`、`runChatMessageStream` 的入口兼容。
- 不要在 intake 层读取大量项目上下文。

### 8. 不允许的做法

- 不允许继续在 prompt 中让模型“猜” slash command。
- 不允许在 TUI 和 HTTP 中复制一套 intake 逻辑。

### 9. 改动后的预期行为

- 任意入口的输入都能统一解析为 `ConversationTurnInput`。
- 普通 prompt 和 slash command 从协议上分离。

### 10. 验收标准

- 新增测试覆盖 CLI/TUI/HTTP/headless 输入归一化。
- `/plan foo` 不再被当作普通自然语言 prompt。

### 11. 测试方式

- 手动：CLI/TUI/HTTP 分别输入 `/plan`、普通问题、带附件请求。
- 边界：空输入、纯空格、未知 slash command、同时带 sessionId 和 new session。

### 12. 风险点

- 若旧入口依赖 `ChatTurnInput` 特定字段名，迁移期间可能出现适配断层。

### 13. 回退方案

- 保留 `buildChatTurnInput()` 作为兼容封装，内部转调新 `buildConversationTurnInput()`。

---

## 模块 2：Command Router

### 1. 模块名称

`Command Router`

### 2. 模块职责

- 解析 slash command。
- 决定命令级 route、默认 mode、目标对象和是否进入模型。

### 3. 涉及文件路径

- 新增：`src/application/chat/command-router.ts`
- [src/platform/terminal/app/terminal-local-commands.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/platform/terminal/app/terminal-local-commands.ts)
- [src/platform/terminal/app/run-terminal-app.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/platform/terminal/app/run-terminal-app.ts)

### 4. 当前问题/能力缺失

- TUI 可以识别部分本地命令，但实现多数是 placeholder。
- HTTP/headless 未统一接入 slash command 语义。

### 5. 根因分析

- 确定：command 逻辑目前属于 UI 层本地行为，而不是 conversation runtime 的一部分。

### 6. 具体改动方案

- 定义：

```ts
export interface RoutedCommand {
  kind: 'plan' | 'implement' | 'review' | 'diff' | 'restore' | 'compact' | 'memory' | 'tools' | 'permissions' | 'resume' | 'status'
  args: string[]
  mode: ConversationMode
  entersModel: boolean
}
```

- `/plan`、`/review`、`/diff`、`/status` 可进入受限模式。
- `/compact`、`/restore`、`/permissions`、`/resume` 可直接走系统命令路径或受控 runtime path。

### 7. 改动注意事项

- 命令执行结果也要进入统一事件流，不应直接 stdout 输出后结束。

### 8. 不允许的做法

- 不允许继续在 `run-terminal-app.ts` 中堆更多本地分支逻辑。

### 9. 改动后的预期行为

- 所有命令都变成 runtime 一等入口。

### 10. 验收标准

- CLI/TUI/HTTP 对 `/plan`、`/status` 返回统一事件和结果。

### 11. 测试方式

- 手动：三种入口分别触发 `/status`、`/review`。

### 12. 风险点

- 某些现有 TUI 的即时本地反馈，需要改成事件驱动后重新适配显示。

### 13. 回退方案

- 初期保留 legacy TUI fallback；新 router 先接管非本地显示命令。

---

## 模块 3：Task Classifier

### 1. 模块名称

`Task Classifier`

### 2. 模块职责

- 将用户请求分类为统一任务类型。
- 产出 mode、tool policy、verification policy、context policy。

### 3. 涉及文件路径

- 新增：`src/application/chat/task-classifier.ts`
- [src/application/chat/interaction-router.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/interaction-router.ts)
- [src/core/runtime/runtime-decision.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/runtime/runtime-decision.ts)
- [src/core/agent/mvp/task-classifier.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/mvp/task-classifier.ts)

### 4. 当前问题/能力缺失

- 当前分类逻辑偏“prompt 风格/答题格式选择”，不是真正的执行策略分类。

### 5. 根因分析

- 确定：route 和 mode 还没有提升为执行协议输入。

### 6. 具体改动方案

- 定义统一任务类型：

```ts
export type TaskKind =
  | 'casual_chat'
  | 'project_question'
  | 'plan_only'
  | 'engineering_edit'
  | 'debug_fix'
  | 'code_review'
```

- 定义分类结果：

```ts
export interface TaskClassification {
  task: TaskKind
  mode: 'read_only' | 'plan' | 'workspace_write' | 'full_auto'
  needsProjectContext: boolean
  needsTools: boolean
  needsVerification: boolean
  requiresCheckpoint: boolean
  requiresReproduction: boolean
}
```

- 用规则优先，小模型兜底。
- 废弃 `usesStructuredResponse` 作为主决策信号。

### 7. 改动注意事项

- 分类结果应成为 engine 输入，不只是 prompt appendix 输入。

### 8. 不允许的做法

- 不允许把 plan mode 的“只读”约束仅写进 prompt。

### 9. 改动后的预期行为

- `mode` 真正影响权限、工具暴露和 verifier。

### 10. 验收标准

- “解释项目”被分类为 `project_question`。
- “修 bug 并跑测试”被分类为 `engineering_edit` 或 `debug_fix`。
- `/review` 被分类为 `code_review`。

### 11. 测试方式

- 单测覆盖分类规则。
- 边界：中英混合、含文件路径、含 command 语义、含 slash command。

### 12. 风险点

- 分类误判可能错误收紧或放宽权限。

### 13. 回退方案

- 对高风险任务允许显式 mode override。

---

## 模块 4：Context Builder

### 1. 模块名称

`Context Builder`

### 2. 模块职责

- 分层构建模型输入。
- 只加载必要上下文，避免一次性灌入全仓库。

### 3. 涉及文件路径

- 新增：`src/application/chat/context-builder.ts`
- [src/application/chat/prompt-composer.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/prompt-composer.ts)
- [src/application/chat/prompt-layers.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/prompt-layers.ts)
- [src/application/instructions/instruction-resolver.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/instructions/instruction-resolver.ts)

### 4. 当前问题/能力缺失

- 当前 `prompt-composer.ts` 仍较偏“拼 prompt 附录”。
- 项目解释场景会自动注入一批上下文，但不是系统性的分层 builder。

### 5. 根因分析

- 确定：context 还是“提示词拼接”思维，不是“runtime state + transcript + tool exposure”思维。

### 6. 具体改动方案

- 定义：

```ts
export interface ModelContext {
  system: string
  developer: string[]
  projectInstructions: InstructionBlock[]
  memory: MemoryBlock[]
  transcript: ConversationMessage[]
  toolDefinitions: ToolDefinition[]
  runtimeState: RuntimeState
}
```

- 第一阶段固定加载：
  - system policy
  - runtime policy
  - AGENTS.md / XQODER.md 指令
  - session summary
  - recent transcript
  - tool definitions
  - current turn
- 第二阶段通过工具按需获取：
  - read file
  - grep
  - glob
  - git diff
  - package scripts
  - test output

### 7. 改动注意事项

- 保留对 `AGENTS.md` 的兼容优先级。
- 不要默认塞整个 README、package.json、完整目录树。

### 8. 不允许的做法

- 不允许把 route、verification、approval 主要依赖 prompt 文本提醒实现。

### 9. 改动后的预期行为

- 模型输入更精简，但具备明确 runtime state。

### 10. 验收标准

- 普通聊天不自动加载项目全量上下文。
- `project_question` 可受控加载项目提示信息。

### 11. 测试方式

- 检查不同任务类型的上下文构建结果。

### 12. 风险点

- 若 builder 过度瘦身，模型可能缺少必要上下文。

### 13. 回退方案

- 保留现有 `maybeAugmentPromptWithProjectContext*` 作为临时兜底路径。

---

## 模块 5：Conversation Engine

### 1. 模块名称

`Conversation Engine`

### 2. 模块职责

- 驱动统一的 turn 生命周期。
- 组织模型调用、tool execution、approval、verification、recovery、completion。

### 3. 涉及文件路径

- [src/application/chat/conversation-engine.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/conversation-engine.ts)
- 新增：`src/domain/conversation/turn-state.ts`
- 新增：`src/domain/conversation/modes.ts`
- 新增：`src/domain/conversation/transcript.ts`

### 4. 当前问题/能力缺失

- 当前 conversation engine 仅负责 provider loop 和 tool follow-up。
- 没有完整状态机和统一 turn state。

### 5. 根因分析

- 确定：engine 还不是全系统唯一执行协议中心。

### 6. 具体改动方案

- 重新定义核心接口：

```ts
export interface ConversationEngine {
  runTurn(input: ConversationTurnInput): AsyncIterable<ConversationEvent>
}
```

- 将 engine 状态机显式化：

```ts
export type TurnStatus =
  | 'IDLE'
  | 'RECEIVING_INPUT'
  | 'ROUTING'
  | 'BUILDING_CONTEXT'
  | 'PLANNING'
  | 'AWAITING_APPROVAL'
  | 'RUNNING_MODEL'
  | 'AWAITING_TOOL_APPROVAL'
  | 'RUNNING_TOOL'
  | 'WRITING_TOOL_RESULT'
  | 'VERIFYING'
  | 'RECOVERING'
  | 'COMPACTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED_FOR_USER'
```

- 将当前循环升级为：

```ts
while (!turn.done) {
  const modelInput = contextBuilder.build(turn, session)

  for await (const event of providerAdapter.stream(modelInput)) {
    eventStore.append(event)
    emit(event)
    handleProviderEvent(turn, event)
  }

  if (turn.pendingToolCalls.length === 0) {
    finalizeAssistantMessage(turn)
    break
  }

  for (const call of turn.pendingToolCalls) {
    await toolOrchestrator.execute(call, turn.toolContext)
  }

  appendToolResultsToTranscript(turn)

  if (turn.hasFileWrites) {
    const verification = await verifier.verify(turn)
    if (!verification.ok) {
      await recover(turn, verification)
    }
  }

  if (!shouldContinue(turn)) {
    break
  }
}
```

- 引入强制停止条件：
  - max turns
  - max tool calls
  - max wall time
  - duplicate tool call detection
  - no-progress detection

### 7. 改动注意事项

- engine 不应直接依赖 OpenAI/Anthropic/Gemini 返回结构。
- engine 不应直接绑定某个 UI。

### 8. 不允许的做法

- 不允许在 engine 外部再做第二套 tool loop。

### 9. 改动后的预期行为

- 所有 turn 都有清晰状态迁移。
- 模型只提出 intent，不直接决定工具是否执行。

### 10. 验收标准

- CLI/TUI/HTTP/headless 全部通过 engine 执行 turn。
- 写文件后一定触发 verifier gate。

### 11. 测试方式

- 单测：tool loop、blocker loop、verification fail/retry、abort、max iterations。
- 手动：plan、edit、review、restore、compact。

### 12. 风险点

- engine 过度 centralize 时，可能引入兼容层复杂度。

### 13. 回退方案

- 保持现有 `runConversationEngine()` 名称，先重写内部语义，外部接口不立即破坏。

---

## 模块 6：Provider Event Adapter

### 1. 模块名称

`Provider Event Adapter`

### 2. 模块职责

- 统一 OpenAI / Anthropic / Gemini / 本地 provider 事件。

### 3. 涉及文件路径

- [src/infra/llm/provider-events.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/infra/llm/provider-events.ts)
- [src/infra/llm/provider-event-adapter.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/infra/llm/provider-event-adapter.ts)

### 4. 当前问题/能力缺失

- 当前事件类型还较简化，缺少 tool call start/delta/complete 等更细粒度事件。

### 5. 根因分析

- 确定：现阶段 adapter 主要为 conversation engine 服务，还未成为全局 provider normalization layer。

### 6. 具体改动方案

- 统一成如下结构：

```ts
export type ProviderEvent =
  | { type: 'message_start' }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_complete'; id: string; name: string; args: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'message_stop'; reason: 'end_turn' | 'tool_use' | 'max_tokens' }
  | { type: 'error'; error: Error }
```

- 为现有 provider 增加 adapter 层，不让 engine 处理 provider-specific shape。

### 7. 改动注意事项

- 兼容当前 `stream()` 与 `complete()` 双能力 provider。

### 8. 不允许的做法

- 不允许 conversation engine 继续直接依赖 provider callback 细节。

### 9. 改动后的预期行为

- 任何 provider 接入都只需实现 adapter。

### 10. 验收标准

- 现有 provider adapter 单测通过。

### 11. 测试方式

- 覆盖 callback + final response toolCalls 去重、fallback complete、stream error。

### 12. 风险点

- 若部分 provider 不暴露增量 tool args，需要 adapter 做聚合或降级。

### 13. 回退方案

- 保留当前 `ConversationProviderEvent` 作为兼容 alias，逐步迁移。

---

## 模块 7：Tool Orchestrator

### 1. 模块名称

`Tool Orchestrator`

### 2. 模块职责

- 统一组织 hook、permission、checkpoint、执行、结果回写。

### 3. 涉及文件路径

- 新增：`src/infra/tools/tool-orchestrator.ts`
- [src/core/agent/agent-tool-execution.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/agent-tool-execution.ts)
- [src/core/agent/hooks.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/hooks.ts)
- [src/core/agent/tools/tool.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/tools/tool.ts)

### 4. 当前问题/能力缺失

- 工具执行已相对集中，但仍附着在 agent 语义上。
- checkpoint 和 verification 触发逻辑分散。

### 5. 根因分析

- 确定：tool execution 还属于“agent 内部能力”，而不是 conversation protocol 基础设施。

### 6. 具体改动方案

- 定义：

```ts
export interface ToolExecutionRequest {
  id: string
  name: string
  args: unknown
  mode: PermissionMode
  cwd: string
  timeoutMs: number
}

export interface ToolExecutionResult {
  id: string
  name: string
  ok: boolean
  outputForModel: string
  outputForUser: string
  artifacts?: Artifact[]
  fileChanges?: FileChange[]
  error?: string
}
```

- 执行顺序固定：
  1. PreToolUse hooks
  2. permission check
  3. checkpoint if write/destructive
  4. execute tool
  5. collect stdout/stderr/artifacts/file changes
  6. PostToolUse hooks
  7. append tool result
  8. emit structured events

- 现有 `executeAgentToolCalls()` 下沉为 orchestrator 执行器或 compatibility layer。

### 7. 改动注意事项

- tool result 必须同时生成：
  - `outputForModel`
  - `outputForUser`
- 文件写入和 command history 应保留写回 `AgentSession`。

### 8. 不允许的做法

- 不允许工具只把结果显示给用户，不写回 transcript。

### 9. 改动后的预期行为

- tool execution 成为 engine 可控的标准动作。

### 10. 验收标准

- 每次 tool call 都有结构化开始、完成、结果、文件变化记录。

### 11. 测试方式

- 覆盖读工具、写工具、被拒绝工具、hook deny、question 工具、command tool。

### 12. 风险点

- 老的 tool registry 和新 orchestrator 的职责边界需要明确，否则会二次包装过深。

### 13. 回退方案

- 初期 orchestrator 仅包裹现有 `executeAgentToolCalls()`。

---

## 模块 8：Permission / Policy Gate

### 1. 模块名称

`Permission / Policy Gate`

### 2. 模块职责

- 根据 mode、路径、命令风险、网络、workspace 边界、secret、MCP trust 做最终决策。

### 3. 涉及文件路径

- 新增：`src/infra/tools/permission-gate.ts`
- [src/domain/permissions/tool-policy.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/domain/permissions/tool-policy.ts)
- [src/application/permissions/approval-flow.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/permissions/approval-flow.ts)

### 4. 当前问题/能力缺失

- 当前权限判断基础不错，但主视角仍偏“按工具名定模式”。

### 5. 根因分析

- 确定：permission 还没有和 turn mode 深度绑定。

### 6. 具体改动方案

- 固定 4 种 mode：
  - `read_only`
  - `plan`
  - `workspace_write`
  - `full_auto`

- 设计：

```ts
export interface PermissionRequest {
  toolName: string
  args: unknown
  mode: ConversationMode
  cwd: string
  projectRoot: string
  hasNetwork: boolean
  isDestructive: boolean
  touchesOutsideWorkspace: boolean
  touchesSensitivePath: boolean
  mcpTrust?: 'trusted' | 'unknown' | 'restricted'
}
```

- 输出：

```ts
export interface PermissionDecision {
  action: 'allow' | 'ask' | 'deny'
  reason?: string
}
```

### 7. 改动注意事项

- `full_auto` 也不等于无限制。
- 真正高风险模式若存在，应命名为 `dangerous_full_access`。

### 8. 不允许的做法

- 不允许把 plan mode 的写禁令留给模型自觉遵守。

### 9. 改动后的预期行为

- mode 真正成为权限系统输入。

### 10. 验收标准

- `plan` 模式下写工具和 destructive command 被阻止。
- `workspace_write` 模式下跨工作区写入要求审批。

### 11. 测试方式

- 单测权限矩阵。
- 边界：网络访问、敏感路径、工作区外编辑、危险 shell 命令。

### 12. 风险点

- 旧配置中的 `allow/ask/deny/auto` 语义需要迁移兼容。

### 13. 回退方案

- 先保留现有 permission settings，内部映射到新 gate。

---

## 模块 9：Verification Gate

### 1. 模块名称

`Verification Gate`

### 2. 模块职责

- 在写操作后执行强制验证。
- 决定通过、失败、重试、恢复、阻断完成。

### 3. 涉及文件路径

- [src/application/chat/verification-bridge.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/verification-bridge.ts)
- [src/core/agent/mvp/verifier.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/mvp/verifier.ts)
- [src/core/agent/mvp/orchestrator.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/mvp/orchestrator.ts)
- 新增：`src/application/chat/conversation-policy.ts`

### 4. 当前问题/能力缺失

- verifier 已存在，但仍主要绑定 MVP runtime，而不是所有 edit/debug task 的统一 gate。

### 5. 根因分析

- 确定：verification 还被视为 runtime 附件功能，而非 completion barrier。

### 6. 具体改动方案

- 引入统一接口：

```ts
export interface VerificationBridge {
  verify(turn: TurnState): Promise<VerificationResult>
}
```

- 规则：
  - `read_only` 不触发 verifier。
  - `engineering_edit` 至少检查 diff，并尽量运行相关 test。
  - `debug_fix` 强制 `reproduce -> fix -> verify`。
  - `refactor` 至少执行 `typecheck / lint / tests` 三选一。

- 拆解 `MvpRuntimeController`：
  - planner
  - verifier
  - recovery
  - stop evaluator
  - 不再持有主循环协议

### 7. 改动注意事项

- verifier 失败要进入 `RECOVERING`，而不是直接让模型回答失败总结然后结束。

### 8. 不允许的做法

- 不允许“应该可以了”“理论上已修复”直接完成。

### 9. 改动后的预期行为

- 所有写 turn 都经过统一 gate。

### 10. 验收标准

- 写文件但未验证通过时，turn 状态不是 `COMPLETED`。

### 11. 测试方式

- 覆盖成功、失败、失败后 retry、失败后 rollback、无测试命令、debug 无法复现。

### 12. 风险点

- 某些仓库没有标准 `test/lint/build` 脚本，需要 graceful fallback。

### 13. 回退方案

- 初期沿用当前 `runMvpVerification()` 作为 verifier backend。

---

## 模块 10：Transcript / Event Store / Checkpoint

### 1. 模块名称

`Transcript / Event Store / Checkpoint`

### 2. 模块职责

- 保存 messages 之外的全部执行事实。

### 3. 涉及文件路径

- [src/core/agent/session/session.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/session/session.ts)
- [src/core/agent/session/store.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/session/store.ts)
- 新增：`src/infra/session/session-store.ts`
- 新增：`src/infra/session/checkpoint-store.ts`
- 新增：`src/domain/conversation/transcript.ts`

### 4. 当前问题/能力缺失

- 当前系统主要存 message + metadata snapshot。
- 还未形成统一事件日志。

### 5. 根因分析

- 确定：session store 设计目标原本更偏 conversation history，而不是 turn event sourcing。

### 6. 具体改动方案

- 引入 canonical `ConversationEvent`：

```ts
export type ConversationEvent =
  | { type: 'session_started' }
  | { type: 'instructions_loaded'; files: string[] }
  | { type: 'user_message_accepted'; text: string }
  | { type: 'route_decided'; route: string; mode: string }
  | { type: 'context_loaded'; summary: string }
  | { type: 'plan_proposed'; plan: string }
  | { type: 'approval_requested'; reason: string }
  | { type: 'approval_granted' | 'approval_denied' }
  | { type: 'assistant_text_delta'; text: string }
  | { type: 'tool_call_requested'; id: string; name: string; args: unknown }
  | { type: 'tool_call_started'; id: string }
  | { type: 'tool_call_completed'; id: string; ok: boolean }
  | { type: 'checkpoint_created'; id: string }
  | { type: 'file_change_detected'; files: string[] }
  | { type: 'verification_started'; command: string }
  | { type: 'verification_completed'; ok: boolean; output: string }
  | { type: 'compaction_created'; summary: string }
  | { type: 'turn_completed'; response: string }
  | { type: 'turn_failed'; error: string }
  | { type: 'turn_cancelled' }
```

- `AgentSession` 继续存 snapshot。
- 新事件仓储补充保存 turn event stream。
- checkpoint store 单独保存回滚点元数据。

### 7. 改动注意事项

- 先双写，不要一次推翻现有 session store。

### 8. 不允许的做法

- 不允许只存 message 而丢失 approval / checkpoint / verification 过程。

### 9. 改动后的预期行为

- resume 能恢复真实执行环境，不只是聊天记录。

### 10. 验收标准

- session 恢复后能看到 verification / tool / compaction / approval 记录。

### 11. 测试方式

- 存储-恢复集成测试。

### 12. 风险点

- 双写期数据一致性需要关注。

### 13. 回退方案

- 若 event store 不稳定，resume 临时仍基于 snapshot，event store 仅作辅助信息。

---

## 模块 11：Renderer 与多表面接入

### 1. 模块名称

`Renderer / Surface Adapter`

### 2. 模块职责

- 把统一 `ConversationEvent` 映射到 CLI/TUI/HTTP/headless。

### 3. 涉及文件路径

- [src/application/chat/run-chat.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/application/chat/run-chat.ts)
- [src/platform/terminal/app/run-terminal-app.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/platform/terminal/app/run-terminal-app.ts)
- [src/interfaces/http/server-stream.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/interfaces/http/server-stream.ts)
- [src/core/agent/agent-provider.ts](/Users/wangxinglin/Documents/code/Xqoder-team-clean/src/core/agent/agent-provider.ts)

### 4. 当前问题/能力缺失

- 多个 surface 仍在自己组装不同事件。

### 5. 根因分析

- 确定：当前还处于 adapter 和历史实现并存阶段。

### 6. 具体改动方案

- `run-chat.ts` 改为 orchestration entry，不再自己翻译所有 agent callback。
- `agent-provider.ts` 改为 runtime provider adapter，不重做第二遍业务状态机。
- TUI/HTTP 只渲染 canonical events。

### 7. 改动注意事项

- 保留现有协议兼容层，避免一次性破坏测试和外部接口。

### 8. 不允许的做法

- 不允许 CLI/TUI/HTTP/headless 各自再定义一套 turn 语义。

### 9. 改动后的预期行为

- UI 可替换，核心逻辑不动。

### 10. 验收标准

- 三种 surface 对同一 turn 产生一致的语义事件序列。

### 11. 测试方式

- 对比集成测试。

### 12. 风险点

- 兼容层复杂度较高。

### 13. 回退方案

- 保留旧 event adapter，逐步迁移。

---

## 四、逐文件修改建议

### 1. `src/application/chat/run-chat.ts`

- 删除什么：
  - 不再直接承担完整 agent callback 到 AppEvent 的业务编排责任。
- 保留什么：
  - 非交互和流式入口的 use case 封装。
- 新增什么：
  - 调用统一 `ConversationEngine.runTurn()`。
  - 将 `ConversationEvent` 适配到现有 stream 输出格式。
- 影响面：
  - CLI、HTTP stream、team manager 等调用方。

### 2. `src/application/chat/turn-intake.ts`

- 删除什么：
  - 过于 chat-only 的字段命名和逻辑定位。
- 保留什么：
  - cwd/session/attachments 解析。
- 新增什么：
  - slash command、referenced files、entrypoint。

### 3. `src/application/chat/interaction-router.ts`

- 删除什么：
  - 作为主 route 决策者的地位。
- 保留什么：
  - 现有规则可迁移进 `task-classifier.ts`。
- 新增什么：
  - 可选作为 compatibility helper。

### 4. `src/application/chat/conversation-engine.ts`

- 删除什么：
  - 仅作为 provider/tool follow-up helper 的狭义定位。
- 保留什么：
  - provider stream loop 的骨架。
- 新增什么：
  - turn state machine、approval phase、recovery phase、compaction phase、stopping rules。

### 5. `src/application/chat/verification-bridge.ts`

- 删除什么：
  - 仅 runtime optional bridge 的定位。
- 保留什么：
  - 现有 appendedMessages 抽取逻辑。
- 新增什么：
  - turn policy 驱动、verification result 标准结构。

### 6. `src/core/agent/agent.ts`

- 删除什么：
  - 不应再扩张主循环逻辑。
- 保留什么：
  - façade、provider/tool/session 初始化、compatibility contract。
- 新增什么：
  - 只保留 engine 调用和依赖装配。

### 7. `src/core/agent/mvp/orchestrator.ts`

- 删除什么：
  - 对主循环和完成判断的主导职责。
- 保留什么：
  - verifier/recovery/stop 条件算法。
- 新增什么：
  - 拆解为 planner/verifier/recovery helpers。

### 8. `src/domain/conversation/events.ts`

- 删除什么：
  - 过于精简、无法覆盖完整 turn 的现有事件集合。
- 保留什么：
  - conversation event 作为 domain 真源的定位。
- 新增什么：
  - 完整 canonical event schema。

### 9. `src/platform/terminal/app/run-terminal-app.ts`

- 删除什么：
  - 大量命令分支中的业务编排。
- 保留什么：
  - terminal 渲染、输入、审批提问 UI。
- 新增什么：
  - 只消费 router + engine 事件。

### 10. `src/interfaces/http/server-stream.ts`

- 删除什么：
  - 任何潜在业务状态推断。
- 保留什么：
  - stream transport。
- 新增什么：
  - canonical event passthrough。

---

## 五、数据结构与流程

## 1. 核心数据结构

```ts
export interface ConversationTurnInput {
  rawText: string
  normalizedText: string
  attachments: Attachment[]
  referencedFiles: string[]
  slashCommand?: SlashCommand
  cwd: string
  sessionId?: string
  entrypoint: 'cli' | 'tui' | 'http' | 'headless'
}

export interface TurnState {
  id: string
  sessionId: string
  status: TurnStatus
  task: TaskClassification
  pendingToolCalls: ToolCall[]
  hasFileWrites: boolean
  requiresApproval: boolean
  checkpointId?: string
  verification?: VerificationResult
}
```

## 2. 事件/调用流程

```text
User Input
  -> Turn Intake
  -> Command Router
  -> Task Classifier
  -> Context Builder
  -> Conversation Engine
  -> Provider Event Adapter
  -> Tool Orchestrator
  -> Permission Gate
  -> Checkpoint / Verification / Recovery
  -> Transcript / Event Store
  -> Renderer
```

## 3. 状态流转

```text
IDLE
  -> RECEIVING_INPUT
  -> ROUTING
  -> BUILDING_CONTEXT
  -> PLANNING
  -> AWAITING_APPROVAL
  -> RUNNING_MODEL
  -> AWAITING_TOOL_APPROVAL
  -> RUNNING_TOOL
  -> WRITING_TOOL_RESULT
  -> VERIFYING
  -> RECOVERING
  -> COMPACTING
  -> COMPLETED

Any state
  -> FAILED
  -> CANCELLED
  -> PAUSED_FOR_USER
```

---

## 六、关键代码实现（必须提供）

## 1. Conversation Engine 核心接口

```ts
export interface ConversationEngine {
  runTurn(input: ConversationTurnInput): AsyncIterable<ConversationEvent>
}
```

## 2. Provider Adapter 接口

```ts
export interface ProviderAdapter {
  stream(input: ProviderRequest): AsyncIterable<ProviderEvent>
}
```

## 3. Tool Orchestrator 接口

```ts
export interface ToolOrchestrator {
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult>
}
```

## 4. Permission Gate 接口

```ts
export interface PermissionGate {
  evaluate(request: PermissionRequest): PermissionDecision
}
```

## 5. Verification Bridge 接口

```ts
export interface VerificationBridge {
  verify(turn: TurnState): Promise<VerificationResult>
}
```

## 6. 关键实现差异说明

### 修改前

- `agent.ts` 仍承担较强的 loop 语义。
- `run-chat.ts` 负责大量事件翻译和对话组织。
- verifier 更多是运行时附加逻辑。
- route/mode 仍大量依赖 prompt 层提示。

### 修改后

- `ConversationEngine` 持有唯一 turn 协议。
- `XQoderAgent.run()` 仅为 façade。
- UI 只消费事件。
- verifier 成为 edit/debug 完成前的必要 gate。
- mode 成为工具和权限系统的正式输入。

---

## 七、验证方案

## 1. 手动测试步骤

### 主流程 1：普通聊天

1. CLI 输入普通问答。
2. 确认 route 为 `casual_chat`。
3. 确认不暴露写工具。
4. 确认单次模型调用后完成。

### 主流程 2：问项目结构

1. TUI 输入“解释这个项目”。
2. 确认 route 为 `project_question`。
3. 确认进入只读模式。
4. 确认允许 list/read/grep。
5. 确认回答包含文件引用。

### 主流程 3：计划任务

1. 输入 `/plan 重构 agent loop`。
2. 确认 mode 为 `plan`。
3. 确认不会执行写操作。
4. 确认输出计划后停止。

### 主流程 4：改代码

1. 输入“修复 bug 并跑测试”。
2. 确认 route 为 `engineering_edit` 或 `debug_fix`。
3. 确认写前创建 checkpoint。
4. 确认写后触发 verifier。
5. 验证通过后才完成。

## 2. 边界测试

- 空输入。
- 同一 turn 中重复 tool call。
- 工具审批被拒绝。
- verifier 失败后 recovery。
- 恢复 session 后继续执行。
- context 接近窗口上限后 compaction。
- plan mode 中模型试图写文件。
- workspace 外路径写入请求。

## 3. 对比验证

- 对照目标产品行为，不对齐源码结构，只对齐产品行为结构：
  - turn 可追踪
  - tool result 写回 transcript
  - plan/approval/verification 是流程级一等环节
  - 可恢复
  - 多表面共享事件流

## 4. 失败判定标准

以下任一项出现，则视为未达标：

- 写文件后未经过 verifier 即完成。
- CLI/TUI/HTTP 各自产生不一致事件语义。
- slash command 仍依赖模型猜测。
- resume 无法恢复 verification/tool/compaction 事实。
- `run-chat.ts` 或 `XQoderAgent.run()` 继续膨胀为业务垃圾桶。

---

## 推荐实施优先级

按以下顺序落地，不建议跳步：

1. Turn Intake
2. Conversation Engine
3. Provider Event Adapter
4. Tool Orchestrator
5. Permission Gate
6. Verification Gate
7. Event Store
8. Resume / Compact
9. Hooks
10. Subagents

---

## 推荐目录结构

```text
src/application/chat/
  run-chat.ts
  turn-intake.ts
  command-router.ts
  task-classifier.ts
  conversation-engine.ts
  conversation-policy.ts
  tool-follow-up.ts
  verification-bridge.ts

src/domain/conversation/
  events.ts
  messages.ts
  transcript.ts
  turn-state.ts
  modes.ts

src/infra/llm/
  provider-events.ts
  provider-event-adapter.ts

src/infra/tools/
  tool-registry.ts
  tool-orchestrator.ts
  permission-gate.ts

src/infra/session/
  session-store.ts
  checkpoint-store.ts
```

---

## 最终建议

XQoder 不需要复刻 Codex / Claude Code / Gemini CLI 的源码组织方式，真正应复刻的是它们的产品行为结构和执行协议：

- 输入不是 prompt，而是 turn。
- 输出不是 string，而是 event stream。
- 工具不是裸函数调用，而是受权限与策略约束的 action。
- 会话不是 messages，而是 transcript + state + checkpoints。
- 完成不是模型说完成，而是 verifier gate 通过。
- CLI 不是壳，而是 conversation runtime 的 renderer。

因此，XQoder 的最终目标应明确为：

> 一个以 Conversation Engine 为核心的 Agent CLI。外层是 CLI/TUI/HTTP/headless，内层是统一 turn 状态机。模型负责推理，Engine 负责流程，Policy 负责权限，Tool Orchestrator 负责执行，Verifier 负责收敛。

最小可落地主链如下：

```text
User Input
  -> Turn Intake
  -> Route + Mode
  -> Context Build
  -> Model Stream
  -> Tool Call
  -> Permission
  -> Execute
  -> Tool Result
  -> Verify
  -> Follow-up Model
  -> Final Answer
  -> Persist Transcript
```

这条链比继续在 `agent.ts` 中叠加功能更稳，也更接近当前强 Agent CLI 的实际工作方式。
