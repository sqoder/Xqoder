# P01 验收留底

**期次**：P01 — HTTP withRetry + 错误分级恢复
**验收日期**：2026-05-10
**验收 commit**：`7518ee2` (feat) + `1385019` (scaffolding)
**施工单**：`docs/openclaude-parity/phase-01-http-retry-fallback.md`

---

## 背景

P01 代码在验收会话开始前已由前序会话写入工作区（untracked）。本次验收
采用 **接盘核对** 模式：不改实现，只逐条对照施工单 DoD 读代码 + 跑测试，
把每一条可验证项的证据位置固化下来，留给 P02 接班。

---

## 方法

1. 读 `phase-01-http-retry-fallback.md` §成功判定（6 条错误行为 + lint + 签名约束）。
2. 读以下实现文件全文：
   - `src/infra/llm/retry/errors.ts`（169 行）
   - `src/infra/llm/retry/classify.ts`（208 行）
   - `src/infra/llm/retry/with-retry.ts`（149 行）
   - `src/infra/llm/retry/index.ts`（17 行，barrel）
3. 读测试 `test/infrastructure/llm-retry.test.ts`（352 行，26 用例）全文。
4. Diff `src/infra/llm/{anthropic,openai/provider}/index.ts` 与
   baseline `c96a0f2`，核对 provider wiring 是否满足"只包 withRetry、
   签名不变"约束。
5. 结构性对比 `openclaude/src/services/api/withRetry.ts`（879 行）
   首 60 行，评估 clean-room 声明的可信度。
6. 跑 `bun run release:check` + `bun test test/infrastructure/llm-retry.test.ts`。

---

## DoD 逐条证据

### 1. `429 + retry-after: 3` → 等 3s 重试，最多 5 次

- **分类**：`classify.ts:85-91` — 429 / 503 → `ThrottleError`，从
  `retry-after` 头解析 `retryAfterMs`。解析器 `parseRetryAfter`
  (`classify.ts:185-198`) 同时支持"秒数"和"HTTP-date"两种形式。
- **读 header**：`readHeader` (`classify.ts:158-178`) 同时适配普通对象和
  Fetch `Headers` 实例（后者用 `.get()`）。
- **次数上限**：`with-retry.ts:15` `MAX_ATTEMPTS_BY_KIND.throttle = 5`。
- **延迟计算**：`with-retry.ts:111-114` — 有 `retryAfterMs` 则用 header
  值，`clamp` 到 `MAX_BACKOFF_MS (16_000)`。
- **测试证据**：
  - `test:173-187` "retries throttle errors using Retry-After"：对 `retry-after: 2` 断言 `sleeps=[2000, 2000]`。
  - `test:203-215` "gives up on throttle after 5 retries (6 attempts total)"：断言 `calls=6`（1 初 + 5 retry）。
  - `test:330-339` "clamps oversized Retry-After to MAX_BACKOFF_MS"：对 `retry-after: 9999` 断言 sleep ≤ 16000ms。
  - `test:341-351` "uses exponential backoff for throttle without Retry-After"：断言 `[1000, 2000, 4000]` 指数退避。
- **结论**：✅ 完全覆盖，外加 clamp 与无 header 退避两个额外边界。

### 2. `529 Overloaded` → 最多 3 次退避重试，仅前台

- **分类**：`classify.ts:78-82` — `status === 529` **或** 嵌套
  `error.type === 'overloaded_error'` 均归为 `OverloadError`。覆盖
  Anthropic 非 529 而在 body 里带 overloaded_error 的情况。
- **前台约束**：`with-retry.ts:82-84` —
  `canRetry = attempt < max && (kind !== 'overload' || foreground === true)`。
  默认 `foreground` 不传时为 `undefined`，**不等于 true**，等价于不重试；
  两个 provider 调用点显式传 `foreground: true`（见 §Provider wiring）。
- **次数上限**：`with-retry.ts:16` `overload = 3`。
- **退避**：`with-retry.ts:122` 走 `exponentialBackoff`（1s/2s/4s，+jitter）。
- **测试证据**：
  - `test:62-66` "classifies 529 overloaded_error as OverloadError"。
  - `test:68-74` "classifies Anthropic body `{ error.type: 'overloaded_error' }` as OverloadError"（注意这条用的是 `status: 500`，验证即使 status 不是 529 也能靠 body 识别）。
  - `test:217-227` "does not retry overload when foreground=false"：断言 `calls=1`。
  - `test:229-239` "retries overload up to 3 times when foreground=true"：断言 `calls=4`。
- **结论**：✅ 完全覆盖。

### 3. `401 + OAuth` → refresh 后重试 1 次；非 OAuth 直接抛

- **分类**：`classify.ts:95-102` — 只有 `status === 401` 且
  `www-authenticate` 含 Bearer challenge（`isOAuthBearerChallenge`
  `classify.ts:200-208` 正则 `/Bearer\b[\s\S]*?\berror\s*=/i`）才归
  `OAuth401Error`；否则落入最后的 `FatalLLMError` 分支。
- **刷新钩子**：`with-retry.ts:90-92` — 若 `classified.kind === 'oauth401'`
  且 `deps.refreshOauthToken` 提供，则 await 刷新后再进入重试等待。
- **次数上限**：`with-retry.ts:17` `oauth401 = 1`（= 刷新后最多重试 1 次）。
- **测试证据**：
  - `test:76-87` "classifies 401 with Bearer error=invalid_token as OAuth401Error"。
  - `test:89-93` "classifies plain 401 (no bearer challenge) as FatalLLMError"。
  - `test:241-262` "refreshes OAuth token exactly once on 401 and retries"：断言 `refreshes=1, calls=2`。
- **结论**：✅ 完全覆盖。

### 4. `ECONNRESET / EPIPE / ETIMEDOUT / undici 瞬断` → 立即重试，最多 3 次

- **socket code 集合**：`classify.ts:21-33` `TRANSIENT_SOCKET_CODES` 含
  `ECONNRESET / EPIPE / ETIMEDOUT / ECONNABORTED / ECONNREFUSED /
  EHOSTUNREACH / ENETUNREACH / EAI_AGAIN / UND_ERR_SOCKET / UND_ERR_CLOSED`。
- **cause 链展开**：`findTransientCode` (`classify.ts:128-143`) 沿
  `.cause` 走最多 3 层，解决 fetch / undici 常见的"error of error"包装。
- **次数上限**：`with-retry.ts:18` `transient = 3`。
- **无退避**：`with-retry.ts:116-121` — transient 返回 0ms；
  `with-retry.ts:98-100` 对 `delayMs > 0` 才调 `sleep`，所以 transient
  重试**不会进入 setTimeout**。
- **测试证据**：
  - `test:27-32` "returns TransientIOError for ECONNRESET at the top level"。
  - `test:34-39` "unwraps transient socket codes nested under .cause"。
  - `test:189-201` "retries transient socket errors with zero delay"：
    断言 `calls=3, sleeps=[], retries.kind=['transient','transient']`。
- **⚠️ 边界未覆盖**：施工单 DoD 原文提到 "undici 的 `other side closed`"
  这一**消息字符串**。实现只按 `code` 匹配，依赖 undici 正常情况下会同
  时带上 `UND_ERR_SOCKET` / `UND_ERR_CLOSED` code。万一某个上游只透传
  message（丢了 code），当前会降级到 `FatalLLMError`。不是 blocker，但
  记录在案，供 P02 观察真实流量时补正则。
- **结论**：✅ 覆盖主路径；消息级兜底是一个 **已识别的次要 gap**。

### 5. `stream idle > 120s` → 抛 `StreamIdleError`

- **错误类型**：`errors.ts:110-117` 定义 `StreamIdleError(idleMs)`，
  `kind='stream_idle'`，已在 barrel 导出。
- **withRetry 策略**：`with-retry.ts:19` `stream_idle = 0`（不重试，
  抛出），行为正确。
- **⚠️ 实质性 gap**：**没有任何代码产生这个错误**。施工单 §二 任务拆解
  明文写 `with-retry.ts: ... 提供 wrapStream 辅助来检测 120s idle`，
  但实现里没有 `wrapStream`、没有 idle 检测循环、两个 provider 的 stream()
  方法里也没有 120s 看门狗。错误类存在，但消费方和生产方都缺席。
- **测试**：同样没有 stream-idle 用例。
- **结论**：⚠️ **部分达标**。错误契约已铺路，检测逻辑推迟。不影响 P01
  其它 5 条行为的正确性，但 DoD 严格讲不满。建议在 P02 压缩管线或 P05
  OpenAI shim 阶段补 `wrapStream`（或单拉一个 P01.1 补丁），在 ADR 或
  scorecard 里记一笔。

### 6. `prompt_too_long` → 抛 `PromptTooLongError`，不重试

- **分类**：`classify.ts:107-114` — `status` 在 `[400, 500)` **且** message
  匹配 `PROMPT_TOO_LONG_PATTERN`。正则 (`classify.ts:16-17`) 覆盖：
  - `prompt is too long`（Anthropic）
  - `context length` / `maximum context` / `context_length_exceeded`（OpenAI）
  - `string too long`（某些 OpenAI 兼容 provider）
- **不重试**：`with-retry.ts:20` `prompt_too_long = 0`。
- **测试证据**：
  - `test:95-102` "classifies 400 + 'prompt is too long' as PromptTooLongError"。
  - `test:104-110` "classifies 400 + 'context length' (OpenAI) as PromptTooLongError"。
  - `test:264-274` "does not retry prompt_too_long"：断言 `calls=1`。
- **结论**：✅ 完全覆盖，正则还多扛了两个 OpenAI 兼容 provider 的变体。

---

## 其它 DoD 项

### `bun run lint` 通过

`release:check` 跑了 9 个 tsconfig project（root 宽松 + 8 个 strict
project），全部 PASS。见 scorecard 2026-05-10 条 release:check ✅。

### `bun test ./src/infra/llm` 用例全绿

⚠️ **DoD 字面要求的路径无法运行**：

```
$ bun test ./src/infra/llm
 0 files, 0 tests
note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename
```

测试文件实际落在 `test/infrastructure/llm-retry.test.ts`（不是施工单
§67 建议的 `src/infra/llm/retry/__tests__/with-retry.test.ts`）。
走工程实际路径 `bun test test/infrastructure/llm-retry.test.ts` → **26
pass / 0 fail / 57 expect()**。

这是位置偏离不是行为偏离。XQoder 现有测试都集中在 `test/`，与 DoD 建议
路径冲突时按项目约定走。scorecard 已记。

### Provider 调用入口："只增加一行 withRetry，不改参数签名"

Diff 对比 baseline `c96a0f2`：

| Provider / 方法 | 签名是否变 | 结构是否重排 | `withRetry` 包装 |
|---|---|---|---|
| `AnthropicProvider.complete` | 否 | 否（SDK call 原样移入箭头函数） | ✅ 加一层 |
| `AnthropicProvider.stream` | 否 | 否 | ✅ 加一层（只包 handshake，不包流消费，代码里有注释说明） |
| `OpenAIProvider.complete` | 否 | 否 | ✅ `withRetry → withTimeout → SDK` 两层嵌套（施工单允许 2 层） |
| `OpenAIProvider.stream` | 否 | 否 | ✅ 同上 |

catch 块加了 `if (isClassifiedLLMError(err)) throw err;` 分支，让分类错误
原样冒泡、未知错误仍包成旧的 `LLMError` 兼容历史调用方。严格讲这不是
"只增加一行"，但施工单的**语义约束**（不改签名、不动参数形状）是满足
的，且这段额外判断是让分类错误不被二次包装所必需。

### 禁止文件是否动过

禁止列表：`src/shared/llm-api/base.ts`、`src/application/chat/conversation-engine.ts`、
`core/agent/*`、`package.json`。

`git diff --stat c96a0f2..HEAD` 对这些路径 **0 行改动**。✅

### 作用域内额外触碰的文件

- `src/infra/llm/index.ts`（barrel）：新增一行 `export * from './retry/index.js'`。
  施工单只列了 retry/ 的新增，未明示 barrel 需要放行。这是顺带的必要
  re-export，视作可接受的扩张。

---

## Clean-room 声明核查

三份新增文件头部注释都声明
`Clean-room reimplementation ... No original source code copied.`

交叉证据（非完整比对，只做结构抽查）：

- **OpenClaude `withRetry.ts`**（879 行）首 60 行直接 `import` Anthropic
  SDK 的 `APIError / APIConnectionError / APIUserAbortError`，有
  `fastMode cooldown`、`growthbook` 分析、AWS/GCP 凭证缓存。
  我们的 `with-retry.ts`（149 行）**不 import 任何 SDK**，策略表驱动，
  无分析/认证副作用。量级、依赖面、抽象粒度均不同。
- **OpenClaude `errors.ts`**（1368 行）结构是消息工厂 + cooldown enum。
  我们的 `errors.ts`（169 行）是 7 个 plain class 扩展 `LLMError`，
  带 `kind` discriminator。语义同构，实现不同构。

结论：**结构性抽查支持 clean-room 声明**；没做逐行比对所以不签"绝对
未复制"的字。本轮未跑自动化相似度检测，如 P27 以前需要更强证据可以
补一轮 `diff` / `simian` / AST 指纹。

---

## 本次验收发现的已识别 gap（不 block P01，但登记）

| # | Gap | 严重度 | 建议处理期 |
|---|---|---|---|
| G1 | `wrapStream` / 120s idle 检测未实现；`StreamIdleError` 目前是孤立的类型 | 中 | **已解决 P01.1 (2026-05-10)** — 见 `src/infra/llm/retry/stream-idle.ts` + 两个 provider 接入；`test/infrastructure/llm-stream-idle.test.ts` 覆盖 8 条路径 |
| G2 | undici "other side closed" 的 **message 级** 兜底缺失（仅靠 code 匹配） | 低 | 有真实流量日志后再决定 |
| G3 | 测试路径 `test/infrastructure/` vs DoD 建议 `src/infra/llm/retry/__tests__/` 偏离 | 信息 | 不处理；按项目约定 |
| G4 | 未跑 `/review` 自动审计 | 低 | 下一期开始恢复每期 `/review` |
| G5 | Clean-room 仅结构抽查，未做指纹比对 | 低 | 到 P27 法务审阅前补一轮 |

---

## 命令清单（便于 P02 重现）

```bash
# DoD 指定路径（注：当前为 0 用例，路径偏离）
bun test ./src/infra/llm

# 项目实际测试路径
bun test test/infrastructure/llm-retry.test.ts   # 26 pass / 0 fail

# 全套验收
bun run release:check                             # ✅ 端到端绿

# Diff 核查
git show c96a0f2:src/infra/llm/anthropic/index.ts > /tmp/before.ts
diff -u /tmp/before.ts src/infra/llm/anthropic/index.ts
```

---

## 签字

- 验收人：Kiro autodrive（本会话）
- 签字范围：DoD 6 条主行为 5 条完全覆盖 + 1 条（stream_idle）部分覆盖；
  scope 合规；clean-room 结构抽查通过；禁止文件未动。
- 不签：未跑 `/review`；未做逐行 clean-room 比对；token 消耗未测量。
