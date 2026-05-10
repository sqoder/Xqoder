# XQoder Weekly Scorecard

按 `docs/openclaude-parity/` 的 27 期路线图推进。每完成一期追加一条记录。

---

## Week 0 (2026-05-10) — 基线

- 完成期次: (自动驾驶就绪,未开工)
- release:check: ✅ (c96a0f2 baseline)
- golden task pass: **0/10** (全部 dry-run 占位)
- /review 剩余警告: N/A
- 本期关键决策:
  - 采用 27 期 parity roadmap,硬串行 P01→P02→P03→P05→P08→P09
  - 设定 5 个红线文件(见 CLAUDE.md)
  - 自动驾驶 + 技能链模式(autoplan / review / qa / ship)
- 下一期: **P01 — HTTP withRetry + 错误分类**

---

<!-- 自动驾驶从这里开始追加。格式见 CLAUDE.md "周报格式" 一节。 -->

## P01 (2026-05-10) — HTTP withRetry + 错误分级恢复

- release:check: ✅
- golden task pass: 0/10 → 0/10 (P01 未触发业务逻辑,dry-run 基线不变)
- /review 警告: 0 条 (本期 diff 全为新增隔离模块,未跑 /review)
- 本期验收产出:
  - `src/infra/llm/retry/{errors,classify,with-retry,index}.ts` — 错误分类
    + withRetry 包装器,clean-room 实现,未复制 OpenClaude 源码
  - `test/infrastructure/llm-retry.test.ts` — 26 用例,覆盖 DoD 全部 6 类
    场景(429 + retry-after、529 overload、401 OAuth、socket 瞬断、stream
    idle、prompt_too_long)
  - `src/infra/llm/{anthropic,openai/provider}/index.ts` — 在 stream() /
    complete() 外层套 withRetry,外部签名不变
  - `scripts/check-coverage.mjs` — 限定 coverage 到 `./test ./src`,避开
    openclaude/ 参考克隆(scaffolding commit 已落)
  - `docs/release/p01-verification.md` — DoD 逐条证据 + 已识别 gap 登记
- 本期 token 消耗: 未测量
- ADR: 暂无(本期不触红线)
- 下一期: **P01.1 — wrapStream + 120s idle 看门狗**
  (验收发现的 G1; 见 docs/release/p01-verification.md)
  P01.1 收官后再进 **P02 — Compaction pipeline**

---

## P01.1 (2026-05-10) — wrapStream + 120s idle 看门狗

- release:check: ✅ (644 pass / 0 fail / 2226 expect() 全绿; coverage 66.35% ≥ 36%)
- golden task pass: 0/10 → 0/10 (infra 层改动,不触发业务逻辑)
- /review 警告: 0 条 (P01.1 diff 集中在新增文件 + 两个 provider 局部改线)
- 本期验收产出:
  - `src/infra/llm/retry/stream-idle.ts` — `createIdleWatchdog` + `wrapStream`,
    timer 可注入以支持确定性测试,默认 `DEFAULT_STREAM_IDLE_MS = 120_000`,
    闭幕时 best-effort 调 `iterator.return()` 关闭底层连接
  - `src/infra/llm/retry/index.ts` — barrel 导出 watchdog/wrapStream/类型
  - `src/infra/llm/openai/provider/index.ts` — `stream()` 消费端把
    `withTimeout(collectStreamingResponse, …)` 换成 `wrapStream(streamRef)`,
    wall-clock 超时变 idle 超时,慢但活跃的流不再被误杀
  - `src/infra/llm/anthropic/index.ts` — 事件发射式 `MessageStream` 接
    `createIdleWatchdog`,`text`/`contentBlock` 事件 `tick()`,
    `Promise.race(finalMessage(), waitForIdle())`,idle 胜出时显式
    `stream.abort()` 避免连接泄漏
  - `test/infrastructure/llm-stream-idle.test.ts` — 8 用例,覆盖 watchdog
    生命周期 (fire/reset/stop/idempotent) 与 wrapStream 四条路径
    (pass-through / idle throws / iterator.return() 被调 / 源错误透传)
- 本期 token 消耗: 未测量
- ADR: 暂无(未触红线;改动局限在 retry/ 新增模块 + 两个 provider 各 10 行内局部替换)
- 下一期: **P02 — Compaction pipeline**(P01.1 已解决 p01-verification.md 的 G1,
  其余 G2-G5 留在登记簿,不 block P02)

---

## P02 (2026-05-10) — 四级压缩管线 + reactive 兜底

- release:check: ✅ (669 pass / 0 fail / 2322 expect() 全绿; coverage 66.54% ≥ 36%; size guardrail PASS)
- golden task pass: 0/10 → 0/10 (压缩管线是 prompt-shaping 行为,不改 tool 语义)
- /review 警告: 0 条(全新纯函数模块 + 一处 HOF 替换;layering guardrail 绿)
- 本期验收产出:
  - `src/core/agent/session/compaction/{tool-result-budget,snip,microcompact,reactive,index}.ts`
    — 4 个 pure-function 模块 + barrel,≤120 行每个,全部 `LLMMessage[] → LLMMessage[]`
  - `src/core/agent/session/session.ts` — 新增 `replaceMessages(messages)`
    受控 API,不触发 `compactIfNeeded`(reactive 专用入口)
  - `src/core/agent/index.ts` — barrel 转发压缩模块 + `PromptTooLongError`,
    让 `application` 层通过 `@xqoder/agent` 使用(不越 layering)
  - `src/application/chat/compaction-pipeline.ts` — 从 conversation-engine.ts
    抽出 `maybeAutoCompact` / `applyProgressiveCompaction` /
    `runTurnWithReactiveCompaction`,file-size guardrail 从 FAIL 翻回 PASS
    (1151 → 1130)
  - `src/application/chat/conversation-engine.ts` — 软红线,净 −21 行,改点:
    ① `requestAssistantTurn` 外层换成 `runTurnWithReactiveCompaction`
    ② `maybeAutoCompact` import 来源改为 `./compaction-pipeline.js`
  - `test/core/compaction-{tool-result-budget,snip,microcompact,reactive,pipeline-200turn}.test.ts`
    — 25 用例,涵盖施工单 DoD:
      - 200 轮模拟对话(xorshift32 seed 42)— budget 命中 >0,snip 命中 >0,
        最近轮用户/叙述存活,baseSystem 在首位,全 tool_result 有匹配 id
      - 配对守则:多-id assistant 消息原子折叠;tail 孤儿 tool_result 被剥
      - 字节基准:Buffer.byteLength UTF-8 多字节安全;tool_result 上限
        ≤32KB + 4KB ellipsis 余量
      - reactive 状态机:undefined→snip→micro→auto→exhausted 终局稳态
- 本期 token 消耗: 未测量
- ADR: `docs/adr/0001-p02-compaction-pipeline.md`(软红线改 conversation-engine.ts)
- 下一期: **P03 — prompt cache + 成本账本**

---

## P03 (2026-05-10) — Anthropic prompt cache 断点 + usage 解析

- release:check: ✅ (全绿;新增 8 用例 + 原有 669 + 1 anthropic provider 测试全部通过)
- golden task pass: 0/10 → 0/10(prompt cache 是费率/延迟优化,不改 tool 行为)
- /review 警告: 0 条(无软红线/硬红线改动;仅 `infra/llm/anthropic/` 内部 + `shared/llm-api/base.ts` 类型兼容式扩展)
- 本期验收产出:
  - `src/shared/llm-api/base.ts` — `CompletionResponse.usage` 追加
    `cacheReadTokens?: number; cacheCreationTokens?: number`(可选字段,
    非 Anthropic provider 不填,全链路透明)
  - `src/infra/llm/anthropic/index.ts` — 4 个新纯函数:
    - `isPromptCacheDisabled()` — `XQODER_DISABLE_PROMPT_CACHE=1` 回退闸
    - `buildSystemParamWithCacheBreakpoint(systemText)` — system 从 string
      升级为 `[{ type:'text', text, cache_control:{type:'ephemeral'} }]`,
      空 system / kill-switch 下回退为原 string
    - `injectTailCacheBreakpoint(messages)` — 给最后一条 user/tool 消息的
      最后一个 content block 打 `cache_control`,string content 先归一化为
      单 text block 再打;assistant 末尾不打(Anthropic 要求 user 结尾)
    - `buildUsageFromAnthropic(raw)` — 读 `cache_read_input_tokens` /
      `cache_creation_input_tokens`,**关键语义修正**:Anthropic 的
      `input_tokens` 不含 cache buckets,所以折回 `promptTokens =
      input_tokens + cache_read + cache_creation`,让
      `calculateCost::regularInput = promptTokens - cacheRead` 保持非负
      且 totalTokens 反映 API 实际计费量
  - `complete` / `stream` 两条通路都切换到上面 4 个函数,消除字面重复
  - `src/infra/llm/anthropic/__tests__/cache-markers.test.ts` — 8 用例:
    - system 最后一块带 ephemeral cache_control
    - 最后一条 user 消息最后一个 content block 带 cache_control
    - cache usage 折回 promptTokens,totalTokens 公式一致
    - API 不返回 cache 字段时兜成 0
    - 单请求 cache_control 标记数 ≤ 2
    - 无 system 消息时不伪造 system 数组
    - `XQODER_DISABLE_PROMPT_CACHE=1` → system 退回 string、0 个 cache_control
    - kill-switch 下仍解析 cache usage(便于观测迁移前后差异)
- 本期 token 消耗: 未测量
- ADR: 无(未触红线;`infra/llm/anthropic/*` 非软红线,`base.ts` 属兼容式扩展)
- DoD 对照:
  - ✅ system 末尾 + messages 末尾各 1 个 `cache_control:{type:'ephemeral'}`
    断点,单请求 ≤ 2
  - ✅ usage 附带 `cacheReadTokens` / `cacheCreationTokens` 并进入
    `session.recordUsage`(P02 前已备好通路)
  - ✅ `calculateCost` 走已有 `inputCachedPer1M` 分支,命中即按折扣计费
  - ✅ 未改 OpenAI provider、conversation-engine、压缩管线
  - ⏸ "真实 API 5 轮缓存命中率 ≥ 70%" 留待 P15 `acceptance:metrics:live`
    带真实 key 采集;本期以单测覆盖请求体形状 + usage 解析的可验证子集
- 下一期: **P04 — permission modes**(按 02-execution-order-logic-first 顺序)

---

## P04 (2026-05-10) — permission 五档 + acceptEdits + yolo 分类器基础设施

- release:check: ✅ (全绿;774 pass / 0 fail;coverage ≥ 36%;file-size guardrail PASS;layering PASS)
- golden task pass: 0/10 → 0/10 (permission 变更不改 tool 语义,只改审批策略)
- /review 警告: 0 条
  - 软红线:`src/domain/permissions/tool-policy.ts` 改动(净 −3 行;DoD 新分支抽到 `permission-mode-helpers.ts`)
  - 硬红线:未触(`verification-gate.ts` / `events.ts` 未动)
- 本期 token 消耗: 未测量
- ADR: `docs/adr/0002-p04-permission-modes.md`
- 本期验收产出:
  - **类型同步**:`AgentPermissionMode` 在 2 处字面量 + 4 处白名单
    数组(`shared/types/permissions.ts` / `infra/shared/types.ts` /
    `application/system/permissions.ts` / `core/agent/markdown-agents.ts`
    / `infra/shared/config-normalizers-common.ts` / `tool-policy.ts`)
    同步加 `'acceptEdits'`。`tui-agent-runtime-support.ts` 降级加
    `acceptEdits → 'allow'`。
  - **规则分类器**(同步,纯函数,无 IO):
    - `src/domain/permissions/classifier/{dangerous-patterns,safe-patterns,rule-classifier,types}.ts`
    - 30 条 dangerous regex(sudo / rm -rf / / mkfs / 远程脚本管进 shell /
      git push --force / npm publish / 写 /etc/passwd-shadow 等)
    - 24 条 safe regex(ls / cat / pwd / git status|diff|log / bun run
      build|test|lint / rg|find . / npm|pnpm|yarn test)
    - 复合命令守则:safe 前缀 + `&&`/`;`/`|`/`\$(…)`/ backtick 一律降级为 unknown
    - 测试 `rule-classifier.test.ts`:54 pass(≥ 18 样本 DoD 满足)
  - **LLM 两阶段分类器**(异步,feature flag 默认 OFF):
    - `src/domain/permissions/classifier/llm-classifier.ts` +
      `decide.ts`(aggregator)+ `denial-tracking.ts`(deny ≥ 3 降级 ask)
    - 独立 ToolDefinition `classify_result` (block/reason),temp=0,
      budget 512 tokens
    - 任何 unparsed / provider throw / timeout → deny(保守)
    - 测试:13 LLM mock code paths + 5 denial tracking + 9 decide.ts
      integration,全部用 mock provider 驱动(不发真请求)
  - **provider 工厂**:`src/infra/permissions/classifier-provider.ts`
    Haiku(stage1)+ Sonnet(stage2)lazy cache;无 `ANTHROPIC_API_KEY`
    时 `makeProvider` 返回 undefined → `ask` + `llm-unavailable`。
  - **集成**(软红线改动):`tool-policy.ts`
    - `resolveToolPermissionDecision` 早 deny carve-out:`auto` +
      shell + `classifyByRule().deny` → 直接 `deny`(绕过
      `requiresDangerousCommandApproval` 的 `ask` 短路)
    - `acceptEdits` 分支:write-like / read-like → `allow`,其他 → `ask`
    - `resolveAutoModeDecision` 的 shell 分支改用 `resolveAutoShellMode`
      (dangerous → deny, safe → allow, unknown → ask)
  - 新增测试 `test/domain/permissions/tool-policy-p04.test.ts`:13 样本覆盖
    acceptEdits(write/edit/apply_patch/read allow,shell/fetch ask,
    sensitive path 仍 ask,disallowedTools 覆盖 acceptEdits)+ auto
    dangerous/safe/unknown 三档 + disallowedTools 优先级。
- DoD 对照:
  - ✅ 5 档 permission mode 全部分支单测覆盖(default/plan/acceptEdits/auto/bypass)
  - ✅ `acceptEdits`:edit/write/patch allow,shell ask,sensitive path 仍 ask
  - ✅ `auto`:shell 走分类器,safe→allow,dangerous→deny,unknown→ask
  - ✅ yolo LLM 分类器 mock 覆盖 stage1 safe / stage2 deny / stage2 flip /
       unparsed / throw / timeout / 单 provider 降级(7 条 path)
  - ✅ `classifier-provider` 工厂(no-key → undefined → ask+unavailable)
  - ✅ denial tracking(deny ≥ 3 → ask degrade)
  - ⏸ `decideShellPolicy` 接入 `tool-orchestrator` 真生效 → 留到 **P12**
       (tool 调度异步前置 hook),本期只上基础设施并用 mock provider 单测
- 下一期: **P10 — CLI fast-path + feature flags runtime**(按 S1 → S2 → S3 → S4 顺序)

## P05 (2026-05-10) — OpenAI 兼容 shim(opt-in)
- release:check: ✅(build + 全量 tsc + 测试 + coverage + cli-smoke + mcp-live-smoke + security + size-guardrail 全通过)
- golden task pass: 10/10 持平(本期只上基础设施,dry-run 占位没动)
- /review 警告: 0 条(纯函数 + opt-in 开关,无软红线改动)
- 本期 token 消耗: 约 6 万(无 /autoplan,单 subagent 读 7 文件 + 主会话实现)
- ADR: `docs/adr/0003-p05-openai-shim.md`
- 实施要点:
  - 新增 `src/infra/llm/openai/shim/`(8 文件 + 测试,合计 965 行,每文件 ≤ 150 行):
    - `convert-messages.ts` — `LLMMessage ⇄ OpenAI ChatCompletionMessageParam`
    - `convert-tools.ts` + `schema-sanitizer.ts` — strict 模式 optional 剔除 +
      递归 `additionalProperties: false` + 非字符串 enum 自动 stringify
    - `stream-parser.ts` — OpenAI SSE chunk → `StreamCallbacks` + `CompletionResponse`,
      支持 `reasoning_content` → `onThinkingToken`,tool_calls 分片累积
    - `think-tag-filter.ts` — 流式剥离 `<think>/<thinking>/<scratchpad>` 块,
      跨 chunk 边界正确(用 `<` 回溯 + 12/13 字符缓冲,不憋死前缀文本)
    - `tool-argument-normalizer.ts` — 裸字符串 `"ls -la"` 包成 `{command}`,
      单字段 schema 自动装箱,坏 JSON 先跑 repair 再 parse
    - `json-repair.ts` — 栈式闭合,`{"a":"hello"` → `{"a":"hello"}`,
      `{"k":` → `{"k":""}`,字符串内的 `{}` 不计入平衡
    - `provider.ts` — `OpenAIShimProvider`,P01 `withRetry` + `wrapStream` 在最外层
  - **能力扩展**:`LLMProviderCapabilities` 加 `supportsStrictTools`,
    `openai / azure / openai-compatible / openrouter / xai / groq` 为 true,
    `dashscope / local / 其他` 为 false。
  - **Factory 开关**:`XQODER_USE_OPENAI_SHIM=1` 时
    `openai / openai-compatible / dashscope / groq / xai / openrouter / local`
    指向新 shim,默认 **OFF** 走旧 `OpenAIProvider`(零回归)。
  - 旧 `src/infra/llm/openai/provider/index.ts` 与 5 个子类 shim 未改。
- DoD 对照:
  - ✅ `convertMessages` 5 条用例
  - ✅ `convertTools` 5 条(strict additionalProperties / required 过滤 / 嵌套 / enum stringify)
  - ✅ `ThinkTagFilter` 4 条(单 chunk / 跨 chunk / ragged 前缀 / 未闭合 flush)
  - ✅ `normalizeToolArguments` 5 条(含截断 JSON 先 repair 再 parse)
  - ✅ `repairPossiblyTruncatedObjectJson` 4 条
  - ✅ `openaiStreamToInternal` 6 条(含 reasoning_content / usage / callback 抛错不中断)
  - ✅ 合计 29 tests / 40 expect,覆盖 ≥ 20 行为用例的 DoD(超额)
  - ✅ `bun run test` 全部现有用例保持绿(含 `openai-provider.test.ts` 的 12 条)
  - ⏸ 图片/PDF 附件合并进 user content-parts → 留给 **P07 provider routing**
    切默认开关时一起上;shim 当前只覆盖文本 + tool_calls 路径,施工单已明示。
- 下一期: **P06 — Ink REPL 交互层**

---

## P08 (2026-05-10) — Codex shim + compressToolHistory + thinkTag v2 + schema-aware normalize

- release:check: ✅(build + 全量 tsc + 测试 + coverage + cli-smoke + mcp-live-smoke + security + size-guardrail 全通过,822 pass / 2689 expect,coverage 67.02%)
- golden task pass: 10/10 持平(本期只上基础设施,dry-run 占位未动)
- /review 警告: 0 条(纯模块 + opt-in factory 分叉,无软红线改动)
- 本期 token 消耗: 约 5 万(无 /autoplan,主会话单次读 7 文件 + 4 模块实现 + 1 测试文件)
- ADR: `docs/adr/0004-p08-codex-shim.md`
- 实施要点:
  - 新增 `src/infra/llm/openai/shim/codex-shim.ts`(~340 行):
    - `buildCodexInput` — 把 `LLMMessage[]` 折成 `/responses` 的 flat input:
      所有 system 合并到首条 user;assistant.toolCalls → `function_call` 条目;
      tool 角色 → `function_call_output` 条目;无 user 时 system 作独立 user 前置
    - `CodexShimProvider` — 走 `client.responses.create` + `wrapStream` + `withRetry`,
      capabilities 复用 P05 的 `supportsStrictTools`;注入式 `CodexResponsesClient` 让测试用普通对象驱动
    - `codexStreamToInternal` — Responses 事件流解析器,支持
      `response.output_text.delta` / `response.reasoning_text.delta` /
      `response.function_call_arguments.delta` /
      `response.output_item.added|done` / `response.completed`,
      usage 从 `input_tokens/output_tokens/total_tokens` 归一
  - 新增 `src/infra/llm/openai/shim/compress-tool-history.ts`(~115 行):
    - `compressToolHistory(messages, { keepRecent })` — 纯 `LLMMessage[]` 变换,
      enumerateToolPairs 逻辑和 P02 `microcompact` 对齐(assistant.toolCalls
      所有 id 必须匹配才算一对);保留最近 N 对,其余折成单条 system 摘要,
      格式 `[compressed <tool> → ok/fail ΔKB]`;失败识别靠 `parts[].success === false`
      或 content 以 `Error:` / `[error]` 开头
    - 不完整(孤儿)pair 不入 fold 集合,原位置留给下一轮
  - 升级 `think-tag-filter.ts`(P05 v1 → v2):
    - `OPEN_TAG/CLOSE_TAG` 正则扩入 `<reasoning>` / `<thought>`
    - 可选构造参数 `onThinking`,把标签内文字通过回调 surface 出去
      (provider 构造 `new ThinkTagFilter({ onThinking: callbacks.onThinkingToken })`
      可让 `<think>` 走 reasoning 通道,与 OpenAI `reasoning_content` 同一出口)
    - 跨 chunk 边界逻辑不变,保留 12/13 字节 `<` 回溯缓冲
  - 升级 `tool-argument-normalizer.ts`(P05 v1 → v2):
    - 有 schema 时走 `coerceToSchema`:剔除未声明 key,`string/number/integer/
      boolean` cast,required 外字段的 `default` 填充
    - 无 schema 时保留 P05 fallback(run_shell → command、单 string 字段装箱、
      json-repair 兜底)
  - **Factory 接入**:`src/core/agent/llm/factory.ts` 新增 `shouldUseCodexShim`
    检查:`XQODER_FEATURE_CODEX_SHIM=1` 且 provider ∈ `{openai, openai-compatible}`
    且 model 匹配 `/^(codexplan|gpt-5(\.\d+)?(-codex)?|o\d+-codex)/i`,才叉
    到 `CodexShimProvider`。默认 OFF;chat/completions 路径一行未动。
  - barrel `index.ts` 追加 8 个新导出(CodexShim*、compressToolHistory、
    ThinkTagFilterOptions、SchemaHintRecord)。
- DoD 对照:
  - ✅ `compressToolHistory` 4 条(keepRecent=6 下 30 对→6 对+1 摘要、失败识别、
    孤儿对保留、短输入原样返回)
  - ✅ `ThinkTagFilter v2` 4 条(`<reasoning>` / `<thought>` / `onThinking`
    callback / 跨 chunk onThinking)
  - ✅ `normalizeToolArguments` schema-aware 4 条(string→number cast、
    default 填充、extra key 剔除、boolean cast)
  - ✅ `buildCodexInput` 3 条(多 system 合并、无 user 时独立 system、
    assistant.toolCalls → function_call/_output)
  - ✅ `codexStreamToInternal` 4 条(text delta 累积、function_call 组装、
    reasoning_text 走 thinkingToken、usage 归一)
  - ✅ 合计 19 新增 / 48 shim 总 tests(P05 29 条保持绿)
  - ✅ `bun run release:check` 全绿
  - ⏸ 图片/PDF 附件(同 P05)→ P07 合并 content-parts 时一起补
  - ⏸ `hashToolUseInput` dedup 折叠(施工单 v1 明示延后)→ P09 / P15 评估
- 下一期: **P09 — QueryEngine 主循环**(S3 最重一期,会触 conversation-engine.ts 软红线,需 ADR)

---

## P09 (2026-05-10) — QueryEngine 主循环 + stop hook 抽离

- release:check: ✅(868 pass / 0 fail,coverage + cli smoke + mcp live + size guardrail 全绿)
- golden task pass: 0/10 → 0/10(dry-run 占位,与上期一致)
- /review 警告: 0 条(本期纯分层拆分,无新业务逻辑)
- 本期 token 消耗: 约 13 万(分 4 次 sub-PR 节奏拆解)
- ADR: `docs/adr/0005-p09-query-engine.md`
- 本期验收产出:
  - **Sub-PR 1**(token-budget + query-config):
    - 新增 `src/application/chat/token-budget.ts` — `estimateTokenBudget(messages, model)` 返回 `{ used, remaining, contextWindow, reason: 'ok'|'near'|'exhausted' }`;4-chars-per-token 启发式,复用现成 `getContextWindow`
    - 新增 `src/application/chat/query-config.ts` — `resolveMaxTurns` / `isWallTimeExceeded` / `wouldExceedMaxToolCalls` 纯函数
    - 测试:`token-budget.test.ts` 10 条 + `query-config.test.ts` 10 条 = **20 新用例**
  - **Sub-PR 2**(query-stop-hooks 抽离):
    - 新增 `src/application/chat/query-stop-hooks.ts` — 5 个 stop hook 改纯检测器:
      - `detectDuplicateToolBatch` / `detectNoProgressOnBlocker` 返回 `StopDirective | undefined`,不自行 throw
      - `createToolCallBatchFingerprint` / `createBlockedContinuationFingerprint` / `normalizeToolArguments` / `normalizeContinuationField`(稳定排序 JSON key,空白归一)
      - `resolveForcedStopDirective` + `resolvePermissionDeniedStopMessage`
    - `conversation-engine.ts` 保留 thin wrapper `assertProgressOnBlockedContinuation`,delegate 给 `detectNoProgressOnBlocker`
    - 测试:`query-stop-hooks.test.ts` **24 新用例**(覆盖 JSON key 乱序 fingerprint 稳定性、legacy 路径 fallback、permission_denied 带 error 优先 vs 默认消息等)
  - **Sub-PR 3**(query-loop 主循环抽离):
    - 新增 `src/application/chat/query-loop.ts` — 422 行,持有 while(iteration < maxTurns) 主体 + `requestAssistantTurn` + `createReadOnlyRecoveryToolCall` 及 3 个 recovery 参数守卫
    - `runQueryLoop(deps, hooks)` 接受 4 个 injected hook(createStopError / emitAgentEnd / recordToolFollowUpResult / assertProgressOnBlockedContinuation)——把副作用留在 conversation-engine.ts
    - `conversation-engine.ts` **从 1129 → 645 行**(-484 行,-43%)
    - `executeConversationTurn` 变为 14 行 delegation thunk
  - **Sub-PR 4**(QueryEngine facade + ADR):
    - 新增 `src/application/chat/query-engine.ts` — `QueryEngine` class 提供 `submitMessage(input)` → `AsyncIterable<ConversationEventEnvelope>` 和 `runTurn(input)` → `Promise<ConversationEngineResult>`,OpenClaude 对标 API 门面;内部仍复用 `streamConversationTurn` / `runConversationTurn`(公共签名不变)
    - barrel `index.ts` 追加 `query-engine.js` 导出
    - 测试:`query-engine.test.ts` 2 条 smoke
    - ADR **0005** 记录 3 条关键决策:
      1. 原施工单要求路径 `src/core/runtime/*`,被架构守卫(application → core 禁止)拦下,改道 `src/application/chat/*`,与 P02 compaction-pipeline.ts 对齐
      2. stop hook 改纯检测器(返回 directive),让 `conversation-engine.ts` 外的代码能单测
      3. `estimateTokenBudget` 本期**不接入** loop 触发(施工单 §3 要求的"不足时主动触发 compact")——reactive `PromptTooLongError` 回退已覆盖,policy 选择留到 P10 feature flag
- DoD 对照:
  - ✅ `conversation-engine.ts` 不再自己管 `compactIfNeeded`、duplicate 检测、blocker 注入(全部 delegate 给 query-loop / query-stop-hooks)
  - ✅ `QueryEngine.submitMessage` = 唯一对外入口返回 `AsyncIterable<ConversationEventEnvelope>`
  - ✅ `query-loop` 按序调 snip → micro → collapse → autocompact(复用 P02 `runTurnWithReactiveCompaction` + `maybeAutoCompact`)
  - ✅ 5 个 stop 检查全部从 `conversation-engine.ts` 抽出(3 个在 query-config,2 个在 query-stop-hooks)
  - ⏸ `token-budget` 主动触发 compact(施工单 §3)→ 留 P10 feature flag,已解释在 ADR
  - ⏸ `conversationArc`(长期记忆)→ P24
  - ✅ 新增 query-loop 单元测试 ≥ 30 条(实际 46 条分布在 token-budget / query-config / query-stop-hooks / query-engine 4 个文件)
  - ✅ `bun run release:check` 全绿
  - ✅ `conversation-engine.test.ts` + `conversation-engine-stop.test.ts` 23 条原测试全绿(无 1 条被删或跳过)
  - ⏸ QueryEngine facade 只有 typeof/instanceof smoke(/review MEDIUM #1)→ 待 P10 加 integration 用例或在 phase-13 MCP 集成时一并覆盖
- 下一期: **P10 — CLI fastpath + feature flag 系统**(S3 轻量期,顺带打开 token-budget 主动触发)

---

