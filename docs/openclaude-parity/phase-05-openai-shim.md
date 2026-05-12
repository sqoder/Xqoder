# Phase 05 · OpenAI 兼容 shim + 双向协议翻译

## 任务目标（必须可验证）

把 `openai / dashscope / deepseek / groq / openrouter / xai / mistral / local(ollama)`
等 **OpenAI 兼容** provider 统一到一条代码路径 `OpenAIShimProvider`，
内部以 XQoder 的内部消息形状（贴近 Anthropic 形状：`tool_use / tool_result`）
为准，请求前 → OpenAI 形状；响应 → XQoder 内部形状。

### 成功判定

- 新建 `OpenAIShimProvider` 通过 `bun test src/infra/llm/openai/shim/__tests__/*`
  的 ≥ 20 条行为用例：
  - `convertMessages`: assistant `tool_use` ⇄ `tool_calls`；`role: 'tool'` ⇄
    `role:'tool', tool_call_id`。
  - `convertTools`: 带 optional 字段的 zod/JSONSchema 在 strict 模式下正确去除
    optional 从 `required` 并加 `additionalProperties:false`。
  - `thinkTagFilter`: 流式 `<think>…</think>` 过滤后不出现在 `onToken`。
  - `normalizeToolArguments`: 当模型把 `run_shell` 的参数回成字符串
    `"ls -la"` 时，shim 自动包成 `{command: "ls -la"}`。
  - `repairPossiblyTruncatedObjectJson`: 流被切断导致 JSON 不完整时，
    补齐末尾 `}` 的恢复。
- `dashscope / groq / xai / openrouter / deepseek / local` 这 6 个已有
  provider 的 factory 切换到新 shim 后，`bun run test` 全部现有用例保持绿。
- Phase 01 的 `withRetry` 保留在 shim 最外层。

---

## 背景与上下文

- 当前实现：`OpenAIProvider` 一个 524 行的大类同时承担"SDK 客户端 + 消息/工具
  格式转换 + 流解析 + 附件/图片 + 代理配置"。对多家兼容的 provider
  只是换 `baseUrl` + `apiKey`。
- 当前内部消息形状（`LLMMessage`）：已经接近 Anthropic 形状
  （`assistant` 带 `toolCalls[]`，`tool` 消息带 `toolCallId`）。
- OpenAI SDK 已在依赖里（`openai@^6`），本期继续使用。

---

## 问题/需求定义

### 当前现象

- 新加一个 OpenAI 兼容 provider 要复制 OpenAI provider 代码。
- 不同 provider 对 tool schema 的 strict/additionalProperties 要求不一，
  到处 if/else。
- 流式 SSE 解析在 Anthropic provider 和 OpenAI provider 里有两份不一致的实现。

### 触发条件

- 接入新模型服务（Mistral、xAI、MiniMax、智谱）。
- 模型把结构化 tool 参数回成裸字符串导致 JSON 解析失败。

### 预期行为

- **一份** shim 处理全部 OpenAI 兼容家族。
- 内部对接点为单一 `convertMessages / convertTools / openaiStreamToInternal`。

---

## 范围与边界

### 允许修改

- 新增目录 `src/infra/llm/openai/shim/`：
  - `convert-messages.ts`
  - `convert-tools.ts`
  - `schema-sanitizer.ts`
  - `stream-parser.ts`
  - `think-tag-filter.ts`
  - `tool-argument-normalizer.ts`
  - `json-repair.ts`
  - `provider.ts` （新 `OpenAIShimProvider`）
  - `index.ts` （barrel）
- 修改 `src/core/agent/llm/factory.ts`：把 `openai / dashscope / groq / xai /
  openrouter / deepseek / local` 全部指到 `OpenAIShimProvider`。
- 现有 `src/infra/llm/openai/provider/index.ts` 保留到兼容期结束
  （标记 `@deprecated`）；**不要立即删除**。

### 禁止修改

- `src/shared/llm-api/base.ts` 的 `ILLMProvider` 接口。
- `src/application/chat/**`。
- Anthropic provider。

### 限制

- 不引入新依赖。
- 单文件 ≤ 300 行（项目已启用 size 守卫，`scripts/check-file-size-guardrail.mjs`）。
- 所有 convert 函数必须是纯函数。

---

## 执行步骤

### 一、行为建模

双向翻译矩阵：

| XQoder 内部 | OpenAI 形状 |
|---|---|
| `{role:'user', content: 'x'}` | `{role:'user', content:'x'}` |
| `{role:'assistant', content:'x', thinking?:'y'}` | `{role:'assistant', content:'x'}`（thinking 不发出去） |
| `{role:'assistant', toolCalls:[{id,name,arguments}]}` | `{role:'assistant', tool_calls:[{id, type:'function', function:{name, arguments:JSON.stringify(args)}}]}` |
| `{role:'tool', toolCallId, content}` | `{role:'tool', tool_call_id, content}` |
| `{role:'system', content}` | `{role:'system', content}` |

Tool schema：

| 场景 | 处理 |
|---|---|
| `strict: true` 且 properties 有 optional | 把 optional 字段从 `required` 拿掉；`additionalProperties:false` |
| `properties` 带 `$ref` | 内联展开一层；两层以上抛错 |
| `enum` 值非字符串 | 转 JSON.stringify（字符串） |

流式反向翻译：

| OpenAI SSE chunk | 内部事件 |
|---|---|
| `choices[0].delta.content` | `onToken(text)` |
| `choices[0].delta.reasoning_content` | `onThinkingToken(text)` |
| `choices[0].delta.tool_calls[0].function.arguments` | 累积到 tool_call.arguments |
| `choices[0].finish_reason === 'tool_calls'` | emit toolCalls 结束 |
| `choices[0].finish_reason === 'stop'` | emit message end |

---

## 三、逐模块施工单

### 模块 1 · `convertMessages`

1. **路径**：`src/infra/llm/openai/shim/convert-messages.ts`。
2. **职责**：`LLMMessage[] → OpenAI.ChatCompletionMessageParam[]`。
3. **改动方案**：

```ts
export function convertMessages(
    messages: LLMMessage[],
    caps: LLMProviderCapabilities,
): ChatCompletionMessageParam[] {
    return messages.map((m) => {
        switch (m.role) {
            case 'system':
                return { role: 'system', content: asText(m.content) };
            case 'user':
                return buildUserMessage(m, caps);
            case 'assistant':
                if (m.toolCalls?.length) {
                    return {
                        role: 'assistant',
                        content: asText(m.content) || null,
                        tool_calls: m.toolCalls.map(tc => ({
                            id: tc.id,
                            type: 'function' as const,
                            function: {
                                name: tc.name,
                                arguments: safeStringifyArgs(tc.arguments),
                            },
                        })),
                    };
                }
                return { role: 'assistant', content: asText(m.content) };
            case 'tool':
                return {
                    role: 'tool',
                    tool_call_id: m.toolCallId ?? 'unknown',
                    content: asText(m.content),
                };
        }
    });
}
```

4. **注意**：
   - `assistant` 带 tool_calls 时，OpenAI 协议允许 `content` 为 `null`，
     **不是**空字符串。
   - `safeStringifyArgs` 对象 → `JSON.stringify`；字符串直接返回。
5. **不允许**：丢失任何 `tool_call_id`（丢了会在下一轮导致 API 报 schema 错）。
6. **验收**：输入/期望 20 对样本。

---

### 模块 2 · `convertTools` + `schema-sanitizer`

1. **路径**：`convert-tools.ts` + `schema-sanitizer.ts`。
2. **改动方案**：

```ts
// convert-tools.ts
export function convertTools(
    tools: ToolDefinition[],
    options: { strict?: boolean },
): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map((t) => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: normalizeSchemaForOpenAI(toJsonSchema(t.parameters), options),
            ...(options.strict ? { strict: true } : {}),
        },
    }));
}

// schema-sanitizer.ts
export function normalizeSchemaForOpenAI(
    schema: JsonSchema,
    options: { strict?: boolean },
): JsonSchema {
    const s = deepClone(schema);
    if (s.type !== 'object') return s;
    s.additionalProperties = false;
    if (options.strict) {
        // 从 required 里剔除 optional（即 properties 存在但 required 没列的字段）
        s.required = Object.keys(s.properties ?? {}).filter(
            (k) => s.required?.includes(k) ?? false,
        );
    }
    // 递归子节点
    for (const [k, v] of Object.entries(s.properties ?? {})) {
        if (v && typeof v === 'object' && v.type === 'object') {
            s.properties![k] = normalizeSchemaForOpenAI(v, options);
        }
    }
    return s;
}
```

3. **注意**：某些 OpenAI 兼容 provider 不支持 `strict:true`（dashscope 老接口）。
   在 `capabilities` 里用 `supportsStrictTools` 控制。
4. **验收**：对一个含 optional 字段的工具定义，strict 出参要满足
   `additionalProperties === false` 且 `required` 仅包含非 optional 字段。

---

### 模块 3 · `openaiStreamToInternal`

1. **路径**：`stream-parser.ts`。
2. **职责**：`AsyncIterable<ChatCompletionChunk>` → 触发 `StreamCallbacks`
   并累积最终 `CompletionResponse`。
3. **改动方案**：

```ts
export async function openaiStreamToInternal(
    stream: AsyncIterable<ChatCompletionChunk>,
    callbacks: StreamCallbacks,
    options: { thinkTagFilter?: ThinkTagFilter; idleMs?: number },
): Promise<CompletionResponse> {
    const idleMs = options.idleMs ?? 120_000;
    let lastActivity = Date.now();
    const toolAccum = new Map<string, { id: string; name: string; args: string }>();
    let content = '';
    let thinking = '';
    let finishReason: CompletionResponse['finishReason'] = 'stop';
    let usage: CompletionResponse['usage'] | undefined;

    for await (const chunk of stream) {
        if (Date.now() - lastActivity > idleMs) {
            throw new StreamIdleError('stream idle > 120s');
        }
        lastActivity = Date.now();
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === 'string') {
            const visible = options.thinkTagFilter?.push(delta.content) ?? delta.content;
            if (visible) {
                content += visible;
                callbacks.onToken?.(visible);
            }
        }
        if (typeof (delta as any).reasoning_content === 'string') {
            thinking += (delta as any).reasoning_content;
            callbacks.onThinkingToken?.((delta as any).reasoning_content);
        }
        if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
                const key = String(tc.index);
                const prev = toolAccum.get(key) ?? { id: '', name: '', args: '' };
                prev.id = tc.id ?? prev.id;
                prev.name = tc.function?.name ?? prev.name;
                prev.args += tc.function?.arguments ?? '';
                toolAccum.set(key, prev);
            }
        }
        if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason === 'tool_calls' ? 'tool_calls' : 'stop';
        }
        if (chunk.usage) {
            usage = {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
            };
        }
    }

    const tail = options.thinkTagFilter?.flush();
    if (tail) {
        content += tail;
        callbacks.onToken?.(tail);
    }

    return {
        message: {
            role: 'assistant',
            content,
            thinking: thinking || undefined,
            toolCalls: buildToolCallsFromAccum(toolAccum),
        },
        usage: usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason,
    };
}
```

4. **注意**：`StreamIdleError` 从 Phase 01 的 errors.ts 导入。`throw`
   让外层 `withRetry` 按 `stream_idle` 策略处理（目前是抛出）。
5. **不允许**：在里面吞异常继续跑；必须 propagate。

---

### 模块 4 · `ThinkTagFilter`

1. **路径**：`think-tag-filter.ts`。
2. **职责**：流式过滤 `<think>…</think>` 以及常见变体（`<thinking>` / `<scratchpad>`）。
3. **改动方案**：

```ts
export class ThinkTagFilter {
    private buffer = '';
    private inside = false;
    private readonly openTag = /<(think|thinking|scratchpad)>/i;
    private readonly closeTag = /<\/(think|thinking|scratchpad)>/i;

    push(chunk: string): string {
        this.buffer += chunk;
        let out = '';
        while (this.buffer.length > 0) {
            if (!this.inside) {
                const m = this.buffer.match(this.openTag);
                if (!m) {
                    // 保留最后 32 字节做边界缓冲
                    const safe = this.buffer.length > 32 ? this.buffer.slice(0, -32) : '';
                    out += safe;
                    this.buffer = this.buffer.slice(safe.length);
                    return out;
                }
                out += this.buffer.slice(0, m.index);
                this.buffer = this.buffer.slice(m.index! + m[0].length);
                this.inside = true;
            } else {
                const m = this.buffer.match(this.closeTag);
                if (!m) return out;
                this.buffer = this.buffer.slice(m.index! + m[0].length);
                this.inside = false;
            }
        }
        return out;
    }
    flush(): string {
        const rest = this.inside ? '' : this.buffer;
        this.buffer = '';
        return rest;
    }
}
```

4. **验收**：`push('<think>A</think>B')` 不应让 A 出现在输出里；
   `push('<thi')` + `push('nk>A</think>B')` 同样成立（跨 chunk）。

---

### 模块 5 · `normalizeToolArguments`

1. **路径**：`tool-argument-normalizer.ts`。
2. **职责**：容错那些把 JSON 对象回成字符串的兼容实现。
3. **改动方案**：

```ts
export function normalizeToolArguments(
    toolName: string,
    raw: string,
    schemaHint?: JsonSchema,
): Record<string, unknown> {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
        try { return JSON.parse(trimmed); } catch { /* fallthrough */ }
    }
    // 按工具名兜底：run_shell / run_command 的字符串 → {command: s}
    if (toolName === 'run_shell' || toolName === 'run_command') {
        return { command: trimmed };
    }
    // schemaHint 只有一个 string 字段时，自动装箱
    const props = schemaHint?.properties ?? {};
    const keys = Object.keys(props);
    if (keys.length === 1 && props[keys[0]!]?.type === 'string') {
        return { [keys[0]!]: trimmed };
    }
    throw new Error(`Cannot normalize tool arguments for ${toolName}: ${raw.slice(0, 80)}`);
}
```

4. **验收**：3 条样本：`'ls -la'` / `{command:'ls'}` / `'{"a":'`（残缺）。

---

### 模块 6 · `repairPossiblyTruncatedObjectJson`

1. **路径**：`json-repair.ts`。
2. **职责**：给被切断的 JSON 字符串补齐必要结尾。
3. **改动方案**：

```ts
export function repairPossiblyTruncatedObjectJson(raw: string): string {
    let s = raw.trim();
    // 栈：跟踪未闭合的 { [ "
    const stack: Array<'{' | '[' | '"'> = [];
    let escaped = false;
    for (const ch of s) {
        const top = stack[stack.length - 1];
        if (top === '"') {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') stack.pop();
            continue;
        }
        if (ch === '"') stack.push('"');
        else if (ch === '{') stack.push('{');
        else if (ch === '[') stack.push('[');
        else if (ch === '}' && top === '{') stack.pop();
        else if (ch === ']' && top === '[') stack.pop();
    }
    // 从栈顶倒序补齐
    for (let i = stack.length - 1; i >= 0; i--) {
        const c = stack[i];
        s += c === '{' ? '}' : c === '[' ? ']' : '"';
    }
    return s;
}
```

4. **验收**：`{"a":"hello"` → `{"a":"hello"}`；`[1,2,` → `[1,2]`。

---

### 模块 7 · `OpenAIShimProvider`

1. **路径**：`provider.ts`。
2. **职责**：用以上 6 个工具函数组装出一个 `BaseLLMProvider` 实现。
3. **改动方案**：

```ts
export class OpenAIShimProvider extends BaseLLMProvider {
    readonly name: string;
    constructor(config: LLMProviderConfig, providerName: string) {
        super(config);
        this.name = providerName;
        this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    }

    async stream(req: CompletionRequest, cb: StreamCallbacks): Promise<CompletionResponse> {
        const capabilities = resolveLLMProviderCapabilities(this.name, this.model);
        const params = {
            model: this.model,
            messages: convertMessages(req.messages, capabilities),
            tools: req.tools ? convertTools(req.tools, { strict: capabilities.supportsStrictTools }) : undefined,
            stream: true,
            max_tokens: req.maxTokens ?? this.maxTokens,
            temperature: req.temperature ?? this.temperature,
        };
        const stream = await withRetry(
            { providerName: this.name, foreground: true },
            () => this.client.chat.completions.create(params) as any,
        );
        return openaiStreamToInternal(stream, cb, {
            thinkTagFilter: new ThinkTagFilter(),
            idleMs: 120_000,
        });
    }

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
        return this.stream(req, {}); // 简化：统一走流式
    }

    protected formatTools(tools: ToolDefinition[]) {
        return convertTools(tools, { strict: false });
    }
}
```

4. **不允许**：把 `OpenAIProvider` 删除；它可能仍被现有测试 import。
   新 provider 先与旧 provider 并存，factory 切换即可。

---

### 模块 8 · Factory 切换

1. **路径**：`src/core/agent/llm/factory.ts`。
2. **改动方案**：
```ts
import { OpenAIShimProvider } from '../../../infra/llm/openai/shim/index.js';
// ...
case 'openai':
case 'dashscope':
case 'groq':
case 'xai':
case 'openrouter':
case 'deepseek':
case 'mistral':
case 'local':
    return new OpenAIShimProvider(config, provider);
```
3. **验收**：`bun test` 全部原有用例保持绿。

---

## 四、逐文件修改建议

见上。

## 五、数据结构与流程

```
chat.stream(req)
  ├─ convertMessages
  ├─ convertTools → normalizeSchemaForOpenAI
  ├─ withRetry → openai.chat.completions.create (stream)
  └─ openaiStreamToInternal (含 ThinkTagFilter)
      ├─ delta.content → onToken
      ├─ delta.reasoning_content → onThinkingToken
      └─ delta.tool_calls 累积 → buildToolCallsFromAccum
         └─ 每个 call 的 arguments 跑 repairPossiblyTruncatedObjectJson
            + normalizeToolArguments
```

## 六、关键代码

见模块 1–7。

## 七、验证方案

### 手动测试

- `bun dist/index.js chat "用 ls 看一下项目结构" --dir . --provider dashscope`
  期望输出正常，工具调用正确发出。
- 故意改 `run_shell` 工具的 schema 去掉 required，查看 strict 模式是否仍 OK。

### 边界测试

- 极长 tool 参数（被流切成 10 段）。
- 模型返回 `<think>...</think>` 嵌套。
- dashscope 不支持 `strict: true`（capabilities.supportsStrictTools=false）。
- provider baseUrl 配错：落 Phase 01 的 `FatalLLMError`。

### 失败判定

- shim 切换后原有测试出现红。
- 任何 `tool_call_id` 丢失导致下一轮 API 报 schema。

## 风险与回退

- **最大风险**：兼容性回归。
  **缓解 / 回退**：factory 里用 `process.env.XQODER_USE_OPENAI_SHIM === '0'`
  切回旧 `OpenAIProvider`。

## 不确定项

- `chunk.choices[0].delta.reasoning_content` 是 deepseek / qwen 的自定义
  扩展，OpenAI 官方没有。施工前需对目标 provider 抓一次样确认字段名。
- local (ollama) 在 OpenAI 兼容端点上支持面因版本而异。建议在 factory
  分支里先保留原 provider 作为 fallback：`env XQODER_OLLAMA_LEGACY=1` 切回。
