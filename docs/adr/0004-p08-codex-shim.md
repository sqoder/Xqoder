# ADR 0004 — P08 Codex shim + compressToolHistory(opt-in)

- **Date**: 2026-05-10
- **Status**: Accepted
- **Phase**: P08
- **Related docs**: `docs/openclaude-parity/phase-08-codex-shim-and-compress-tools.md`

## 背景

P05 上了 `OpenAIShimProvider` 走 `/chat/completions`,能覆盖 dashscope /
groq / xai / openrouter / local / openai 六家。但两件事还没 parity:

1. **codex 族别名**(`codexplan / gpt-5 / gpt-5.1-codex / o3-codex / …`)
   官方走 `/responses` 端点,不是 `/chat/completions`;入参命名 `input` 而非
   `messages`,system 角色被废弃,`reasoning.effort` 取代 `reasoning_effort`。
   chat-completions 兼容层会丢掉 reasoning 事件 + tool 调用的增量。

2. **长对话 tool 历史膨胀**:chat/completions 和 /responses 都不会自动瘦身
   tool_use/tool_result 对。`microcompact`(P02)只折最旧 5 对,且阈值
   10 对才触发,介于 6–30 对之间的中等规模会话里,tool 历史依然会把 prompt
   推到 context 红线。需要一层更直接的"keep recent N,其余 fold summary"
   过滤,放在发 API 前兜底。

## 决策

在 `src/infra/llm/openai/shim/` 追加两块纯模块 + 一块 provider,继续保持
opt-in:

| 模块 | 职责 |
|---|---|
| `compress-tool-history.ts` | 保留最近 N 对 tool_use/tool_result,其余折成 `[compressed <name> → ok/fail ΔKB]` 系统摘要行;默认 `keepRecent=6` |
| `codex-shim.ts` | `CodexShimProvider` 走 `/responses`;`buildCodexInput` 把 system 合并进首条 user,`function_call` / `function_call_output` 对应 tool 调用;`codexStreamToInternal` 解析 Responses 事件流(`response.output_text.delta`、`response.function_call_arguments.delta`、`response.completed` 等) |
| `think-tag-filter.ts` v2 | 新增 `<reasoning>/<thought>` 匹配 + 可选 `onThinking` 回调(把 tag 内文字通过 `onThinkingToken` 推给调用方,不再无脑丢) |
| `tool-argument-normalizer.ts` v2 | 拿到 schema 时走 `coerceToSchema`:裁剪未声明 key、字符串→数字/布尔的 cast、required 外的默认值填充;无 schema 时保持 P05 行为 |

### 红线

- **硬红线**:无改动。
- **软红线**:无改动。
- 旧 `OpenAIShimProvider` 走 chat/completions 的路径一行未改,只通过 factory
  开关叉路到 codex shim。
- **开关**:`process.env.XQODER_FEATURE_CODEX_SHIM === '1'` 时,且 provider ∈
  `{openai, openai-compatible}` 且 model 匹配
  `/^(codexplan|gpt-5(\.\d+)?(-codex)?|o\d+-codex)/i` 才接入 `CodexShimProvider`。
  默认 OFF。`XQODER_USE_OPENAI_SHIM` 开关独立,互不覆盖。

选择 opt-in 的理由:
- 国内聚合器 / 中转商普遍不转发 `/responses` 端点,默认走 chat 兼容层更稳。
- 让真实 OpenAI key 的用户通过单个环境变量灰度验证 codex 路径,再在
  P07 做 provider routing 时决定要不要默认打开。
- compress-tool-history 作为纯函数导出,消费方(未来的 queryEngine、p07 路由)
  明确调用才生效,不会偷偷改 P05 既有链路的 token 数。

### Think-tag 升级的取舍

- 用 `onThinking` 回调**复用**了 stream-parser 的 `onThinkingToken`
  通道,不新增专有 API。调用方(provider)在构造 `ThinkTagFilter` 时
  传入 callback,即可把 `<think>reasoning</think>` 的内容当 reasoning
  surface 出去——等价于支持 `reasoning_content` 的 OpenAI 新接口。
- 没有采纳施工单里"尾部缓冲收紧到 16 字节"的提案:当前 `MAX_CLOSE_TAIL=13`
  已经够覆盖 `</scratchpad>` 这个最长 close tag,再紧一档只省 3 字节却要
  扩测试矩阵,不值。

### 工具参数 schema-aware 的行为边界

- 只在**有 schema 时**做裁剪/cast;没有 schema 照旧 fallback(run_shell
  → command、单 string 字段自动装箱、repair JSON)。
- cast 仅覆盖 `string/number/integer/boolean`,因为 OpenAI 兼容 provider
  回传的裸字符串几乎全落这四种。数组 / 嵌套 object 保持原样透传,避免
  误删合法结构。
- `default` 只对 **不在 required 里且未出现在 payload** 的字段生效——这点
  和 JSON Schema 规范一致,避免覆盖模型显式填的值。

## 替代方案

1. **把 /responses 路径塞进 OpenAIShimProvider**:
   `/chat/completions` 与 `/responses` 的事件命名和入参形状差异大
   (messages vs input、delta.content vs response.output_text.delta),
   合并会把两条路径的分支漏得到处都是,单元测试矩阵翻倍。拆成独立类
   更简单、诊断更明确。

2. **不做 compressToolHistory,等 P09 QueryEngine 统一管**:
   P09 要拆 `conversation-engine.ts` 的主循环,工作量本来就大。把"发 API
   前 tool 历史瘦身"这种纯函数先落进 shim,P09 只 import 不重写,减摩擦。

## 后果

### 好处
- codex 路径的 reasoning/tool 调用可以通过单元测试的 structural stream
  驱动,不依赖真实网络。
- `compressToolHistory` 是纯 LLMMessage[] → LLMMessage[],后续任何链路
  (queryEngine、MCP 代理、批量脚本)想瘦身 tool 历史只需 import 一行。
- ThinkTagFilter 的 `onThinking` 把 DeepSeek-R1 / QwQ 的 `<think>` 和
  OpenAI 的 `reasoning_content` 合并到同一个 callback 通道,调用侧不用
  再分两路处理 reasoning。

### 代价
- codex alias 判定靠正则,未来 OpenAI 新出 `gpt-6-codex` 需要更新 pattern。
  目前的正则覆盖 `codexplan / gpt-5 / gpt-5.1-codex / gpt-5.2-codex /
  o3-codex / o4-codex`。
- `CodexShimProvider` 还没处理图片/PDF 附件(同 P05 shim);真 OpenAI codex
  用户目前发附件会退化成纯文本。这点和 P05 一起等到 P07 切默认路径时补。
- `compressToolHistory` 目前用纯字节大小 + 工具名做摘要,不做 hash
  dedup;施工单"hashToolUseInput 节省字符"的建议留给下一轮。

## 验证

- `bun test src/infra/llm/openai/shim/__tests__/`:48 pass / 0 fail
  (P05 的 29 条保持绿 + P08 新增 19 条覆盖 compress / codex / thinkTag-v2
  / schema-aware normalize 四路径)。
- `bun run release:check`:全绿(build + 全量 tsc + 822 tests / 2689
  expect + coverage 67.02% + cli-smoke + mcp-live-smoke + security +
  size-guardrail)。
- 文件大小:`codex-shim.ts` 约 340 行,`compress-tool-history.ts` 约 115
  行,均 < 1000 行 guardrail。
