# Phase 08 · codexShim + compressToolHistory + thinkTag sanitizer + toolArg normalizer

## 任务目标（必须可验证）

补齐 OpenClaude `services/api/**` 里除 `openaiShim.ts` 以外的 4 块关键逻辑：

| 源文件 | 目的 |
|---|---|
| `services/api/codexShim.ts` | 针对 codexplan / gpt-5.x-codex 别名的特殊 shim |
| `services/api/compressToolHistory.ts` | 滚动压缩旧的 tool 对（发 API 前瘦身） |
| `services/api/thinkTagSanitizer.ts` | 流式剥离 `<think>...</think>` 泄露 |
| `services/api/toolArgumentNormalization.ts` | tool 参数归一（同 phase 05，但这里加工具感知的 schema 提示路径） |

### 成功判定

- `createCodexShim(config)` 暴露与 `OpenAIShimProvider` 相同签名，但
  内部：
  - 把 `messages` 的 system 合并到首条 user。
  - 使用 `/responses` 端点（OpenAI codex 专用），而非 `/chat/completions`。
  - reasoning_effort 字段命名为 `reasoning.effort`。
- `compressToolHistory(messages)`：把所有 pair `(tool_use, tool_result)` 中
  最旧的一批按 **tool name + 字节大小** 滚动压缩到字符串标签，标签格式
  `[compressed tool_use X → ok/fail ΔBK]`。保留最近 6 对不压。
- `ThinkTagSanitizer`：跨 chunk 边界正确剥离；保持 tag 外的 token 顺序不变。
- `normalizeToolArguments`：
  - 有 schema 时按 schema 补全；
  - 无 schema 时按工具名规则（`run_shell → {command}` 等）。

## 对标源

- `openclaude/src/services/api/codexShim.ts`
- `openclaude/src/services/api/codexUsage.ts`
- `openclaude/src/services/api/codexOAuth.ts`
- `openclaude/src/services/api/compressToolHistory.ts`
- `openclaude/src/services/api/thinkTagSanitizer.ts`
- `openclaude/src/services/api/toolArgumentNormalization.ts`
- `openclaude/src/services/api/openaiSchemaSanitizer.ts`

## 范围与边界

### 允许修改

- `src/infra/llm/openai/shim/` 新增：
  - `codex-shim.ts`
  - `compress-tool-history.ts`
- v1 phase-05 的 `think-tag-filter.ts` 升级为 v2：补齐 `ClaudeCode-style 多种 tag`。
- v1 phase-05 的 `tool-argument-normalizer.ts` 追加 schema-aware 分支。

### 禁止修改

- OpenAI shim 的其它 7 个子文件（已在 phase-05 定义）。

## 改动要点

### 1) codexShim

```ts
// src/infra/llm/openai/shim/codex-shim.ts
export class CodexShimProvider extends BaseLLMProvider {
    readonly name = 'codex';
    constructor(config: LLMProviderConfig) {
        super(config);
        this.client = new OpenAI({ apiKey: config.apiKey, baseURL: 'https://api.openai.com/v1' });
    }

    async stream(req: CompletionRequest, cb: StreamCallbacks): Promise<CompletionResponse> {
        const messages = mergeSystemIntoFirstUser(convertMessages(req.messages, capsFor(this.model)));
        const params = {
            model: this.model,
            input: messages, // /responses 端点用 input 而不是 messages
            reasoning: { effort: req.effort ?? 'medium' },
            stream: true,
            tools: req.tools ? convertTools(req.tools, { strict: true }) : undefined,
        };
        const stream = await withRetry({ providerName: 'codex' }, () =>
            this.client.responses.create(params as any)); // OpenAI SDK v6 /responses
        return openaiStreamToInternal(stream, cb, { thinkTagFilter: new ThinkTagFilter() });
    }
}

function mergeSystemIntoFirstUser(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
    const sys = messages.filter(m => m.role === 'system').map(m => asText(m.content)).join('\n\n');
    const rest = messages.filter(m => m.role !== 'system');
    if (!sys) return rest;
    const first = rest[0];
    if (first?.role === 'user') {
        return [{ role: 'user', content: `${sys}\n\n${asText(first.content)}` }, ...rest.slice(1)];
    }
    return [{ role: 'user', content: sys }, ...rest];
}
```

### 2) compressToolHistory

```ts
// src/infra/llm/openai/shim/compress-tool-history.ts
export interface CompressOptions { keepRecent?: number; maxOldPairs?: number; }

export function compressToolHistory(
    messages: LLMMessage[],
    opts: CompressOptions = {},
): LLMMessage[] {
    const keepRecent = opts.keepRecent ?? 6;
    const pairs = enumeratePairs(messages); // from phase-02
    if (pairs.length <= keepRecent) return messages;

    const old = pairs.slice(0, pairs.length - keepRecent);
    const markForCompress = new Set<LLMMessage>();
    const compressedSummaries: string[] = [];
    for (const p of old) {
        markForCompress.add(p.use); markForCompress.add(p.result);
        const name = p.use.toolCalls?.[0]?.name ?? 'tool';
        const bytes = Buffer.byteLength(asText(p.result.content), 'utf8');
        compressedSummaries.push(`[compressed ${name} → ${isSuccess(p.result) ? 'ok' : 'fail'} ${Math.round(bytes/1024)}KB]`);
    }
    const out: LLMMessage[] = [];
    let firstCompressed = true;
    for (const m of messages) {
        if (markForCompress.has(m)) {
            if (firstCompressed) {
                out.push({ role: 'system', content: compressedSummaries.join('\n') });
                firstCompressed = false;
            }
            continue;
        }
        out.push(m);
    }
    return out;
}
```

### 3) ThinkTagFilter v2

phase-05 的已可用；在此版本加入：

- `<reasoning>...</reasoning>`、`<thought>...</thought>` 扩展匹配；
- 输出附件模式（把 `<think>` 里内容作为 `onThinkingToken` 推送，而不是丢掉）。
- 保留 16 字节的尾部缓冲区（比 phase-05 的 32 字节更紧；测试证明足够覆盖
  最常见 tag 跨 chunk 情况）。

### 4) toolArgumentNormalization · schema-aware

```ts
export function normalizeToolArguments(
    toolName: string,
    raw: string,
    schemaHint: JsonSchema | undefined,
): Record<string, unknown> {
    const obj = tryJsonObject(raw);
    if (obj) return coerceToSchema(obj, schemaHint);
    return coerceStringToSchema(toolName, raw.trim(), schemaHint);
}

function coerceToSchema(obj: Record<string, unknown>, schema?: JsonSchema): Record<string, unknown> {
    if (!schema) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
        if (k in obj) out[k] = castBySchema(obj[k], v);
        else if (!schema.required?.includes(k) && 'default' in v) out[k] = v.default;
    }
    return out;
}
```

## 验证

- 20 个 fixture 样本放 `src/infra/llm/openai/shim/__fixtures__/`
  覆盖 codex / compress / thinkTag / toolArg 四种路径。
- 对 compressToolHistory：用 30 对 tool history 做 snapshot 断言
  （keepRecent=6 → 剩 6 对 + 1 条 summary）。

## 风险与回退

- **风险**：codex `/responses` 端点对中转商（国内聚合器）不一定支持。
  **缓解**：factory 里把 codex alias 默认改走 `chat/completions`；
  用 `XQODER_FEATURE_CODEX_SHIM=1` 切到 `/responses`。
- 回退：不启用 codex-shim 即完全等价于 phase-05 的 openaiShim。

## 不确定项

- OpenClaude 的 `compressToolHistory` 还把 `tool_use` 的 `input` 做了 hash 节省
  字符。本期 v1 实现只压缩配对，不 hash input；做简单。后续可按
  OpenClaude 的 `hashToolUseInput` 扩展。
