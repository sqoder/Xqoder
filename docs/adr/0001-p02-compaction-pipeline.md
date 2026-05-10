# ADR 0001 — P02 四级压缩管线 + reactive 兜底

- Status: Accepted
- Date: 2026-05-10
- Phase: P02 (docs/openclaude-parity/phase-02-compaction-pipeline.md)

## 背景

P01/P01.1 之后主循环有 withRetry + stream idle watchdog,但 prompt 层面仍然只有
一驾马车式 `createAutoCompactionResult`——先爆 token、provider 再拒绝,没有
`PromptTooLongError` 兜底路径,tool_result 大文件一次就把 50KB 塞进历史。

## 决策

引入四级渐进压缩 + 一级 reactive 兜底,组合方式:

```
provider turn
  ├─ 成功 → maybeAutoCompact()
  │          ├─ ① applyToolResultBudget  (tool 消息 > 32KB → head + ellipsis + tail)
  │          ├─ ② snipCompactIfNeeded    (总字节 > 256KB → head + boundary + tail)
  │          ├─ ③ microcompact           (完整 tool 对 ≥ 10 → 合并最旧 5 对)
  │          └─ ④ autoCompact (既有)     (promptTokens > ctxWindow × 85%)
  └─ 失败 PromptTooLongError
             runTurnWithReactiveCompaction
             ├─ snip → 重试
             ├─ micro → 重试
             ├─ auto → 重试
             └─ exhausted → 抛出
```

4 个新 pure-function 模块,全部 ≤120 行,纯 `LLMMessage[] → LLMMessage[]`:

| 模块 | 职责 | 路径 |
|---|---|---|
| `applyToolResultBudget` | 单条 tool 消息截断到 head(8KB)+tail(4KB) | `src/core/agent/session/compaction/tool-result-budget.ts` |
| `snipCompactIfNeeded` | 保留 baseSystem + head(4) + boundary + tail(8);丢弃孤儿 tool_result | `src/core/agent/session/compaction/snip.ts` |
| `microcompact` | 按 id 配对 tool_use↔tool_result,多-id assistant 消息原子折叠 | `src/core/agent/session/compaction/microcompact.ts` |
| `reactive` | `nextReactiveStep` 状态机 + `applyReactiveStep` dispatcher | `src/core/agent/session/compaction/reactive.ts` |

应用层 wiring 抽进独立模块 `src/application/chat/compaction-pipeline.ts`,
不在 `conversation-engine.ts` 里继续堆代码。

## 触及的红线

**软红线** `src/application/chat/conversation-engine.ts`:

- 新增 2 行 import(从 `./compaction-pipeline.js`)
- 替换 `requestAssistantTurn(...)` 调用为 `runTurnWithReactiveCompaction(() => requestAssistantTurn(...), session, logger)`
- 删除原 `maybeAutoCompact` 内联实现(整体迁到 `compaction-pipeline.ts`)

净增 −21 行(1151 → 1130),file-size guardrail 从 FAIL 翻回 PASS。**硬红线文件
`verification-gate.ts` / `events.ts` 未触及**。

## 备选方案(已否决)

1. **把 4 级压缩全写进 `conversation-engine.ts`**。
   被否决:施工单本身 1151 行已经贴着红线,继续堆会再次越过 1000 行阈值。

2. **压缩阶段用 LLM 做 summary**(类似现有 `autoCompact` 那一支)。
   被否决:施工单明确限制"不允许调用 provider";4 级压缩要求纯函数以便测试
   覆盖 20+ 边界用例,加 I/O 后端侧 flake 会污染 golden task 结果。

3. **`microcompact` 逐位置折叠 tool_use/tool_result(按下标配对)**。
   被否决:同一 assistant 消息里可能带多个 `toolCalls[]`,位置配对会切半
   原子消息,构造出 schema 不合法的孤儿对。改用"按 id 收集 needed/found"策略,
   只有当 `toolCalls[].id` 全部找到匹配的 `tool_result` 时才把整组折叠掉。

4. **`reactive` 在内部调 `conversation-engine` 再跑一轮**。
   被否决:循环依赖风险 + 违反"reactive 里不调模型"约束。改成
   `runTurnWithReactiveCompaction<T>(runTurn, ...)` HOF,由 engine 注入
   `requestAssistantTurn` 做 thunk。

## 不确定项与缓解

- **`microcompact` 对 DAG 式 tool 调用(parallel tool_use)的处理**。
  当前实现:严格按 id 检查完整性,任何一个 id 没有匹配的 tool_result,
  整个 assistant 消息都不会被折叠。测试 `compaction-microcompact.test.ts::
  '多-id assistant message atomically'` 覆盖。

- **`snip` 时 tail 首条是 tool_result**。通过 `dropOrphanToolResults(tail,
  survivingToolUseIds)` 剥除;`surviving` 集合同时包含 baseSystem+head 与
  tail 内自带的 tool_use,因此 tail 内自闭合的对不会被误伤。测试
  `compaction-snip.test.ts::'drops orphan tool_result'` 覆盖。

- **200 轮 fixture 的随机分布**。使用 xorshift32 种子以保证可重放,
  每轮 1–2 个 tool_result,大小 1–64KB。当前种子下 budget 命中、snip 命中
  皆 >0,recent turn 用户输入 + 叙述回复俱存活,全部 tool_result 均有
  匹配的 tool_use id。

## 回退方案

`XQODER_DISABLE_ADVANCED_COMPACT=1` 环境变量 → 跳过 ①②③,回退到旧 ④ 单挡
`autoCompact`。reactive 兜底不受开关影响(仍在 try/catch 里,只是三挡分别退
化成 snip→auto、micro→auto、auto)。

## 验证

- `bun run release:check`: 669 tests / 0 fail; coverage 66.54% ≥ 36%;
  file-size guardrail PASS; security hygiene PASS; CLI smoke PASS。
- 新增 25 个 compaction 用例(5 文件)全部绿,其中 `compaction-pipeline-
  200turn.test.ts` 覆盖施工单 DoD 的 7 条判定。
- layering:`application` 仅通过 `@xqoder/agent` 接触压缩模块;
  `infra` 从未被 `application` 直接 import。`architecture-guardrails`
  测试未报警。

## 影响范围

- 新文件:10 个(4 pure 模块 + barrel + 5 测试 + 1 application wiring)
- 修改文件:3 个(`session.ts` 加 `replaceMessages`、`agent/index.ts` barrel
  转发、`conversation-engine.ts` 细节替换)
- 协议/事件:不变(`ConversationEventEnvelope` 未触碰)
- 外部依赖:不变
