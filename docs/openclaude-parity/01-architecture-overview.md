# 项目整体逻辑总谱（Logic Architecture Overview）

> 这份文档是整个复刻工程的"导航图"。
> 所有 phase-0X 施工单都建立在本文件定义的分层、契约、数据流、事件协议之上。
> 施工过程中**任何与本文件冲突的行为都视为 bug**。

## 0. 一句话总览

XQoder 的 agent 主链 = **一个有限状态机 + 一条事件流 + 多条流水线**。

- 有限状态机 = `QueryEngine`（主循环）。
- 事件流 = `ConversationEventEnvelope`（协议层唯一对外形状）。
- 流水线 = `provider / compaction / tools / permissions / hooks / cache / telemetry / session`。

整条主链 **单向**：`Input → State → Effects → Event`。
UI（TUI / HTTP / SDK / VSCode）**只消费事件**，不参与决策。

## 1. 分层清单（硬边界）

```
┌───────────────────────────────────────────────────────────┐
│ interfaces/**      ←  交互表面（CLI / HTTP / TUI / SDK）     │
├───────────────────────────────────────────────────────────┤
│ bootstrap/**       ←  进程启动 / 参数分流 / fast-path       │
├───────────────────────────────────────────────────────────┤
│ application/**     ←  业务用例编排（use-case）             │
│   ├─ application/chat          （ConversationEngine 薄层） │
│   ├─ application/sessions                                 │
│   ├─ application/permissions                              │
│   ├─ application/instructions / memory / integrations     │
├───────────────────────────────────────────────────────────┤
│ core/**            ←  领域实现（有状态、有资源）           │
│   ├─ core/runtime              （QueryEngine / 主循环）    │
│   ├─ core/agent                （Session / tools / MCP）   │
│   ├─ core/tools                （orchestrator / partition）│
│   ├─ core/auth                 （OAuth / credentials）     │
│   ├─ core/skills / plugins                                │
│   ├─ core/tasks / cron / worktree / coordinator / daemon  │
│   ├─ core/memory                                          │
│   ├─ core/output-styles                                   │
│   ├─ core/thinking                                        │
├───────────────────────────────────────────────────────────┤
│ infra/**           ←  外部技术（无业务语义）               │
│   ├─ infra/llm                 （provider / shim / retry） │
│   ├─ infra/llm/routing         （provider 选路）           │
│   ├─ infra/llm/usage           （usage 归一化）            │
│   ├─ infra/permissions         （classifier-provider）     │
│   ├─ infra/plugins / mcp / lsp                            │
│   ├─ infra/shared              （config / types / proxy）  │
├───────────────────────────────────────────────────────────┤
│ domain/**          ←  纯类型 + 纯函数（零依赖）             │
│   ├─ domain/conversation       （Event / Message 契约）    │
│   ├─ domain/permissions                                   │
│   ├─ domain/budgeting / memory / workspace / session      │
├───────────────────────────────────────────────────────────┤
│ shared/**          ←  跨层纯工具（errors / utils / schema） │
└───────────────────────────────────────────────────────────┘
```

### import 允许矩阵

| 调用方 \ 被调 | shared | domain | infra | core | application | bootstrap | interfaces |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| shared | ✔︎ |   |   |   |   |   |   |
| domain | ✔︎ | ✔︎ |   |   |   |   |   |
| infra | ✔︎ | ✔︎ | ✔︎ |   |   |   |   |
| core | ✔︎ | ✔︎ | ✔︎ | ✔︎ |   |   |   |
| application | ✔︎ | ✔︎ | ✔︎ | ✔︎ | ✔︎ |   |   |
| bootstrap | ✔︎ | ✔︎ | ✔︎ | ✔︎ | ✔︎ | ✔︎ |   |
| interfaces | ✔︎ | ✔︎ |   | ✔︎（事件消费） | ✔︎ | ✔︎ | ✔︎ |

- 箭头**方向不得反转**。
- `interfaces` 禁止 import `infra`（避免 UI 直连 provider）。
- `domain` 禁止出现任何 `import` 第三方包（纯类型 + 纯函数）。

## 2. 端到端流程（一次 `xqoder chat "hello"`）

```
[user keypress]
      │
┌─────▼───────────────────────────────────────────────────┐
│ ① bootstrap/cli-main.ts                                 │
│    ├─ fast-path --version / --dump-system-prompt / ...  │
│    ├─ enableConfigs()（feature flags）                  │
│    ├─ --provider / --model 注入 env                     │
│    └─ 进 compose.runMain()                              │
└─────┬───────────────────────────────────────────────────┘
      │
┌─────▼───────────────────────────────────────────────────┐
│ ② bootstrap/compose.ts                                  │
│    组装：logger, config, session store, provider factory,│
│          permission gate, tool registry, MCP manager,   │
│          hook registry, skill registry, plugin loader   │
└─────┬───────────────────────────────────────────────────┘
      │
┌─────▼───────────────────────────────────────────────────┐
│ ③ interfaces/cli（或 tui / http / sdk）调 application    │
│    → application/chat/run-chat.runChat(opts)            │
└─────┬───────────────────────────────────────────────────┘
      │
┌─────▼───────────────────────────────────────────────────┐
│ ④ application/chat/run-chat                             │
│    ├─ turn-intake（slash / @file / memdir / hooks）     │
│    ├─ command-router / interaction-router               │
│    ├─ 组装 prompt layers                                │
│    └─ 调 ConversationEngine.runTurn(input)              │
└─────┬───────────────────────────────────────────────────┘
      │
┌─────▼───────────────────────────────────────────────────┐
│ ⑤ core/runtime/query-engine.submitMessage(input)        │
│    (v2 从 application/chat/conversation-engine 抽出)    │
│    事件 emitter: ConversationEventEnvelope              │
│                                                         │
│    while (!stopped):                                    │
│      ⑤a tokenBudget.estimate()                          │
│      ⑤b compaction.applyIfNeeded()                      │
│          （budget → snip → micro → collapse → auto）    │
│      ⑤c hook: PreSampling（可选）                       │
│      ⑤d provider-turn.run()                             │
│            ├─ routing.resolveProviderRequest()          │
│            ├─ provider.stream()  ← withRetry            │
│            ├─ openaiShim / codexShim / anthropic        │
│            ├─ Anthropic cache_control 注入              │
│            ├─ 流 → ThinkingTokenExtractor               │
│            ├─ 流 → onToken / onThinkingToken            │
│            └─ finishReason: stop | tool_calls | length  │
│      ⑤e 若 tool_calls:                                  │
│            ├─ partitionToolCalls                        │
│            ├─ 并发批: Promise.all(runToolUse)           │
│            │     ├─ hook: PreToolUse                    │
│            │     ├─ permission: decide()                │
│            │     │   ├─ mode=plan/acceptEdits/auto      │
│            │     │   └─ auto+shell → yoloClassifier     │
│            │     ├─ tool.call(args, ctx)                │
│            │     ├─ hook: PostToolUse / Failure         │
│            │     └─ autoFix?（lint/type）               │
│            └─ tool_result 追加 → 回 ⑤a                  │
│      ⑤f 若 stop:                                        │
│            ├─ hook: Stop                                │
│            └─ 退循环                                    │
│      ⑤g stopHooks: max_turns / duplicate / no_progress  │
└─────┬───────────────────────────────────────────────────┘
      │
┌─────▼───────────────────────────────────────────────────┐
│ ⑥ session 持久化                                        │
│    - 每条消息 → session.addMessage（SQLite）            │
│    - usage → session.recordUsage                        │
│    - tool_use/result → toolHistory                      │
│    - approval / verification / compaction → metadata   │
│    - 文件改动 → fileHistory snapshot                    │
└─────┬───────────────────────────────────────────────────┘
      │
┌─────▼───────────────────────────────────────────────────┐
│ ⑦ hook: SessionEnd（turn 完成后）                       │
│    telemetry sink: session.ended / totalUsage           │
└─────┬───────────────────────────────────────────────────┘
      │
      ▼
[interfaces 消费 envelope 流，渲染给用户]
```

## 3. 核心数据结构（domain/**）

### 3.1 Message / ToolCall / ToolResult

```ts
// domain/conversation/messages.ts
type Role = 'system' | 'user' | 'assistant' | 'tool';

interface LLMMessage {
    role: Role;
    content: string | ContentPart[];
    toolCalls?: ToolCall[];     // 仅 assistant
    toolCallId?: string;        // 仅 tool
    attachments?: MessageAttachment[];
    thinking?: string;          // 仅 assistant；extended-thinking 专用
}

interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

interface ToolResult {
    toolCallId: string;
    success: boolean;
    output: string;
    error?: string;
    attachments?: MessageAttachment[];
}
```

**不变量**：`assistant.toolCalls[i].id` 与后续 `tool.toolCallId` 必须一一配对；
压缩、排序、裁剪 **任何操作后** 这个配对都不能破坏。

### 3.2 Session（core/agent/session）

```ts
interface AgentSession {
    id: string;
    cwd: string;
    createdAt: Date;
    messages: LLMMessage[];       // 运行时有序
    baseSystemMessage: LLMMessage | undefined;
    toolHistory: AgentToolExecution[];
    commandHistory: AgentCommandHistoryEntry[];
    fileChanges: AgentFileChangeEntry[];
    usage: AgentSessionUsage;     // 累计
    metadata: SessionMetadata;    // permissionMode/activatedSkills/...
}
```

### 3.3 事件协议（domain/conversation/events.ts）

所有 UI / 外部集成都只看这 12 种事件：

| 类型 | 字段 | 触发时机 |
|---|---|---|
| `session.started` | `{ cwd }` | 新 session 第 1 次 run |
| `session.resumed` | `{ messageCount }` | resume 后第 1 次 run |
| `message.started` | `{ message: { id,role,content,createdAt,attachments? } }` | 每条消息开始 |
| `message.delta` | `{ messageId, role, text }` | assistant 流式 token |
| `message.completed` | `{ message }` | 消息终版 |
| `thought` | `{ text }` | thinking 流 |
| `status.changed` | `{ status: idle/thinking/running-tool/awaiting-approval/done/error, stopReason? }` | 状态翻页 |
| `tool.called` | `{ tool, args }` | tool 调用开始 |
| `tool.output` | `{ tool, output, partial?, stream? }` | tool 输出（可流式） |
| `tool.completed` | `{ tool, success }` | tool 结束 |
| `approval.requested` | `{ requestId, kind, summary, payload }` | 审批请求 |
| `approval.resolved` | `{ requestId, decision }` | 审批完成 |
| `question.requested/resolved` | 同上但 kind=question | 结构化问卷 |
| `verification.completed` | `{ ok, blocked, summary }` | verifier 结束 |
| `usage` | `{ model, promptTokens, completionTokens, totalTokens, cost?, cacheRead?, cacheCreate? }` | 每轮 provider 完成 |

**协议契约**：
- envelope 字段**只允许追加，不允许删除 / 改类型**。
- 生产者写入 `source: 'agent' | 'ui' | 'runtime' | 'tool' | 'plugin' | 'sync'`。
- 每个 envelope 带 `sessionId`、`timestamp`、`streamId`。

## 4. 核心流水线（Pipelines）

每条流水线都是 **函数组合**，输入明确、输出明确，无全局状态。

### 4.1 Provider Pipeline（phase-01 / 05 / 07 / 08）

```
CompletionRequest
  ▼
routing.resolveProviderRequest(ctx)          ← phase-07
  ▼ ResolvedProvider {kind, baseUrl, auth, model, betas}
buildProviderClient(resolved)                ← factory
  ▼
withRetry(                                   ← phase-01
    { providerName, foreground, refreshOauthToken },
    () => client.stream(params)
)
  ▼ raw SDK stream
classify 错误 / 退避 / fallback
  ▼
shim.openaiStreamToInternal(...)             ← phase-05
  ├─ convertMessages / convertTools
  ├─ openaiSchemaSanitizer
  ├─ ThinkingTokenExtractor (phase-20)
  ├─ thinkTagSanitizer (phase-08)
  ├─ compressToolHistory 请求前瘦身 (phase-08)
  ├─ toolArgumentNormalization
  └─ repairPossiblyTruncatedObjectJson
  ▼ CompletionResponse { message, usage, finishReason }
```

**错误分类表**（phase-01 定义，全栈共用）：

| kind | 来源 | 处理 |
|---|---|---|
| `throttle` | 429/503 + Retry-After | 指数退避最多 5 次 |
| `overload` | 529 / Anthropic overloaded_error | 仅 foreground, 退避 3 次 |
| `oauth401` | 401 + WWW-Authenticate Bearer error= | 刷 token 重试 1 次 |
| `transient` | ECONNRESET / EPIPE / ETIMEDOUT | 立即重试 3 次 |
| `stream_idle` | 120s 无 chunk | 抛出，上层可换 non-stream 试 1 次 |
| `prompt_too_long` | 400 + body 匹配 "prompt is too long / context length" | 抛出 → reactive compaction (phase-02) |
| `fatal` | 其它 4xx | 不重试 |

### 4.2 Compaction Pipeline（phase-02 / 09）

按**升序**执行：前一步足够压缩就不进入下一步。

```
messages_in
  ▼
① applyToolResultBudget (32KB/条)
  ▼
② snipCompactIfNeeded  (总字节 > 256KB → 保留头 4 + 尾 8 + boundary)
  ▼
③ microCompact (tool 对 ≥ 10 → 合并最旧 5 对)
  ▼
④ cachedMicrocompact (Anthropic 下开 CACHED_MICROCOMPACT beta)
  ▼
⑤ autoCompact (messages.length > maxMessages → 总结为 system)
  ▼
⑥ contextCollapse (连续多轮 tool 折叠为 collapsed_view，投影)
  ▼
messages_out

reactive：如果 provider 抛 PromptTooLongError
  → recoverStep = snip → micro → auto → exhausted
```

**不变量**：压缩 **永远不动** `baseSystemMessage`；`tool_use ↔ tool_result` 配对守恒；
`activatedSkills` 不会被 compact 丢弃。

### 4.3 Permission Pipeline（phase-04 / 04-addendum）

```
tool_use {name, input}
  ▼
resolveToolPermissionMode(name, input, session):
  ├── mode === 'bypassPermissions'  → 'allow'
  ├── mode === 'plan'                 → 只读工具 'allow' 否则 'deny'
  ├── mode === 'acceptEdits'          → 编辑类 'allow' 否则按 default
  ├── mode === 'auto' && isShell
  │     └─ decideShellPolicy(cmd, session)
  │         ├── classifyByRule (safe/dangerous pattern)
  │         └─ classifyByLlm (stage1 → stage2)   ← feature YOLO
  ├── mode === 'deny'                 → 'deny'
  └── mode === 'default'              → 'ask'
  ▼
若 'ask' → approval.requested event → 等 UI/user → approval.resolved
若 'allow' → PreToolUse hook → tool.call → PostToolUse hook
若 'deny'  → 生成 is_error tool_result
```

**Denial tracking**：同一 session 被 classifier deny ≥ 3 次后，
后续 LLM 返回 block 的结果降级为 `ask`（把决定权交回用户）。

### 4.4 Tool Pipeline（phase-12）

```
assistant 返回 [call1, call2, call3, call4, call5]
  ▼
partitionToolCalls(calls, registry)
  → [{concurrent:true, calls:[c1,c2]},
     {concurrent:false, calls:[c3]},
     {concurrent:true, calls:[c4,c5]}]
  ▼
for batch of batches:
  if concurrent: Promise.all(runToolUse)
  else:          顺序 await runToolUse
    ▼
    runToolUse(call, ctx):
      ├─ abort check
      ├─ canUseTool → permission (上表)
      ├─ hook: PreToolUse → may modify/deny/ask
      ├─ tool.call(args, ctx)
      ├─ hook: PostToolUse / PostToolUseFailure
      ├─ autoFixRunner(result) ← 对 write 类工具启用
      └─ produce ToolExecutionResult:
           - toolHistoryEntry
           - commandHistory / fileChanges
           - modelMessages (tool_result)
           - rendererEvents (tool.output/completed)
           - transcriptEntries
           - eventStoreRecords
           - checkpoint info
```

### 4.5 Hook Pipeline（phase-14）

同一事件可注册 N 个 handler，按序执行；
任一返回 `decision: 'deny'` → short-circuit 返回 deny；
`additionalContext` 会合并注入下游（比如 PreToolUse 加上下文，assistant 能看到）。

事件清单：

```
PreToolUse / PostToolUse / PostToolUseFailure
UserPromptSubmit
SessionStart / SessionEnd
Stop / SubagentStop
PreCompact / PostCompact
```

Handler 三种：`command / http / agent`（见 phase-14）。

### 4.6 Cache & Usage Pipeline（phase-03 / 15）

```
prompt-layers
  ▼ splitStablePrefix
  { prefix: [identity, tools, memory, skills, mcp, output-style],
    tail:   [token_budget, scratchpad, append] }
  ▼ anthropic provider 拼装
  system: [prefix_text, { type:'text', text:'', cache_control:ephemeral }, tail_text]
  messages[-1].content[-1].cache_control = ephemeral
  ▼ API
  response.usage.cache_creation_input_tokens / cache_read_input_tokens
  ▼ normalizeUsage (phase-15)
  NormalizedUsage { input, output, cacheRead, cacheCreate, ... }
  ▼
  cacheStatsTracker.record  + cost-tracker  + session.recordUsage
  ▼
  event: usage { cost, cacheRead, cacheCreate }
  ▼
  telemetry.sink.log(event)
```

### 4.7 Session Lifecycle Pipeline（phase-24）

```
create / resume
  ▼
hook: SessionStart
  ▼
每 turn：
  user message → session.addMessage
  每个 assistant 返回 → session.addMessage
  每个 tool_use/result → session.toolHistory append
  每次 compact → session.metadata.compactionSummary
  每次 approval → session.metadata.approvals append
  每次 fileWrite → fileHistory snapshot
  ▼
hook: SessionEnd
  ▼
close / persist
```

`rewind(messageIndex)` 生成**分支 session**（parent 指向原 session），
不破坏原消息。`teleport` 导出 `{session meta + messages + file snapshots}` 到
可信 URL，另一台机器按签名导入。

## 5. 模块依赖图（按 phase 梯度）

```
┌─────────────────── Layer 0: 基础设施 ────────────────────┐
│ feature-flags (P10)  errors & classify (P01)             │
│ session SQLite store (已有)    logger / proxy (已有)      │
└───────────┬──────────────────────────────────────────────┘
            │
┌───────────▼────────── Layer 1: provider 核心 ────────────┐
│ withRetry (P01)  routing (P07)                           │
│ openaiShim (P05)  codexShim + compressToolHistory (P08)  │
└───────────┬──────────────────────────────────────────────┘
            │
┌───────────▼────────── Layer 2: 主循环 ───────────────────┐
│ compaction 四级+reactive (P02)  prompt cache (P03)       │
│ queryEngine / queryLoop (P09)  tokenBudget / stopHooks   │
└───────────┬──────────────────────────────────────────────┘
            │
┌───────────▼────────── Layer 3: 输入 / 工具 / 权限 ───────┐
│ input preprocessing (P11)                                │
│ tool orchestration / partition / autoFix (P12)           │
│ permission modes + yolo classifier (P04 + addendum)      │
└───────────┬──────────────────────────────────────────────┘
            │
┌───────────▼────────── Layer 4: hook / mcp / agent ───────┐
│ lifecycle hooks 10 元 (P14)                              │
│ MCP 全家桶 (P13)                                         │
│ Agent tool + 5 built-in subagent + forkSubagent (P16)    │
│ skills + output styles (P17)                             │
└───────────┬──────────────────────────────────────────────┘
            │
┌───────────▼────────── Layer 5: 生态与运维 ───────────────┐
│ plugins (P18)  cost / telemetry (P15)                    │
│ thinking/effort/fast (P20)  oauth (P21)                  │
│ tasks/cron/worktree/coordinator (P19)                    │
│ session lifecycle / resume / rewind (P24)                │
└───────────┬──────────────────────────────────────────────┘
            │
┌───────────▼────────── Layer 6: 对外接口 ─────────────────┐
│ CLI fast-path + feature flags runtime (P10)              │
│ SDK / ndjson I/O (P26)                                   │
│ tools catalog 40+（P27）                                 │
│ bridge / daemon / remote (P25)                           │
└───────────┬──────────────────────────────────────────────┘
            │
┌───────────▼────────── Layer 7: TUI（最后做） ────────────┐
│ Ink REPL skeleton (P06)                                  │
│ Ink messages / diff / tools (P22)                        │
│ keybindings / vim / history (P23)                        │
└──────────────────────────────────────────────────────────┘
```

**关键原则**：
- Layer N 永远不 import Layer ≥ N+1。
- 每一层都必须在**没有 Layer 7** 的情况下可用（headless 模式 / 测试模式）。
- TUI 是 Layer 7，它只消费 `ConversationEventEnvelope`，不参与决策。

## 6. 日常数据流三张"秒表"

### 6.1 一次 LLM 调用（热路径）

```
chat "foo"
 → turn-intake（~2ms）
 → prompt-layers 组装（~5ms）
 → routing.resolveProviderRequest（~1ms）
 → withRetry 包裹（~0ms）
 → provider SDK 握手（~100ms）
 → 首 token（~300ms）
 → 流式 token（...）
 → message_stop
 → usage 归一化（~1ms）
 → session.recordUsage（~2ms）
 → event emit
```

### 6.2 一次工具调用（热路径）

```
tool_use block
 → partition（O(n)）
 → permission decide（~0.5ms rule / ~300ms LLM classifier 开启时）
 → PreToolUse hook（~5ms / 命令 hook 150ms）
 → tool.call（工具特定：read 2ms / shell 50ms-∞）
 → PostToolUse hook
 → autoFixRunner（~200ms lint）
 → tool_result 回填
```

### 6.3 一次 compact

```
每轮 provider 结束后:
 estimateTokenBudget（~1ms）
 ├─ applyToolResultBudget（~2ms / 条超额）
 ├─ snipCompactIfNeeded（~5ms）
 ├─ microCompact（~10ms / 合并 5 对）
 ├─ cachedMicrocompact（~1ms 标记）
 └─ autoCompact（~500ms，需调 summarizer subagent）
```

## 7. 错误传播契约

```
LLMError / ClassifiedLLMError
  ├── ThrottleError        → retryable
  ├── OverloadError        → retryable (only foreground)
  ├── OAuth401Error        → retryable after refresh
  ├── TransientIOError     → retryable (low backoff)
  ├── StreamIdleError      → unwrap, try non-stream
  ├── PromptTooLongError   → trigger reactive compaction
  └── FatalLLMError        → bubble up

XqoderError (非 provider)
  ├── ConversationEngineStopError { stopReason }
  ├── MaxContextError
  ├── PermissionDeniedError
  ├── ToolExecutionError
  ├── HookDeniedError
  └── SessionIntegrityError

AbortError (DOMException)  → propagate silently (signal.aborted)
```

**契约**：
- infra 层抛 `LLMError` 的子类。
- core 层抛 `XqoderError` 的子类。
- application 层**捕获所有**上述错误，转换为 `ConversationEventEnvelope` 的
  `status.changed { status:'error' }` + `message.completed { content: '[…]' }`。
- interfaces 层**不应**看到原始 `Error`。

## 8. 每层测试策略

| 层 | 最低覆盖 | 测试类型 | 样例 |
|---|---|---|---|
| shared | 90% | 纯 unit | errors 分类 |
| domain | 100% | 纯 unit | 事件 shape 不变 |
| infra | 80% | unit + mock | withRetry / shim / provider |
| core | 70% | unit + integration | queryLoop / compaction / permission |
| application | 60% | integration | ConversationEngine 事件序列 |
| bootstrap | 冒烟 | e2e | `xqoder --version` < 30ms |
| interfaces | 冒烟 | e2e | stdin ndjson round-trip |

## 9. 看这份文档时你最该盯的 6 件事

1. **事件协议不变量**（第 3.3 节表格）——这是 TUI 最后做的理由：事件先稳，
   UI 才不返工。
2. **错误分类 7 种**（第 4.1 节）——所有后续稳定性工作都要对齐这张表。
3. **压缩 6 级 + reactive**（第 4.2 节）——长对话不爆的核心。
4. **权限决策树**（第 4.3 节）——autoFix / autopilot 体验全靠它。
5. **import 方向矩阵**（第 1 节）——防止架构腐坏的第一道防线。
6. **Layer 7 独立原则**——TUI 完全可插拔，headless 全功能可用。

---

**下一步建议（因为"TUI 最后做"）**：

1. 读 `02-execution-order-logic-first.md`（下一份）确认执行顺序。
2. 按执行顺序逐期落地 phase-01 → phase-27（跳过 phase-06/22/23），
   主链完成后再接 TUI。
3. 每完成一期都对齐 README 的 fidelity 矩阵，把该层分数从当前→目标更新。
