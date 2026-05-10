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
