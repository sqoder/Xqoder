# Phase 03 · Anthropic Prompt Cache 前缀稳定化

## 任务目标（必须可验证）

让 Anthropic provider 的每次请求都带上 `cache_control: {type: 'ephemeral'}`
断点，并在 usage 上暴露 `cacheReadTokens` / `cacheCreationTokens`，
连续对话能真正命中缓存。

### 成功判定

- 在同一 session 中发起 5 轮对话：
  - 第 1 轮：`cacheCreationTokens > 0`，`cacheReadTokens == 0`。
  - 第 2–5 轮：`cacheReadTokens > 0` 且占比 ≥ 70%。
- `session.usage.cost` 体现缓存折扣（按 `model-costs.ts` 里
  `inputCachedPer1M` 的价格计算）。
- 新增 `bun test src/infra/llm/anthropic/__tests__/cache-markers.test.ts`
  全绿。

---

## 背景与上下文

- Anthropic SDK 的 `messages.create` 参数允许在 `system`、`tools`、
  `messages` 三处放 `cache_control: { type: 'ephemeral' }`。命中条件是
  **前缀字节完全相同**。
- XQoder 现在的 system prompt 是动态组合
  （`prompt-composer.ts + prompt-layers.ts`），其中 `token_budget` / `scratchpad`
  是"会变的尾巴"。
- `calculateCost`（`src/infra/shared/model-costs.ts`）已经有 `inputCachedPer1M`
  字段，只需正确填 usage。
- Usage 解析入口：`src/infra/llm/anthropic/index.ts`，当前没有取
  `cache_creation_input_tokens / cache_read_input_tokens`。

---

## 问题/需求定义

### 当前现象

- 所有请求都以原价计费。
- 长对话的首 token 延迟未利用 prompt cache 的 10× 提速。

### 触发条件

- 只要调用 Anthropic 都应受益（当前完全没享受）。

### 预期行为

- System prompt 一次构建后拆成 **稳定前缀** + **动态尾巴** 两块；断点放稳定前缀末端。
- Usage 附带 cache 指标并进入 `session.recordUsage`。

---

## 范围与边界

### 允许修改

- `src/infra/llm/anthropic/index.ts`（请求组装 + usage 解析）
- 新增 `src/application/chat/prompt-layers.ts` 里的一个辅助函数
  `splitStablePrefix(layers) -> { prefix, tail }`（如果分层数据结构允许）
- `src/shared/llm-api/base.ts` 里的 `CompletionResponse.usage` 追加
  `cacheReadTokens?: number; cacheCreationTokens?: number`（**兼容式扩展**）
- `src/infra/shared/model-costs.ts::calculateCost` 里读 cache usage（已有字段）
- `src/core/agent/session/session.ts::recordUsage` 合并 cache 字段

### 禁止修改

- OpenAI provider（OpenAI 没有等价的 prompt cache API；Phase 05 再考虑
  `prompt_cache_key` 这个 preview 字段）。
- Conversation-engine 主循环。
- 压缩管线（Phase 02）。

### 限制

- 断点数量 **固定为 2**：一个在 system prompt 稳定前缀末端，一个在
  当前 messages 末尾。不允许在 messages 中间加多处断点（会击穿）。
- 不允许把"动态尾巴"挪到 messages 里。它必须依然在 system 里，只是不再享受缓存。

---

## 执行步骤

### 一、行为建模

Anthropic 的缓存命中规则：

- 请求前缀 **字节级完全相同** 才命中。
- `cache_control` 标记之前的所有内容被认为是 prefix，会尝试命中或写入缓存。
- 写入缓存贵 25%（首次），读取便宜 10×。

因此 XQoder 需要：

1. **稳定化** system prompt 的前缀部分（不要把 `Date.now()` 之类塞在前面）。
2. **分层**：layers 中标记哪一段是 "stable"（identity / tools / memory / skills / mcp / output style）
   哪一段是 "dynamic"（token_budget / scratchpad / append）。
3. **打断点**：拼接时在 stable 段末尾插一个 `{ type: 'text', text: '', cache_control: {type:'ephemeral'} }`。
4. **读 usage**：`response.usage.cache_creation_input_tokens`、
   `response.usage.cache_read_input_tokens`。

---

### 二、任务拆解

| 模块 | 职责 |
|---|---|
| `prompt-layers.ts::splitStablePrefix` | 根据 layer 的 `stability` 标记把数组切成 `prefix / tail` |
| `anthropic provider system param builder` | 把 prefix 的最后一块加 `cache_control` |
| `anthropic provider usage reader` | 把两个 cache usage 字段传回 `CompletionResponse.usage` |
| `calculateCost` | 在已有 cached-tokens 分支里正确代入 |
| `AgentSession.recordUsage` | 累计 cache 字段到 `session.usage` |

---

## 三、逐模块施工单

### 模块 1 · `splitStablePrefix`

1. **职责**：把 `PromptLayer[]` 切成稳定前缀 + 动态尾巴。
2. **涉及文件**：`src/application/chat/prompt-layers.ts`。
3. **当前问题**：没有 `stability` 概念。
4. **根因**：之前没需要。
5. **改动方案**：

   a) 给 `PromptLayer` 结构扩展可选字段（兼容式）：
   ```ts
   export interface PromptLayer {
       id: string;
       content: string;
       stability?: 'stable' | 'dynamic'; // 新增，默认 'stable'
   }
   ```
   b) 新增函数：
   ```ts
   export function splitStablePrefix(layers: PromptLayer[]): {
       prefix: PromptLayer[];
       tail: PromptLayer[];
   } {
       // 从末尾向前找第一个 dynamic，切分
       const firstDynamic = layers.findIndex((l) => l.stability === 'dynamic');
       if (firstDynamic === -1) return { prefix: layers, tail: [] };
       return {
           prefix: layers.slice(0, firstDynamic),
           tail: layers.slice(firstDynamic),
       };
   }
   ```
   c) 在已知 "token_budget / scratchpad / append" 的 layer 上
   **施工前读现有代码** 确认 id，然后在其构造处标记 `stability: 'dynamic'`。

6. **注意**：仅打 **可选** 标记，不破坏现有调用方。
7. **不允许**：把原有 layer id 改名。
8. **预期行为**：不打任何标记时，所有 layer 进入 prefix，与现状完全一致。
9. **验收**：单元测试造 `[{id:'identity'},{id:'tools',stability:'dynamic'}]`
   → prefix 长度 1，tail 长度 1。
10. **回退**：删掉该函数与 `stability` 字段。

---

### 模块 2 · Anthropic system param 断点注入

1. **职责**：请求体生成时在 system 的稳定段末尾加一个带 `cache_control`
   的空 text block。
2. **涉及文件**：`src/infra/llm/anthropic/index.ts`。
3. **改动方案**：

```ts
// 既有位置：组装 system 参数
// 新增入参 stablePrefixText: string | undefined
const systemBlocks: Anthropic.TextBlockParam[] = [];
if (stablePrefixText) {
    systemBlocks.push({ type: 'text', text: stablePrefixText });
    // 断点：prefix 末端
    systemBlocks.push({
        type: 'text',
        text: '',
        cache_control: { type: 'ephemeral' },
    } as Anthropic.TextBlockParam);
}
if (dynamicTailText) {
    systemBlocks.push({ type: 'text', text: dynamicTailText });
}
// 第二个断点：messages 末尾
const messagesWithBreakpoint = [...messages];
const last = messagesWithBreakpoint.at(-1);
if (last && last.role === 'user' && typeof last.content === 'string') {
    messagesWithBreakpoint[messagesWithBreakpoint.length - 1] = {
        ...last,
        content: [
            { type: 'text', text: last.content, cache_control: { type: 'ephemeral' } },
        ] as any,
    };
}
```

4. **注意**：
   - 断点空 text 是 Anthropic 文档允许的（本期**待验证**：也可以把
     `cache_control` 直接放 prefix 的真实最后一个 block 上，更优；先采用最简形式）。
   - messages 末尾那个断点同一会话同一轮只加一次。
5. **不允许**：在 system 数组中超过 2 个 `cache_control`。
6. **预期行为**：第一次请求 usage 的 `cache_creation_input_tokens > 0`。
7. **验收**：真实 API 打点（用 `anthropic/claude-3-5-sonnet`）。
   `bun run acceptance:metrics:live` 期望 2–5 轮的 cache hit ≥ 70%。
8. **回退**：把断点块去掉即可。

---

### 模块 3 · Usage 读取与扩展

1. **涉及文件**：
   - `src/infra/llm/anthropic/index.ts`（读 API 返回）
   - `src/shared/llm-api/base.ts`（加字段）
2. **改动方案**：

```ts
// base.ts
export interface CompletionResponse {
    message: LLMMessage;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
    };
    finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}
```

```ts
// anthropic/index.ts 读 usage
const raw = response.usage;
const usage = {
    promptTokens: raw.input_tokens,
    completionTokens: raw.output_tokens,
    totalTokens: raw.input_tokens + raw.output_tokens,
    cacheReadTokens: raw.cache_read_input_tokens ?? 0,
    cacheCreationTokens: raw.cache_creation_input_tokens ?? 0,
};
```

3. **注意**：非 Anthropic provider 不填这两个字段，读出 `undefined` 即可。
4. **验收**：
   - TS 编译通过（兼容扩展，可选字段）。
   - Session 持久化的 usage 字段已支持（见 `src/core/agent/session/session-usage.ts`，
     `AgentSessionUsage.cacheReadTokens` 在 `serializeOptionalSessionUsage` 里已经有，**已确认**）。

---

### 模块 4 · 成本计算（`calculateCost`）

1. **涉及文件**：`src/infra/shared/model-costs.ts`。
2. **现状**：函数签名已经接收 `usage`，含 `cacheReadTokens?` 字段的
   逻辑已经存在（本期**已经摸到**：`const inputCost += (cacheRead / 1_000_000) * cost.inputCachedPer1M`）。
3. **改动**：把 `cacheReadTokens` / `cacheCreationTokens`
   正式暴露在传入参数的类型里，调用方 `provider-turn.ts` 直接透传。
4. **验收**：5 轮对话中，第 2+ 轮的 cost 比单价按原价计费要低。

---

## 四、逐文件修改建议

| 文件 | 动作 |
|---|---|
| `src/application/chat/prompt-layers.ts` | 可选字段 + `splitStablePrefix` |
| `src/application/chat/prompt-composer.ts` | 把 `token_budget / scratchpad / append` 的 layer 标 `'dynamic'` |
| `src/infra/llm/anthropic/index.ts` | 接收 `stablePrefixText`/`dynamicTailText`，组装 systemBlocks + messages 末尾断点；读 cache 指标 |
| `src/shared/llm-api/base.ts` | usage 新增两个可选字段 |
| `src/application/chat/provider-turn.ts` | 在调用 provider.stream 时传入拆分后的 prefix/tail |
| `src/infra/shared/model-costs.ts` | 参数类型对齐（如果当前是 `any`，补齐） |

---

## 五、数据结构与流程

```
prompt-composer
  → PromptLayer[] (含 stability)
  → splitStablePrefix() → { prefix, tail }
  → provider.stream({ stablePrefixText, dynamicTailText, messages, tools })
      → Anthropic systemBlocks = [prefix, CACHE_BREAKPOINT, tail]
      → messages[-1].content[-1].cache_control = ephemeral
      → API
  → usage { cache_creation_input_tokens, cache_read_input_tokens }
  → CompletionResponse.usage { cacheCreationTokens, cacheReadTokens }
  → session.recordUsage
  → cost-tracker → 正确计价
```

---

## 六、关键代码

见模块 1 / 2 / 3 内嵌代码块。

---

## 七、验证方案

### 手动测试

- **live** 模式跑 `bun run acceptance:metrics:live`，
  在日志里观察 usage JSON 出现 `cache_read_input_tokens`。
- 多轮交互：
  ```bash
  bun dist/index.js chat "解释项目结构" --dir .
  bun dist/index.js chat "继续展开 src/application/chat"
  bun dist/index.js chat "继续展开 domain"
  ```
  期望第 2 轮开始 `cacheReadTokens > promptTokens * 0.5`。

### 边界测试

- system prompt 全部标 dynamic：前缀为空 → 不加断点 → 不应报错。
- 单轮 message 为空：不塞 messages 末尾断点。
- 使用 OpenAI provider：分支无任何变化，usage 两个字段保持 undefined。

### 失败判定

- 首轮 `cache_read > 0`（不应有）。
- 多于 2 个 `cache_control` 出现在同一请求。
- 非 Anthropic provider 因类型扩展导致运行时 undefined 异常。

---

## 风险与回退

- **最大风险**：Anthropic 产品形态改动，`cache_control` 字段形状变化
  （本期对 SDK 版本 `@anthropic-ai/sdk@0.88.0` 验证）。
- **回退**：把断点注入逻辑用 `if (process.env.XQODER_DISABLE_PROMPT_CACHE === '1')` 关掉。

---

## 不确定项

- 空 text block 上加 `cache_control` 是否官方支持。若 SDK 报 schema 错，
  改为放在前缀的真实最后一个 text block 上。施工前用一次最小测试验证。
- OpenAI 最近的 `prompt_cache_key` beta 字段暂不做，留 Phase 05。
