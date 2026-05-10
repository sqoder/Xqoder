# ADR 0003 — P05 OpenAI 兼容 shim(opt-in)

- **Date**: 2026-05-10
- **Status**: Accepted
- **Phase**: P05
- **Related docs**: `docs/openclaude-parity/phase-05-openai-shim.md`

## 背景

当前 `src/infra/llm/openai/provider/index.ts`(550+ 行)同时承担 SDK 客户端、
消息/工具格式转换、流解析、附件处理、代理配置五件事。所有 OpenAI 兼容
provider(`dashscope / groq / xai / openrouter / local`)都靠继承这个类
并只覆盖 `normalizeLLMConfig` 默认值来复用,导致:

- 新加一家 OpenAI 兼容 provider 只能复制类 + 改 `baseUrl`。
- 工具 schema strict / additionalProperties 需求各家不一,到处 if/else。
- `<think>…</think>` 过滤、tool 参数裸字符串兜底、SSE 被切断的 JSON 修复
  等边角在旧 provider 里没有,导致 DeepSeek-R1 / QwQ / Qwen 一类模型
  体验差。

## 决策

新建 `src/infra/llm/openai/shim/` 下 7 个**纯函数/类**工具 + 1 个
`OpenAIShimProvider`,把上面五件事切开:

| 模块 | 职责 |
|---|---|
| `convert-messages.ts` | XQoder `LLMMessage[]` ↔ OpenAI `ChatCompletionMessageParam[]` |
| `convert-tools.ts` + `schema-sanitizer.ts` | `ToolDefinition[]` → OpenAI tools,strict 模式下去 optional + `additionalProperties:false` |
| `stream-parser.ts` | OpenAI SSE chunk → `StreamCallbacks` + 最终 `CompletionResponse` |
| `think-tag-filter.ts` | 流式剔除 `<think>/<thinking>/<scratchpad>` 块,支持跨 chunk 边界 |
| `tool-argument-normalizer.ts` | 把 `"ls -la"` 这种裸字符串包成 `{command}`;可配合单字段 schema 自动装箱 |
| `json-repair.ts` | 栈式闭合被截断的 JSON(`{"a":` → `{"a":""}`) |
| `provider.ts` | 把上面 6 个拼成 `OpenAIShimProvider`,外层保留 P01 的 `withRetry` + `wrapStream` |

### 红线

- **硬红线**:无改动。
- **软红线**:无改动。
- 旧 `OpenAIProvider` 保留,**不删**。Factory 默认走旧路径。
- **开关**:`process.env.XQODER_USE_OPENAI_SHIM === '1'` 时 factory 把
  `openai / openai-compatible / dashscope / groq / xai / openrouter / local`
  全部指向 `OpenAIShimProvider`,否则走旧路径。默认 OFF。

选择 opt-in 而不是默认切换,是为了:
- 满足 DoD "`bun run test` 全部现有用例保持绿"——默认走旧路径,零回归风险。
- 给 P07 provider routing 留出灰度窗口:先让 dashscope / groq 等新场景
  opt-in,稳定两个 phase 再默认打开。

### 能力系统扩展

给 `LLMProviderCapabilities` 加了 `supportsStrictTools: boolean`:
- `openai / openai-compatible / azure / openrouter / xai / groq` → true
- `dashscope / local / 其他` → false(dashscope 老接口和多数本地后端不支持)

`OpenAIShimProvider.formatTools` 读这个值决定要不要带 `strict: true`。

## 替代方案

1. **直接重构 `OpenAIProvider`**:
   风险:524 行类和 dashscope/groq/xai/openrouter/local 5 个子类绑死,
   任何 bug 都会同时影响全部 provider。P04 刚涉及 permissions,不适合
   在同期再改这么大面积的运行路径。

2. **把 shim 作为默认路径,旧 provider 走 opt-out**:
   DoD 明确要求现有用例保持绿,把新代码设为默认需要附加回归证明,
   本期没有时间窗口,交给 P07 统一切换。

## 后果

### 好处
- 单元测试 29 条(覆盖 convert / schema / stream / think-tag-filter / repair)
  把每块单独验证,比拆旧类容易得多。
- 新 provider 接入只需一行 factory case。
- `reasoning_content` / 跨 chunk think tag / 截断 JSON 三项能力进入
  XQoder,DeepSeek-R1 / QwQ / Qwen-QwQ 流畅。

### 代价
- 短期内代码有两条并行路径。P07 要做 routing 时顺手切默认开关并删除
  旧 provider 私有方法里的重复代码(`formatTools` 之类)。
- `OpenAIShimProvider` 目前**没有**处理图片/PDF 附件——真实切默认路径
  前要把 `convert-messages.ts` 扩成兼容 `buildOpenAIContentParts` 的行为
  (附件合进 user content-parts)。这块留到 P07 再做,施工单里已标记。

## 验证

- `bun test src/infra/llm/openai/shim/__tests__/`:29 pass。
- `bun test test/infrastructure/openai-provider.test.ts …`:69 pass(旧用例保持绿)。
- `bun x tsc --noEmit`:无错误。
- 文件大小:shim 每个模块 ≤ 150 行,低于 300 行 guardrail。
