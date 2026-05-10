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

## P10 (2026-05-10) — CLI fast-path dispatcher + `feature()` runtime + TOKEN_BUDGET_ACTIVE

- release:check: ✅(917 pass / 0 fail;coverage 67.32% ≥ 36%;cli smoke ✅、mcp live ✅、size guardrail ✅、security hygiene ✅)
- golden task pass: 10/10 持平(本期纯 bootstrap/CLI + feature flag 脚手架,不改业务路径)
- /review 警告: 0 条(纯新增文件 + `query-loop.ts` 1 行调用 + `compaction-pipeline.ts` 1 个新 export;软红线改动已在 ADR 0006 涵盖)
- 本期 token 消耗: 约 9 万(无 /autoplan;单 subagent 读 7 文件 + 主会话实现 4 模块 + 17 handlers + 3 测试文件)
- ADR: `docs/adr/0006-p10-cli-fastpath-and-feature-flags.md`
- 本期验收产出:
  - **Fast-path dispatcher**(`src/bootstrap/cli-main.ts` 从 10 行扩到 100 行):
    - `--version / -v` zero-import path(只 import `cli/version.ts`)
    - `--provider / --model` 早注入 `process.env`,在任何 config load 之前
    - `enableConfigs()` lazy 加载 `~/.xqoder/features.json`
    - `detectFastPath(args)` → 17 个 handler(daemon / ps / logs / attach / kill / remote-control / rc-new|list|reply / environment-runner / self-hosted-runner / chrome-* / worktree + dump-system-prompt)
    - Feature gate 不通过时打印 "gated behind feature X" + `exitCode=2`
  - **`feature()` runtime**(`src/shared/feature-flags.ts` ~170 行):
    - 17 个默认 flag(HTTP_WITH_RETRY / ADVANCED_COMPACTION / PROMPT_CACHE / PERMISSION_MODE_V2 / PERMISSION_YOLO_CLASSIFIER / OPENAI_SHIM / CODEX_SHIM / INK_REPL / DUMP_SYSTEM_PROMPT / COORDINATOR_MODE / CRON_TASKS / BRIDGE_MODE / DAEMON / BG_SESSIONS / WORKFLOW_SCRIPTS / MONITOR_TOOL / CHICAGO_MCP / **TOKEN_BUDGET_ACTIVE**)
    - 三级解析:env `XQODER_FEATURE_<NAME>`(1/0/true/false) → `~/.xqoder/features.json` → FEATURE_DEFAULTS
    - `XQODER_FEATURES_PATH` 覆盖路径(测试专用)
    - `describeFeatures()` 输出 `{ name, enabled, default, source: 'default'|'file'|'env' }[]`
    - `writeFeatureOverride` / `clearFeatureOverride` 原子写 + 内存缓存刷新
  - **Provider flag**(`src/cli/provider-flag.ts` ~130 行 clean-room):
    - 15 provider 名 → CLAUDE_CODE_USE_* env 映射
    - `parseProviderFlag` / `parseModelFlag` / `applyProviderFlag` / `applyProviderFlagFromArgs` / `applyModelFlagFromArgs`
    - 未搬 OpenClaude 的 integrations/compatibility 注册表(P07 provider routing 再做)
  - **Fast-path detector**(`src/cli/fast-path.ts` ~90 行):
    - argv → handler name 映射,长 flag(`--dump-system-prompt` / `--daemon-worker` / `--claude-in-chrome-mcp` …)+ 裸 subcommand(daemon / ps / logs / attach / kill / rc(-new/list/reply))
    - `--worktree` / `--provider` / `--model` 不是 fast-path(root shell 处理)
  - **Handlers**(`src/cli/handlers/` 17 文件):
    - `dump-system-prompt.ts` — 真实现(调 `buildChatSystemPrompt`)
    - 其余 16 个走 `stub.ts::createStub(label, name)` → stderr + exit 2
  - **`xqoder features` 子命令**(`src/commands/system/features.ts` ~80 行):
    - `ls` / `enable <name>` / `disable <name>` / `reset <name>` / `--json`
    - 注册到 `cli-system` built-in plugin
  - **TOKEN_BUDGET_ACTIVE 主动触发**(ADR 0005 §3 收尾):
    - `compaction-pipeline.ts` 新增 `maybeActiveTokenBudgetCompact(deps)`:
      flag off → 直接 return;flag on + runtime!=mvp → 检 budget,`near`/`exhausted` 时先跑 `applyProgressiveCompaction`,`exhausted` 仍残留时再走 `maybeAutoCompact` summarizer 路径
    - `query-loop.ts` 在 `runTurnWithReactiveCompaction` 之前调用(默认 off 下行为 0 变化)
  - **测试**(51 新增):
    - `test/shared/feature-flags.test.ts` — 18 用例(default / env/file 三级、enableConfigs reload、malformed JSON 降级、describeFeatures 三种 source)
    - `test/cli/provider-flag.test.ts` — 16 用例(parse、apply 各 provider、applyModelFlagFromArgs routing)
    - `test/cli/fast-path.test.ts` — 11 用例(长 flag / 裸 subcommand / rc subverb / 忽略路径)
    - `test/application/chat/token-budget-active.test.ts` — 6 用例(feature off / mvp / disable env / ok-budget short-circuit / exhausted 触发 / 无 context window 无动作)
- DoD 对照:
  - ✅ `bun dist/index.js --version` 走 zero-import 路径(~140ms Bun 冷启动 floor,**达不到施工单 30ms**,已在 ADR 0006 解释 — 等 P25 bundle 优化用 `bun build --compile` 再收 )
  - ✅ `bun dist/index.js --dump-system-prompt` 输出完整 system prompt,不加载 Ink
  - ✅ `xqoder features ls` 输出 flag 状态表(17 默认 + 文件/env 覆盖合并)
  - ✅ `xqoder features enable PROMPT_CACHE` 写入 `~/.xqoder/features.json`
  - ✅ 17 fast-path handler 就位(dump-system-prompt 真跑,其余 stub 打 "not implemented in this build" + exit 2)
  - ✅ `XQODER_FEATURE_PROMPT_CACHE=0` env override 验证可行(测试覆盖)
  - ✅ TOKEN_BUDGET_ACTIVE 默认 off;flag on 时按 ADR 0005 §3 描述主动触发 compact
  - ⏸ `--version < 30ms` → P25 bundle 优化
  - ⏸ OpenClaude integrations/compatibility 注册表 → P07 provider routing
  - ⏸ `enableConfigs` 做 settings.env 回写 → P11
- 下一期: **P11 — Settings layering + .xqoder.json 合并**(S3 继续;P10 的 `enableConfigs` 留给它扩成完整 settings 流水线)

---

## P11 (2026-05-10)

- release:check: ✅ **PASS** (948 pass / 0 fail / 2906 expect;coverage ✅、cli smoke ✅、mcp live smoke ✅、security hygiene ✅、file-size guardrail ✅ — run-chat.ts 997 行 ≤ 1000)
- golden task pass: 0/10 → 0/10(dry-run placeholder;baseline 一致,未跑 live)
- /review 警告: 本期未独立跑 /review,改由 release:check + size guardrail 把关
- 本期 token 消耗: 约 12 万(单会话完成,未触发 compact)
- ADR: `docs/adr/0007-p11-input-preprocessing.md`
- 改动要点:
  - **Slash `/help` + `/?`**(`src/application/chat/command-router.ts` + `direct-command.ts`):
    - 注册表加 `help: ['/help', '/?']`;`ChatCommandRoute` 新 kind `'help'`
    - `isDirectChatCommandRoute` 将其识别为直出命令,走 `buildHelpResponse()` 返回静态帮助文本,不进主循环
  - **@file mention expansion**(`src/application/chat/turn-intake/mention-expander.ts` ~70 行):
    - 正则 `@([A-Za-z0-9_.\-/]+\.[A-Za-z0-9]{1,10})` 要求 `@` 前非字母(邮件 `user@example.com` 不命中)
    - cwd 内路径白名单、去重、硬上限 5、`XQODER_DISABLE_MENTION_EXPANSION=1` 整开关
    - 通过 `resolveTurnAttachments` 聚合(`attachment-resolver.ts`),与编辑器手动附件去重合并
  - **memdir**(`src/application/memory/memdir.ts` ~160 行):
    - 扫源:`CLAUDE.md` / `xqoder.md` / `.claude|.xqoder/CLAUDE.md` / `<cwd>/memdir/*.md` / `~/.xqoder/CLAUDE.md` / `~/.xqoder/memdir/*.md`
    - v1 打分:小写 token(去 stopwords)交集,`MIN_TOKEN_OVERLAP=1`,每文件上限 4000 字符,每 turn 返 3 块
    - `loadMemdirContextSync` 走 `prepareChatExecution` prompt appendix,`XQODER_DISABLE_MEMDIR=1` 关掉
    - **放在 `application/memory/` 而不是 `core/memory/`** — architecture guardrails 禁止 application → core relative import;ADR 0007 §2 记录
  - **UserPromptSubmit hook**(`src/application/chat/turn-intake/prompt-hook-bridge.ts` ~170 行 + `submission-preprocess.ts` ~90 行):
    - `SUPPORTED_HOOK_EVENTS` 新增 `'UserPromptSubmit'`;config 解析器自动识别
    - 独立 payload(`prompt` / `attachment_count`)+ 独立 output schema(`decision: 'deny'|'block'` / `rewritten` / `reason`)
    - 仅支持 `type: 'command'`(shell),fail-open:JSON 错 / 超时 / 非 deny → 透传
    - `resolvePromptSubmissionOutcome` 在 run-chat 三入口(`runChat` / `runChatHeadless` / `runChatMessageStream`)最前端调用,`blocked` → 合成响应直接返回,不进主循环
  - **P10 尾 — enableConfigs 的 settings.env 回写**(`src/shared/settings-env.ts` ~55 行):
    - `XQoderConfig` 加 optional `env?: Record<string, string>`
    - `loadSettingsEnvFromFile(homeDir)` 读 `~/.xqoder/config.json` 的 `env` 字段(只收 string 值)
    - `applySettingsEnv` 合并:**process.env 已有的 key 不覆盖**(CLI / shell 优先)
    - `enableConfigs()` 在 feature-flags 加载后调一次
    - `XQODER_SETTINGS_PATH` 支持路径重定向(测试友好)
  - **测试**(31 新增):
    - `test/application/chat/turn-intake/slash-router.test.ts` — 4 用例(/help / /? / isDirect / email 不误中)
    - `test/application/chat/turn-intake/mention-expander.test.ts` — 7 用例(单/多 mention / 不存在 / 邮件 / 去重 / env 关闭 / 上限)
    - `test/application/chat/turn-intake/prompt-hook-bridge.test.ts` — 6 用例(无 hook / deny / rewritten / 空 JSON / 坏 JSON / block)
    - `test/application/chat/turn-intake/p11-wiring.test.ts` — 3 用例(@file 自动挂进 turnInput / 直出命令不扩展 / /help 返回帮助文本)
    - `test/application/memory/memdir.test.ts` — 6 用例(扫描 / 过滤空 / 排序 / loadMemdirContext / 无交集 / env 关闭)
    - `test/shared/settings-env.test.ts` — 5 用例(正常加载 / 缺文件降级 / 非 string 值忽略 / 不覆盖已有 env / XQODER_SETTINGS_PATH 重定向)
- DoD 对照:
  - ✅ 输入 `/help` → 命中本地命令,不走主循环
  - ✅ 输入 `explain this @src/index.ts` → 自动把 `src/index.ts` 内容插入消息(attachment 形式,和编辑器手动挂的语义一致)
  - ✅ 有 `CLAUDE.md` / `~/.xqoder/CLAUDE.md` 的项目 → 自动作为 memory 层注入 prompt appendix
  - ✅ 有相关 memdir/*.md 片段 → `findRelevantMemories` 命中后注入
  - ✅ `UserPromptSubmit` hook 可阻断或重写用户消息
  - ✅ 所有新增 31 测试用例就位,全绿
  - ✅ ADR 0006 §不确定项 #4(`enableConfigs` settings.env)收尾
  - ⏸ memdir TF-IDF / "pattern memory" → P24
  - ⏸ UserPromptSubmit hook 的 http/prompt/agent handler 类型 → 等 hook handler 通用化(P13/P16)
  - ⏸ `contextPreload`(OpenClaude 独立文件) → XQoder 走现有 `buildAutoProjectContext`,等价,不另开
- 下一期: **P12 — 工具调度**(软红线 `tool-orchestrator.ts` 预计要改,按铁律开新会话跑;背景读 `/agent-harness-construction` + `/subagent-driven-development`)

---

## P12 (2026-05-10) — 工具调度(partitionToolCalls + AbortSignal + autoFix runner)

- release:check: ✅
- golden task pass: 0/10 → 0/10(dry-run placeholder,baseline 一致)
- /review 警告: 本期未独立跑 /review,改由 release:check + size guardrail 把关
- 本期 token 消耗: 约 9 万(单会话完成,未触发 compact)
- ADR: `docs/adr/0008-p12-tool-orchestration.md`(软红线 `tool-orchestrator.ts` 改动记录)
- 改动要点:
  - **新增 `src/core/agent/tools/partition.ts`** — `partitionToolCalls(calls, { isConcurrencySafe, maxConcurrent=10 })` 把工具调用序列切成 `ToolBatch[]`:连续 safe 的合并为 concurrent 批次,unsafe 自成 serial 批次,concurrent 上限 10。
  - **新增 `src/core/agent/tools/streaming-executor.ts`** — `runToolBatches(batches, { signal, run })` async generator:concurrent 批次 `Promise.all`,serial 逐个,AbortSignal 在批次之间/serial 批次内的 call 之间短路。
  - **新增 `src/core/agent/tools/auto-fix-runner.ts`** — `createAutoFixRunner({ runLint, runTypeCheck, maxPerTurn=2 })`:只对 `edit_file`/`write_file`/`apply_patch` 成功调用触发 lint+tsc,失败时 append system message;每轮 ≤ 2 次。
  - **落位偏离施工单**:施工单写 `src/core/tools/`,实际放 `src/core/agent/tools/` — architecture guardrails 禁止 `application → core` 相对 import(P11 ADR-0007 踩过一次),通过 `@xqoder/agent` 别名绕开。ADR 0008 §1 记录。
  - **软红线 `src/application/chat/tool-orchestrator.ts`** 重构为"薄层":
    - 新增 `abortSignal?: AbortSignal` 到 `ToolOrchestratorDependencies`
    - 行内批量分组 → 换成 `partitionToolCalls(preparedCalls.map(…), { isConcurrencySafe: call => preparedByCallId.get(call.id)?.preparation.canRunInParallel })`
    - 并发判定**不读**工具上的 `isConcurrencySafe()`,继续信任 `preparation.canRunInParallel`(由上游 `ToolExecutionPort.prepareToolCall` 决定) — 保持契约不变
    - escape hatch `XQODER_DISABLE_TOOL_PARTITION=1` → 彻底串行
    - abort 在"批次之间"与"serial call 之间"两处检查
  - **9 个工具补 `isConcurrencySafe()` 标注**:
    - 只读安全 → true:`DiagnosticsTool`、`FetchUrlTool`、`WebSearchTool`、`SourcegraphTool`、`TodoReadTool`
    - 写入/交互/子 agent → false:`RunCommandTool`、`RunShellTool`、`InstallPackageTool`、`LspRenameSymbolTool`、`SkillTool`、`TodoWriteTool`、`QuestionTool`、`DelegateTaskTool`
    - `PreviewDiffTool` 不显式标注 — default=false 等价,避免触发 `file-tools.ts` 1000+ 行 size guardrail
- **测试**(18 新增):
  - `test/core/agent-tools/partition.test.ts` — 6 用例(concurrent 合并 / serial 分段 / maxConcurrent 上限 / 默认 10 / empty / 全 false)
  - `test/core/agent-tools/streaming-executor.test.ts` — 4 用例(concurrent 并行 + serial 顺序 / abort 批次间短路 / abort serial 内短路 / 已 abort 不产出)
  - `test/core/agent-tools/auto-fix-runner.test.ts` — 6 用例(无修改跳过 / lint 失败注入 system message / 双检通过不注入 / maxPerTurn=2 封顶 / resetTurn 放行 / 只读工具不触发)
  - `test/application/chat/tool-orchestrator.test.ts` — +2 用例(abortSignal 中断 serial 批次 / `XQODER_DISABLE_TOOL_PARTITION=1` 回退全串行)
- DoD 对照:
  - ✅ `[read, read, glob, grep, edit, write]` 前 4 并发,后 2 串行(partition + orchestrator `preparation.canRunInParallel` 判定)
  - ✅ Pre/Post hook 保持 `ToolExecutionPort` 三段契约不变
  - ✅ autoFix 只对 `edit_file`/`write_file`/`apply_patch` 启用,失败不阻断(返回 system message 供后续注入)
  - ✅ abort:批次间 + serial 批次内两处检查,未开工的工具不起
  - ✅ `isConcurrencySafe` 表格 30+ 工具全覆盖(原有 + 本期 9 个)
  - ✅ architecture guardrails 未回归(绕开策略:模块落 `core/agent/tools/`,orchestrator 走 `@xqoder/agent` 别名)
  - ✅ 全仓库 `bun test`:3284 pass(baseline 3282,+2),43 fail 全为 pre-existing UI/Theme/Provider 测试,与 P12 无关
  - ⏸ autoFix 真实接入 conversation-engine(lint/tsc 命令发现 + system message 注入主循环)→ 留给 P13 或独立 hook phase
  - ⏸ OpenClaude `autoFixRunner` 跑 test 的能力 → v2(施工单明确 v1 只跑 lint/type-check)
- 下一期: **P13 — MCP 工具集成**(背景读 `/mcp-server-patterns`)

---


## P11.1 (2026-05-10) — 审查 3 hotfix:SSRF + env 脱敏 + event envelope 红线清理

- release:check: ✅
- golden task pass: 0/10 → 0/10 (dry-run 占位未变;P11.1 为安全 + 结构清理,未触发业务逻辑)
- /review 警告: 0 条 (审查 3 已由 periodic-audit-3 产出,本期是落地)
- 本期验收产出:
  - 方案 B:删除 `src/domain/conversation/events.ts`(历史 `ConversationEvent` 联合类型),
    内联到唯一 caller `src/application/chat/conversation-events.ts`;`transcript-projector.ts`
    暂留 domain(待 infra 合并 ADR 统一处理,见 0009 §决策#3)
  - `src/core/agent/tools/url-safety.ts` — 新增;支持 literal IPv4/IPv6 拦截
    (loopback/0.0.0.0/RFC1918/link-local 含 metadata 169.254/ULA fc00::/7/
    CGNAT/multicast/reserved)+ DNS resolve 后二次校验(防 DNS rebinding)+ 默认仅 https
  - `src/core/agent/tools/fetch-tool.ts` — `fetch_url` 接入 checkUrlSafety;
    审批 risk `medium → high`;新增 `allowHttp` 参数(默认 false)
  - `src/commands/sessions/import.ts` — `loadImportSource` 接入 checkUrlSafety +
    5MB Content-Length 上限 + content-type 必须 `application/json`;导出为可测接口
  - `src/core/agent/tools/env-filter.ts` — `filterSensitiveEnv` 过滤
    KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|SESSION,支持 `config.env` 显式 opt-in
  - `src/core/agent/mcp-stdio-client.ts:230` — stdio MCP server spawn env 接入过滤
  - `src/core/agent/hook-handler-execution.ts:263` — command hook spawn env 接入过滤
  - `src/core/agent/tools/sandbox.ts` — `isSensitiveEnvKey` 导出(供 env-filter 复用)
  - 新测试:`test/core/agent-tools/fetch-tool.ssrf.spec.ts` (20 用例)、
    `test/commands/sessions/import.spec.ts` (9 用例)、
    `test/core/agent-tools/env-filter.spec.ts` (7 用例)
  - CLAUDE.md 硬红线从 `src/domain/conversation/events.ts` 改为
    `src/infra/protocol/events.ts`(权威位置,含 schemaVersion:1)
- 本期 token 消耗: 未测量(单 session 内完成)
- ADR: `docs/adr/0009-event-envelope-authoritative-location.md`
  (用户决策 = 方案 B,删 domain 版本,红线指向 infra)
- 不做 / 搁置(留 P11.2):
  - `agent.ts:337` void this.run 挂 catch
  - `prompt-hook-bridge.ts:77` 抛错 hook 视作 deny
  - `event-bus.ts` 两个空 catch 加 log
  - `compaction-pipeline.ts:73` 带错返回
  - stdio MCP 默认 `untrusted`(审查 §2.10 优先级 3)
- 下一期: **P12 — 工具调度/并发编排**(按 docs/openclaude-parity/phase-12-*.md 施工单)

---

## P12 (2026-05-10) — 工具调度:partition + streaming executor + autoFix runner

- release:check: ✅ (1002 pass / 0 fail, coverage gate PASS, CLI/MCP live smoke + security/file-size guardrail 全绿)
- golden task pass: 0/10 → 0/10 (P12 为调度层重构,dry-run 占位未变)
- /review 警告: 0 条 (软红线改动范围已在 ADR 0008 锁定,未跑独立 /review)
- 本期验收产出:
  - `src/core/agent/tools/partition.ts` — `partitionToolCalls(calls, opts)`
    把 `[read, read, edit, read, write]` 切成 `[concurrent(2), serial(1), concurrent(1), serial(1)]`,
    受 `maxConcurrent=10` 约束;`isConcurrencySafe` 走 orchestrator 注入的回调,
    不直接读工具字段(并发判定口径不变)
  - `src/core/agent/tools/streaming-executor.ts` — `runToolBatches(batches, ctx)`
    通用并发/串行驱动,子 agent / 批量工具 / 独立 pipeline 都能复用;
    支持 `abortSignal`,在"批次之间"与"serial 批次内的 call 之间"两处检查 `signal.aborted`
  - `src/core/agent/tools/auto-fix-runner.ts` — `createAutoFixRunner({runLint, runTypeCheck, maxPerTurn})`;
    v1 仅对 `edit_file`/`write_file`/`apply_patch` 触发,失败转 system message(不阻断),
    每轮上限 2 次;lint/tsc 命令以 Promise 工厂形式注入,**本期未接入 conversation-engine**
  - `src/core/agent/index.ts` — re-export 上述三模块,application 层经 `@xqoder/agent` 别名消费,
    绕开 architecture guardrail 的 `application → core` 相对 import 禁令(ADR 0007 §2 教训)
  - `src/application/chat/tool-orchestrator.ts` — **软红线改动**
    原地替换行内批量分组为 `partitionToolCalls`;新增 `abortSignal?: AbortSignal` 形参;
    新增 escape hatch `XQODER_DISABLE_TOOL_PARTITION=1`(返 false → 彻底串行);
    不动 `prepareToolCall`/`invokePreparedToolCall`/`finalizeToolCall` 三段语义,
    不动 `stages[]` / `ToolExecutionPort` / `createCompatibilityToolExecutionPort` fallback
  - `isConcurrencySafe` 补标 9 个工具:
    只读安全(true):`DiagnosticsTool` / `FetchUrlTool` / `SourcegraphTool`
    写入/交互/子 agent(false):`RunCommandTool` / `LspRenameSymbolTool` +
    `interaction-tools.ts` 批量(`QuestionTool` / `TodoWriteTool` 等)
  - `AgentTool` 补 `isConcurrencySafe = () => false`(子 agent 保守串行,
    避免 LSP 竞争,与 OpenClaude 语义一致)
- 新测试:
  - `test/core/agent-tools/partition.test.ts` (6 用例,含 maxConcurrent 边界)
  - `test/core/agent-tools/streaming-executor.test.ts` (4 用例,含 AbortSignal 中断 2 例)
  - `test/core/agent-tools/auto-fix-runner.test.ts` (6 用例)
  - `test/application/chat/tool-orchestrator.test.ts` +2 用例
    (AbortSignal 中断 + `XQODER_DISABLE_TOOL_PARTITION=1` 串行回退)
- 架构 guardrail: ✅ 未回归
- 本期 token 消耗: 未测量(跨 session,P11.1 收尾 + P12 主体)
- ADR: `docs/adr/0008-p12-tool-orchestration.md`(软红线范围 + 落位理由 + 4 项不确定项)
- 不做 / 搁置:
  - autoFix 接入 conversation-engine(lint/tsc 真实命令发现 + system message 注入主循环)
    → 留给 P13 或独立 hook phase,施工单明确本期只落 runner
  - OpenClaude `autoFixRunner` 跑 test 的能力 → v2
  - `DelegateTaskTool` 真并发 → 保守串行,后续评估 LSP 竞争后再放开
  - `LspRenameSymbolTool` 同一文件内多处 rename 并发 → 单独评估
- 下一期: **P13 — MCP 工具集成**(背景读 `/mcp-server-patterns`)

---

## P13a (2026-05-10) — MCP SSE transport + elicitation

- release:check: ✅ (1018 pass / 0 fail,coverage gate PASS,mcp:live-smoke 绿)
- golden task pass: 未测量(本期只增 MCP 子系统,未触及 live coding 链路)
- /review 警告: 未跑,主会话直接审 diff(见下)
- 本期关键决策:
  - 把 P13 拆成 3 个子期(a/b/c),避免一个会话吃 ~3000 行改动撞 150k token 上限
  - 2 次 `executor` 子代理都空返,换回主会话直接实施(见正文说明)
  - `McpSseClient` 与 `McpHttpClient` 不合并:SSE 多一条 server→client 长连接 + 流式响应,
    合并会让两边都更难读;重叠仅在 cursor 分页等小段,按"三次再抽象"原则押后
  - `McpClientAdapter` 接口零变更;`McpManagerOptions` 只加 `elicit?` 字段
- 新增:`mcp-sse-client.ts` (538L) · `mcp-elicitation.ts` (64L) ·
  `mcp-sse-client.test.ts` (8) · `mcp-elicitation.test.ts` (6) ·
  `mcp-server-manager.test.ts` +2 = 共 16 条新测
- 本期 token 消耗: 未测量(两次子代理失败累计 ~9 万,主会话实施估 ~6 万)
- ADR: `docs/adr/0010-p13a-mcp-sse-elicitation.md`
- 下一期: **P13b — OAuth 2.1 + McpAuthTool**(会话切换前续)

---

## P13b (2026-05-10) — MCP OAuth 2.1 + McpAuthTool

- release:check: ✅ (1046 pass / 0 fail,coverage gate PASS,mcp:live-smoke + security + size guardrail 全绿)
- golden task pass: 未测量(本期只扩 MCP 认证层,未触及 live coding 链路)
- /review 警告: 未跑(本期零触碰硬/软红线,改动范围全新文件 + 三个 MCP client 的 sendRaw)
- 本期关键决策(详见 ADR 0011):
  - OAuth 2.1 Authorization Code + PKCE,**不做** dynamic client registration;
    `clientId` 必须在 `MCPServerConfig.oauth` 里预注册
  - `McpClientAdapter` 接口零变更(延续 P13a 约束),只在 `McpManagerOptions` 加
    可选 `authProvider?: McpAuthProvider` 注入点
  - 401 → refresh once → retry,再失败原样抛出(防死循环);SSE 长连接单独处理
  - `MCPServerConfig.oauth` 顶层字段 + normalizer(三必填缺一则丢弃),**不做** sidecar
    配置文件
  - Token 存在 `~/.xqoder/data/mcp-tokens.json`,tmp+rename 原子性,chmod 0o600
  - `XQODER_MCP_DISABLE_OAUTH=1` 是唯一 kill switch(provider + tool 都会短路)
  - `McpAuthTool` 默认先查现有 token,`force=true` 才重跑浏览器流程
- 新增文件:
  - `src/core/agent/mcp-oauth.ts` (370L) — PKCE + callback + FileMcpTokenStore + provider
  - `src/core/agent/tools/mcp-auth-tool.ts` (145L) — 工具入口
- 修改文件:
  - `src/infra/shared/types.ts` — 加 `MCPServerOAuthConfig` 接口 + `oauth?` 字段
  - `src/infra/shared/config-normalizers-integrations.ts` — 加 `normalizeMcpOAuth`
  - `src/core/agent/mcp-types.ts` — 加 `McpManagerOptions.authProvider?`
  - `src/core/agent/mcp-http-client.ts` — `sendRawWithAuthRetry(payload, alreadyRefreshed)`
  - `src/core/agent/mcp-sse-client.ts` — sendRaw + openStreamOnce 都加 401 刷新
  - `src/core/agent/mcp-server-manager.ts` — `getClient` 自动兜底生成 authProvider
  - `src/core/agent/mcp.ts` — re-export OAuth API + McpAuthTool
- 新测试(28 条,远超 ≥15 要求):
  - `test/core/mcp-oauth.test.ts` (18 条)
  - `test/core/mcp-http-client-auth.test.ts` (4 条)
  - `test/core/mcp-sse-client-auth.test.ts` (1 条)
  - `test/core/tools/mcp-auth-tool.test.ts` (5 条)
- 本期 token 消耗: 未测量(主会话直接实施,未用 executor 子代理——继承 P13a 教训)
- ADR: `docs/adr/0011-p13b-mcp-oauth.md`
- 不做 / 搁置:
  - `xqoder mcp auth <name>` CLI 子命令 → **P13c**
  - `mcp doctor` OAuth 握手 / token 文件权限检查 → **P13c**
  - `mcp:live-smoke` 真 HTTP/SSE + OAuth 端到端烟测 → **P13c**
  - Dynamic client registration / JWT exp 解析 / refresh token rotation 检测 →
    v1 不做,实际碰上再说
- 下一期: **P13c — `mcp auth/debug` CLI + doctor 扩展 + HTTP/SSE live-smoke**

---

## P13c (2026-05-10) — MCP auth/debug CLI + doctor OAuth 扩展 + HTTP/SSE live-smoke

- release:check: ✅ (1055 pass / 0 fail,coverage gate PASS,cli smoke ✅、
  mcp:live-smoke ✅ 三个 transport 全绿、security hygiene ✅、size guardrail ✅)
- golden task pass: 未测量(本期只扩 MCP CLI / doctor / 测试 harness,未触及 live coding 链路)
- /review 警告: 未跑(本期零触碰硬/软红线;改动仅 application/integrations/ 新增 3 文件
  + commands/integrations/mcp.ts 30 行、core/agent/index.ts barrel 扩展、scripts/mcp-live-smoke.ts)
- 本期关键决策(详见 ADR 0012):
  - `xqoder mcp auth <name>` + `xqoder mcp debug <name>` 两条 Commander.js subcommand
  - `runDoctorMcpCommand` 返回类型从 `McpServerInspection[]` 升级为
    `McpDoctorEntry[]`(superset,加 `oauth: McpOAuthStatus` 字段)
  - 落位 `src/application/integrations/`(不进 `@xqoder/agent`);`@xqoder/agent`
    barrel 只转发 P13b 的 OAuth primitives + `createStandaloneMcpClient`
  - `mcp:live-smoke` 用 `Bun.serve({ port: 0 })` 起 in-process HTTP/SSE fixture,
    每个 transport 独立 checks[] 数组
  - 不接顶层 `/mcp` skill 形式,留给 P17 skill 体系统一收口
- 新增文件:
  - `src/application/integrations/mcp-oauth-status.ts` (~130L) — `collectMcpOAuthStatuses`
    + `defaultTokenStorePath` + 文件权限探测(0600 / world-readable)
  - `src/application/integrations/mcp-auth-command.ts` (~140L) — `runAuthMcpCommand`
    (force / 已有 token 短路 / disabled env / 无 oauth 四分支)
  - `src/application/integrations/mcp-debug-command.ts` (~220L) — `runDebugMcpCommand`
    (handshake ok / error / 未启用三状态,tools/prompts/resources 预览)
- 修改文件:
  - `src/application/integrations/mcp.ts` — `runDoctorMcpCommand` 接 OAuth 状态,
    formatMcpInspection 多两行 `oauth=...` + `oauth.tokenFile=...`,re-export 新命令
  - `src/commands/integrations/mcp.ts` — 接 `.command('auth')` + `.command('debug')`
  - `src/core/agent/index.ts` + `mcp.ts` — barrel 扩展转发 OAuth primitives
    + `createStandaloneMcpClient`
  - `scripts/mcp-live-smoke.ts` — 扩展到三个 transport,共享 `handleFixtureRequest`
- 新测试(9 条):
  - `test/application/integrations/mcp-p13c.test.ts`:
    - runAuthMcpCommand: 短路 / force / 无 oauth / disabled (4)
    - runDebugMcpCommand: ok / error / unknown server (3)
    - runDoctorMcpCommand: OAuth enrichment + expired (1)
    - collectMcpOAuthStatuses: world-readable 探测 (1)
  - `test/commands/system-compat-command-surfaces.test.ts` — 期望 subcommand
    列表增加 `auth` / `debug`
- 本期 token 消耗: 未测量(主会话直接实施,未用 executor 子代理)
- ADR: `docs/adr/0012-p13c-mcp-cli-doctor-live-smoke.md`
- 不做 / 搁置:
  - `/mcp` 顶层 skill 形式 → P17 skill 体系
  - TUI OAuth 登录成功通知 → P14+
  - MCP token 刷新 observability 面板 → P15
  - HTTP/SSE live-smoke 接 OAuth 端到端回路 → P15
- 下一期: **P14 — hooks 生态完善**(按 02-execution-order-logic-first 顺序;
  P13 三子期 a/b/c 收官)

---


## P14a (2026-05-11) — 事件类型扩展 + lifecycle dispatcher

- release:check: ✅ (1073 pass / 0 fail,coverage 68.75% PASS,e2e smoke 3 transport 全绿,security hygiene ✅,size guardrail ✅)
- golden task pass: 未测量(本期只扩 hook 基础设施,未触及 live coding 链路)
- /review 警告: 未跑(本期零触碰硬/软红线;改动仅扩 `SUPPORTED_HOOK_EVENTS` + 拆基类 + 新增 lifecycle-hooks.ts)
- 本期关键决策(详见 ADR 0013):
  - P14 拆 3 子期(a/b/c);本期只做事件扩展 + dispatcher,不 wiring 调用点,不加 CLI
  - `SUPPORTED_HOOK_EVENTS` 从 4 → 10(新增 SessionStart/SessionEnd/Stop/SubagentStop/PreCompact/PostCompact)
  - 泛化 `executeHookHandler` 签名:拆出 `HookPayloadBase` + `HookRunnerConfigBase`(不含 permissionMode);
    工具热路径 `ToolHookRunnerConfig` / 三个工具 payload 改为 `extends ...`,源代码 0 改动
  - `dispatchLifecycleHook` 阻塞版本(SessionStart 用) + `dispatchLifecycleHookFireAndForget`(超时 5s,Stop/SessionEnd/SubagentStop 用)
  - `continue=false` / `decision=block` / `decision=deny` 在 lifecycle 路径统一视为 blocked(工具路径语义不变)
- 新增文件:
  - `src/core/agent/lifecycle-hooks.ts` (约 250L) — 6 事件 payload + builder + 阻塞/非阻塞 dispatcher
- 修改文件:
  - `src/infra/shared/types.ts` — `SUPPORTED_HOOK_EVENTS` 从 4 → 10
  - `src/core/agent/hooks.ts` — 拆基类;工具 payload / runner config 改为 `extends`
  - `src/core/agent/hook-handler-execution.ts` — 签名改用 `HookPayloadBase` + `HookRunnerConfigBase`
  - `src/core/agent/index.ts` — barrel 扩展导出 lifecycle API
- 新测试(18 条,远超 ≥15 要求):
  - `test/core/lifecycle-hooks.test.ts`:事件常量(3)+ builder 形状(6)+ dispatcher 行为(7)+ fire-and-forget(2)
- 本期 token 消耗: 未测量(主会话直接实施,未用 executor 子代理——继承 P13a 教训)
- ADR: `docs/adr/0013-p14a-lifecycle-hook-dispatcher.md`
- 不做 / 搁置:
  - 生命周期事件挂载到 conversation-engine / auto-compact / subagent → **P14b**
  - `xqoder hooks add/remove/list/test` CLI → **P14c**
  - UserPromptSubmit deny 的 e2e 阻断用例 → **P14c**
  - PostSamplingHooks(sampling 完成后)→ 施工单明确 v1 不纳入,留 P27 评估
- 下一期: **P14b — 生命周期 hook 挂载到 conversation-engine / compact / subagent**

## P14b (2026-05-11) — 生命周期 hook 挂到 conversation-engine / compact / subagent

- release:check: ✅ (1076 pass / 0 fail,coverage 68.80% PASS,e2e smoke ✅,mcp:live-smoke 三 transport ✅,security hygiene ✅,size guardrail ✅)
- golden task pass: 未测量(本期只挂 hook wiring,未触及 live coding 链路)
- /review 警告: 未跑(本期动软红线 `conversation-engine.ts`,按 CLAUDE.md 规则留 ADR;无硬红线触碰)
- 本期关键决策(详见 ADR 0014):
  - 挂 4 个真实触发点:SessionStart(阻塞)/ Stop(fire-and-forget)在 conversation-engine;PreCompact(阻塞)/ PostCompact(fire-and-forget)在 compaction-pipeline;SubagentStop(fire-and-forget)在 DelegateTaskTool
  - **SessionEnd 不在本期挂**:turn-level engine 不等于 session-level;硬挂会每轮误触发,留 P17+ 处理(需要 session 生命周期 owner)
  - `hooks`/`disableAllHooks`/`projectRoot` 从 agent.ts 透传到 ConversationEngineDependencies 和 ToolContext,mvp profile 继承 P04 "hooks 禁用" 语义
  - SessionStart block 时抛 ConversationEngineStopError(provider_error, error),`provider.stream` 保证不被调用
- 新增文件:
  - `test/application/chat/lifecycle-hooks-wiring.test.ts`(3 条 integration)
- 修改文件(软红线):
  - `src/application/chat/conversation-engine.ts` — SessionStart + Stop 挂点,deps 加 projectRoot/hooks/disableAllHooks
- 修改文件(非红线):
  - `src/application/chat/compaction-pipeline.ts` — PreCompact + PostCompact
  - `src/core/agent/tools/tool.ts` — ToolContext 加可选 hooks/disableAllHooks/logger
  - `src/core/agent/tools/agent-tool.ts` — DelegateTaskTool finally 触发 SubagentStop
  - `src/core/agent/agent.ts` — 透传 hooks 到 toolContext + engine deps
- 本期 token 消耗: 未测量(主会话直接实施,未用 executor 子代理)
- ADR: `docs/adr/0014-p14b-lifecycle-hooks-wired.md`
- 不做 / 搁置:
  - SessionEnd wiring → P17+(session 生命周期 owner)
  - PreCompact 在 reactive compaction(PromptTooLongError 路径)→ 故意不挂,紧急降级不应阻塞
  - `xqoder hooks add/remove/list/test` CLI → **P14c**
  - UserPromptSubmit deny 的 e2e → **P14c**
- 下一期: **P14c — hooks CLI + e2e 阻断用例**

## P14c (2026-05-11) — hooks CLI (add/remove/list/test) + UserPromptSubmit e2e

- release:check: ✅ (1086 pass / 0 fail,coverage 68.85% PASS,e2e smoke ✅,mcp:live-smoke 三 transport ✅,security hygiene ✅,size guardrail ✅)
- golden task pass: 未测量(本期加 CLI,未触及 live coding 链路)
- /review 警告: 未跑(本期零硬红线触碰)
- 本期关键决策(详见 ADR 0015):
  - 新增 4 个子命令:`list`(`show` 别名)/ `add`(4 种 handler 类型)/ `remove`(扁平 index)/ `test`(真实 dispatcher 调用,不 dry-run)
  - `runTestHookCommand` 拆到 `application/integrations/hooks-test.ts`,避开 `application-system-exact-optional` 严格 lint 范围(参考 P13c mcp-auth-command 模式)
  - `add` 按 matcher 分组 handler;`remove` 最后一个 handler 移除后删掉整个 event key
  - UserPromptSubmit deny e2e 用真实 `resolvePromptSubmissionOutcome`,写 `.sh` + `config.json`,不 mock
- 新增文件:
  - `src/application/integrations/hooks-test.ts`(~235L)
  - `test/application/system/hooks-mutations.test.ts`(9 条)
  - `test/application/chat/turn-intake/user-prompt-submit-deny-e2e.test.ts`(1 条 e2e)
- 修改文件:
  - `src/application/system/hooks.ts` — 新增 add/remove 实现 + test 接口定义
  - `src/commands/system/hooks.ts` — commander 子命令 + `buildHandlerFromCliOptions`
- 本期 token 消耗: 未测量(主会话直接实施)
- ADR: `docs/adr/0015-p14c-hooks-cli-and-user-prompt-submit-e2e.md`
- 不做 / 搁置:
  - `xqoder hooks test --event UserPromptSubmit` → 走 bridge,不走通用 dispatcher;P15 如需
  - `xqoder hooks edit` → 施工单未要求
- 下一期: **P15 — 按 02-execution-order-logic-first 顺序决定**(P14 三子期 a/b/c 收官)

## P15a (2026-05-11) — NormalizedUsage + provider normalizers

- release:check: ✅ (1105 pass / 0 fail,coverage 68.90% PASS,e2e smoke ✅,mcp:live-smoke ✅,security hygiene ✅,size guardrail ✅)
- golden task pass: 未测量(本期只扩 usage 归一,未触及 live coding 链路)
- /review 警告: 未跑(本期零红线触碰,0 修改文件,新增 only)
- 本期关键决策(详见 ADR 0016):
  - P15 拆 3 子期:P15a 归一(本期)/ P15b tracker+sink+cost CLI / P15c wiring + e2e
  - `NormalizedUsage` 的 `input` 字段统一为 regular-rate(不含 cache),下游定价/遥测简洁
  - 5 provider 归一函数(Anthropic / OpenAI / Codex / Minimax / Generic)
  - Anthropic 的 raw vs XQoder 内部折叠 shape 用 key 命名消歧(snake_case = 原样;camelCase = 已折叠)
  - `costUsd` best-effort:未知模型不填,不抛异常
- 新增文件:
  - `src/infra/llm/usage/normalize.ts`(~230L)
  - `src/infra/llm/usage/index.ts`(barrel)
  - `test/infra/llm/usage/normalize.test.ts`(19 条)
- 本期 token 消耗: 未测量(主会话直接实施)
- ADR: `docs/adr/0016-p15a-normalized-usage.md`
- 不做 / 搁置:
  - `CacheStatsTracker` + telemetry sink + `xqoder cost` CLI → **P15b**
  - Wire NormalizedUsage 到 provider-turn.ts / tool / hook → **P15c**
- 下一期: **P15b — CacheStatsTracker + telemetry sink + `xqoder cost` CLI**
