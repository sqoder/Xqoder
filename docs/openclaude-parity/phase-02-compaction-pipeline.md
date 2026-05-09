# Phase 02 · 压缩管线四驾马车

## 任务目标（必须可验证）

把现有"一驾马车"式的 `createAutoCompactionResult` 扩展成
`applyToolResultBudget → snipCompactIfNeeded → microcompact → autocompact`
四级渐进压缩 + `PromptTooLongError` 兜底重入。

### 成功判定

- 跑一条 200 轮的模拟对话（test fixture 回放），每轮随机写入
  1–2 个大 `tool_result`（每个 1–64 KB）。对话结束时：
  - 总 messages 数 ≤ `compaction.max` 配置值。
  - 最近 4 轮（`keepRecentTurns=4`）无摘要替换。
  - 有至少一次 `applyToolResultBudget` 命中（test 计数断言）。
  - 有至少一次 `snipCompactIfNeeded` 命中。
  - 不触发 `createAutoCompactionResult`（除非强制把 `maxMessages=10` 调小）。
- 当 provider 抛 `PromptTooLongError`（Phase 01 的新错误）时，
  `conversation-engine` 先调一次 `reactiveCompact()`，再重试同一轮；
  连续 3 次失败才向上抛。
- 全部新增函数都是 **纯函数**（无 I/O），方便测试。

---

## 背景与上下文

- **已有函数**（保留语义，不改签名）：
  - `createAutoCompactionResult`（`src/core/agent/session/session-compaction.ts`）
    把全量历史总结成一条 system 消息。
  - `AgentSession.compactIfNeeded()` 在 `addMessage` 后触发。
- **消息量主入口**：`conversation-engine.ts::maybeAutoCompact(usage, deps)`。
- **总体约束**：压缩永远 **不动** `baseSystemMessage`；`tool_use ↔ tool_result`
  成对出现，压缩过程中必须保持配对，否则 OpenAI/Anthropic 侧会报 schema 错。

---

## 问题/需求定义

### 当前现象

- `tool_result` 大文件读取一次就塞 50KB 到历史，8 轮就爆 400KB。
- `createAutoCompactionResult` 只在 messages 条数超 `maxMessages` 后才触发，
  这意味着 token 先爆，API 才拒绝。
- 没有 `PromptTooLongError` 兜底重入路径。

### 触发条件

- 读大文件、长 shell output、网络抓取、LSP dump。
- 长 multi-turn 代码调试。

### 预期行为

- 大 tool_result → 当场截断并保留 `[truncated]` 摘要；原文以摘要形式存
  `ToolExecutionHistory`，模型看不到完整文本但看得到位置。
- 连续多轮后按 snip（保留头尾，中段折叠）→ micro（旧 tool 对合并为 sum）→
  auto（全段重写为单 system 消息）逐级升级。
- API 拒绝时自动兜底再试。

---

## 范围与边界

### 允许修改

- 新增 `src/core/agent/session/compaction/tool-result-budget.ts`
- 新增 `src/core/agent/session/compaction/snip.ts`
- 新增 `src/core/agent/session/compaction/microcompact.ts`
- 新增 `src/core/agent/session/compaction/reactive.ts`
- 新增 `src/core/agent/session/compaction/index.ts`（barrel）
- 修改 `src/application/chat/conversation-engine.ts`
  只扩展 `maybeAutoCompact` 与新增 `reactiveCompact` 兜底。
- 修改 `src/core/agent/session/session.ts` 暴露
  `replaceMessages(messages: LLMMessage[])` 的受控 API（若当前没有）。

### 禁止修改

- 不改 `createAutoCompactionResult` 和它的持久化路径。
- 不改 `session-types.ts`（保持 `SessionCompactionResult` 形状）。
- 不改 Phase 01 的 retry 代码。

### 限制

- 所有新函数必须是纯函数；输入 `LLMMessage[]`，输出 `LLMMessage[]`。
- 不允许调用任何 provider（不在压缩里做 "summary by LLM"，保留给
  现有 `createAutoCompactionResult` 的 baseline 策略即可）。
- 不允许引入新依赖。

---

## 执行步骤

### 一、行为建模

四级压缩的"触发器 → 动作 → 配对守则"：

| 级别 | 触发 | 动作 | 配对守则 |
|---|---|---|---|
| ① budget | 单条 `tool` 消息字节数 > `TOOL_RESULT_MAX_BYTES`（默认 32KB） | 把 content 截成 `head(8KB) + "…[truncated N bytes, see tool-history-<id>]…" + tail(4KB)` | 同一 tool_use_id 的 tool_result 保留 |
| ② snip | 对话总字节 > `SNIP_THRESHOLD_BYTES`（默认 256KB） | 保留 `head(4 条 = 2 轮) + 最近 8 条 + 1 条 boundary system` | 移除的中段里若有未配对 tool_use，把它一并移到 boundary 里 |
| ③ microcompact | `tool_use ↔ tool_result` 对超过 `MICRO_PAIRS_THRESHOLD`（默认 10 对）且对话中的"旧" 配对超过一半 | 把最旧的 N 对合并成一条 `role: 'system'` 的 `[microcompact summary: used ls, read file X, ran build OK...]` | 一次删一整对，保证配对 |
| ④ auto | 进入 `createAutoCompactionResult` 的既有条件 | 现有行为，不动 | 现有行为 |
| ⑤ reactive | provider 抛 `PromptTooLongError` | 依次尝试 ②③④；每次之后重新请求；最多 3 次仍失败 → 原样抛出 | 同级 |

### 二、任务拆解

| 模块 | 职责 |
|---|---|
| `tool-result-budget.ts` | 输入 messages，输出截断后的 messages + 新增的 `ToolResultTruncation[]` 事件 |
| `snip.ts` | 保留头尾 + boundary 策略 |
| `microcompact.ts` | 配对合并策略 |
| `reactive.ts` | 级联调用 + 记状态机 |
| `session.ts::replaceMessages` | 批量替换消息的 API（保留私有字段一致性） |
| `conversation-engine.ts::maybeAutoCompact` | 在每轮 assistant 返回后按 usage 决定触发哪一级 |

---

## 三、逐模块施工单

### 模块 1 · `applyToolResultBudget`

1. **模块名称**：tool_result 字节预算。
2. **职责**：把单条过大的 `role: 'tool'` 消息截断。
3. **涉及文件路径**：`src/core/agent/session/compaction/tool-result-budget.ts`。
4. **能力缺失**：无。
5. **根因**：全新。
6. **改动方案**：

```ts
// 常量
export const TOOL_RESULT_MAX_BYTES = 32 * 1024;
export const TOOL_RESULT_HEAD_BYTES = 8 * 1024;
export const TOOL_RESULT_TAIL_BYTES = 4 * 1024;

export interface ToolResultTruncation {
    toolCallId: string;
    originalBytes: number;
    keptBytes: number;
}

export function applyToolResultBudget(
    messages: LLMMessage[],
): { messages: LLMMessage[]; truncated: ToolResultTruncation[] } {
    const truncated: ToolResultTruncation[] = [];
    const next = messages.map((msg) => {
        if (msg.role !== 'tool' || typeof msg.content !== 'string') return msg;
        const bytes = Buffer.byteLength(msg.content, 'utf8');
        if (bytes <= TOOL_RESULT_MAX_BYTES) return msg;
        const head = msg.content.slice(0, TOOL_RESULT_HEAD_BYTES);
        const tail = msg.content.slice(-TOOL_RESULT_TAIL_BYTES);
        truncated.push({
            toolCallId: msg.toolCallId ?? 'unknown',
            originalBytes: bytes,
            keptBytes: Buffer.byteLength(head + tail, 'utf8'),
        });
        return {
            ...msg,
            content:
                `${head}\n…[truncated ${bytes - (head.length + tail.length)} bytes]…\n${tail}`,
        };
    });
    return { messages: next, truncated };
}
```

7. **注意**：用 `Buffer.byteLength` 而不是 `.length`（UTF-8 与字符数不等）。
8. **不允许**：把截掉的内容丢掉——调用方需拿 `truncated[]` 记到 transcript。
9. **预期行为**：同一条 `tool` 消息被反复调用不会再次放大（二次调用时
   `bytes <= MAX` 不触发）。
10. **验收**：测试造 50KB string → 返回 ~12KB + truncation record。
11. **测试方式**：字节长度断言 + 切片位置断言。
12. **风险**：tool 消息可能是结构化 JSON，head/tail 切在字符串中间会变成
    非法 JSON。**声明此行为可接受**：模型只需要看到"这里原本有数据，
    被截断了"，不需要完整 JSON；真实数据在 `ToolExecutionHistory` 里。
13. **回退**：不调用该函数。

---

### 模块 2 · `snipCompactIfNeeded`

1. **模块名称**：历史 snip 压缩。
2. **职责**：保留头尾 + boundary system 消息。
3. **路径**：`src/core/agent/session/compaction/snip.ts`。
4. **根因**：全新。
5. **改动方案**：

```ts
export const SNIP_THRESHOLD_BYTES = 256 * 1024;
export const SNIP_HEAD_COUNT = 4;
export const SNIP_TAIL_COUNT = 8;

export function snipCompactIfNeeded(
    messages: LLMMessage[],
): { messages: LLMMessage[]; snipped: boolean } {
    const totalBytes = messages.reduce(
        (n, m) => n + Buffer.byteLength(typeof m.content === 'string' ? m.content : '', 'utf8'),
        0,
    );
    if (totalBytes <= SNIP_THRESHOLD_BYTES) {
        return { messages, snipped: false };
    }

    // baseSystem + head + boundary + tail，注意 tool_use↔tool_result 配对
    const baseSystem = messages[0]?.role === 'system' ? messages[0] : undefined;
    const rest = baseSystem ? messages.slice(1) : messages;
    if (rest.length <= SNIP_HEAD_COUNT + SNIP_TAIL_COUNT) {
        return { messages, snipped: false };
    }
    const head = rest.slice(0, SNIP_HEAD_COUNT);
    const tail = rest.slice(-SNIP_TAIL_COUNT);
    const midOmitted = rest.length - head.length - tail.length;

    // 保证 tail 开头不是孤儿 tool_result
    const tailFixed = dropOrphanToolResults(tail);

    const boundary: LLMMessage = {
        role: 'system',
        content: `[snipped ${midOmitted} messages (~${Math.round(totalBytes / 1024)} KB). Scroll buffer preserved in session history.]`,
    };

    const next = [
        ...(baseSystem ? [baseSystem] : []),
        ...head,
        boundary,
        ...tailFixed,
    ];
    return { messages: next, snipped: true };
}
```

6. **注意**：`dropOrphanToolResults` 需要实现（若 tail 以 `role: 'tool'`
   开头但找不到配对的 `tool_use`，则把这条 tool_result 去掉）。这是 schema
   硬约束，不做会直接 400。
7. **不允许**：snipped 后 messages 为空或无 baseSystem。
8. **验收**：100 条消息 / 600KB → 返回 13 条 + 1 条 boundary + baseSystem。
9. **测试**：配对守则：在 head 尾部强插一个 tool_use，期望 boundary 后不出现
   其孤儿 tool_result。
10. **风险**：误删有用上下文。**缓解**：SNIP_THRESHOLD_BYTES 初值偏高（256KB），
    上线后根据 acceptance metrics 调。

---

### 模块 3 · `microcompact`

1. **模块名称**：tool 对微合并。
2. **职责**：把最旧的 N 个 `tool_use → tool_result` 对折成一条 system 摘要。
3. **路径**：`src/core/agent/session/compaction/microcompact.ts`。
4. **改动方案**：

```ts
export const MICRO_PAIRS_THRESHOLD = 10;
export const MICRO_PAIRS_TO_FOLD = 5;

export function microcompact(messages: LLMMessage[]): LLMMessage[] {
    const pairs = enumerateToolPairs(messages); // 返回 {use, result} 数组
    if (pairs.length < MICRO_PAIRS_THRESHOLD) return messages;

    const toFold = pairs.slice(0, MICRO_PAIRS_TO_FOLD);
    const summary = toFold
        .map(p => `- ${p.use.toolCalls?.[0]?.name ?? 'tool'}: ${summarizeToolResult(p.result)}`)
        .join('\n');

    const foldedIds = new Set(toFold.flatMap(p => [p.use, p.result]));
    const next = messages.filter(m => !foldedIds.has(m));
    const insertAt = findFirstNonSystemIndex(next);
    next.splice(insertAt, 0, {
        role: 'system',
        content: `[microcompact summary of ${MICRO_PAIRS_TO_FOLD} tool calls]\n${summary}`,
    });
    return next;
}
```

5. **注意**：`enumerateToolPairs` 必须按 id 成对（不按位置配对），避免错位。
6. **不允许**：折叠最近 3 轮内的 tool 对。
7. **验收**：20 对 tool 使用 → 合并前 5 对，剩 15 对 + 1 条 summary。

---

### 模块 4 · `reactiveCompact`

1. **模块名称**：兜底重入控制器。
2. **职责**：捕获 `PromptTooLongError`，递进尝试 snip → micro → auto，
   每次之后返回给上层 "请重试同一轮"。
3. **路径**：`src/core/agent/session/compaction/reactive.ts` + 挂在
   `conversation-engine.ts` 的 provider turn 异常路径。
4. **改动方案**：

```ts
// reactive.ts
export type ReactiveStep = 'snip' | 'micro' | 'auto' | 'exhausted';

export function nextReactiveStep(prev: ReactiveStep | undefined): ReactiveStep {
    switch (prev) {
        case undefined: return 'snip';
        case 'snip': return 'micro';
        case 'micro': return 'auto';
        default: return 'exhausted';
    }
}
```

   在 `conversation-engine.ts::requestAssistantTurn` 处 try/catch：

```ts
let step: ReactiveStep | undefined;
for (let i = 0; i < 3; i++) {
    try {
        return await runProviderTurn(...);
    } catch (err) {
        if (!(err instanceof PromptTooLongError)) throw err;
        step = nextReactiveStep(step);
        if (step === 'exhausted') throw err;
        applyReactiveStep(dependencies.session, step);
    }
}
throw new Error('reactive compaction exhausted');
```

5. **注意**：`applyReactiveStep` 必须是幂等的：重复调用 snip 不会无限膨胀。
6. **不允许**：在 reactiveCompact 里调任何模型。
7. **验收**：mock provider 抛 3 次 `PromptTooLongError`，期望观察到
   snip、micro、auto 各触发 1 次后再抛。

---

### 模块 5 · `AgentSession.replaceMessages`

1. **职责**：用受控的 API 替换 session 当前消息序列，保持
   `baseSystemMessage` 与 `toolHistory` 不动。
2. **路径**：`src/core/agent/session/session.ts`。
3. **改动方案**：若当前已存在同名方法，直接复用；否则新增：

```ts
public replaceMessages(messages: LLMMessage[]): void {
    this.messages = messages;
    this.touchUpdatedAt();
}
```

4. **不允许**：触发 `compactIfNeeded` 在 replace 内部（避免再进一次压缩）。
5. **回退**：删掉方法即可。

---

### 模块 6 · `conversation-engine.ts::maybeAutoCompact`

1. **职责**：在每个 provider turn 后把 ① ② ③ 按序尝试一次。
2. **改动方案**：

```ts
async function maybeAutoCompact(usage, deps) {
    const current = deps.session.getMessages();

    const budgeted = applyToolResultBudget(current);
    const snipped = snipCompactIfNeeded(budgeted.messages);
    const micro = microcompact(snipped.messages);
    if (micro !== current) deps.session.replaceMessages(micro);

    if (budgeted.truncated.length) {
        for (const t of budgeted.truncated) {
            deps.logger.debug(`tool-result truncated: ${t.toolCallId} ${t.originalBytes}→${t.keptBytes}`);
        }
    }

    // 保留现有 autocompact 逻辑分支
    if (shouldAutoCompact(usage, deps)) {
        deps.session.autoCompactNow(); // 已有 API
    }
}
```

---

## 四、逐文件修改建议

| 文件 | 动作 |
|---|---|
| `src/core/agent/session/compaction/tool-result-budget.ts` | 新建，≤ 80 行 |
| `src/core/agent/session/compaction/snip.ts` | 新建，≤ 120 行（含 `dropOrphanToolResults`） |
| `src/core/agent/session/compaction/microcompact.ts` | 新建，≤ 120 行 |
| `src/core/agent/session/compaction/reactive.ts` | 新建，≤ 60 行 |
| `src/core/agent/session/compaction/index.ts` | 新建 barrel，≤ 20 行 |
| `src/core/agent/session/session.ts` | 新增 `replaceMessages`，1 个方法 |
| `src/application/chat/conversation-engine.ts` | 修改 `maybeAutoCompact`；在 `requestAssistantTurn` 外围加 `PromptTooLongError` 重入 |

---

## 五、数据结构与流程

```
每轮 provider turn
  → runProviderTurn()  ──成功──▶ maybeAutoCompact(usage) ──▶ 继续 loop
                     └──失败(PromptTooLongError)──▶ reactiveStep++ ──▶ 重试同一轮
```

---

## 六、关键代码

见模块 1 / 2 / 3 / 4 / 6 内嵌代码块。

---

## 七、验证方案

### 手动测试

- `bun test src/core/agent/session/compaction/__tests__` 覆盖四类函数。
- `bun run acceptance:metrics` 跑 golden-tasks，比较前后 `messages.length`
  与 `totalTokens` 分布。

### 边界测试

- 空 messages。
- 只有 baseSystem。
- 100% 消息都是 `role: 'tool'` 且字节数均超阈值。
- 20 个连续 `tool_use` 未配对 `tool_result`（上游 abort 场景）。

### 失败判定

- 压缩后 `tool_use` 出现孤儿 `tool_result`。
- 压缩后 `baseSystemMessage` 位置变了。
- 任何一次压缩调用后模型看到消息里夹了 `undefined`。

---

## 风险与回退

- **最大风险**：压缩把必要上下文压没了。
  **回退**：在 `maybeAutoCompact` 里读 `process.env.XQODER_DISABLE_ADVANCED_COMPACT==='1'`
  跳过新三级，回退到只走原有 `autoCompact`。

---

## 不确定项

- `enumerateToolPairs` 对多 tool_use 的 assistant 消息（一轮多个 tool_use）
  是否按 id 逐个折半对处理。施工时 **必须** 先把 session 的实际消息形状
  （`toolCallId` vs `toolCalls: [{id, name}]`）确认清楚，再写 pair 枚举。
