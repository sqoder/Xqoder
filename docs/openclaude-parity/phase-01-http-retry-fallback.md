# Phase 01 · HTTP withRetry + 错误分级恢复

## 任务目标（必须可验证）

为所有 LLM provider 的 `complete()` / `stream()` 调用加一层统一的 `withRetry`
包装，并建立一套最小可扩展的错误分类。

### 成功判定

- 在单元测试中对以下 6 种错误各造一条用例，期望行为：
  - `429 + retry-after: 3` → 等待 3s 后重试，最多 5 次。
  - `529 Overloaded`（`status=529` 或 body 含 `"overloaded_error"`）→ 最多 3 次退避重试，仅前台 `querySource='foreground'` 时启用。
  - `401 + OAuth`（`www-authenticate` 含 `Bearer error="invalid_token"`）→ 先调用 `refreshOauthToken` 再重试 1 次；非 OAuth（纯 API key）直接抛错。
  - `ECONNRESET` / `EPIPE` / `ETIMEDOUT` / `undici` 的 `other side closed` → 立即重试，最多 3 次，无退避。
  - `stream idle > 120s` → 抛 `StreamIdleError`，上层按"换非流式"二次尝试 1 次。
  - `prompt_too_long`（Anthropic 400 body 含 `"prompt is too long"`，OpenAI 400 含 `"context length"`）→ 抛 `PromptTooLongError`，不重试，由 Phase 02 捕获。
- `bun run lint` 通过；`bun test ./src/infra/llm` 新增用例全绿。
- 现有 provider 调用入口（`OpenAIProvider.stream` / `AnthropicProvider.stream`）只增加一行 `withRetry(() => …)`，不改参数签名。

---

## 背景与上下文

- **项目**：XQoder，terminal-native AI coding assistant，TypeScript + Bun。
- **当前实现**：`src/infra/llm/openai/provider/index.ts`（524 行）和
  `src/infra/llm/anthropic/index.ts`（251 行）直接调用各自 SDK，
  没有重试/退避/降级。
- **已有约束**：不允许引入新依赖；必须保持 `ILLMProvider.complete/stream`
  的外部签名；`BaseLLMProvider` 已经是统一基类
  （`src/shared/llm-api/base.ts`）。
- **可用输入材料**：
  - `src/shared/local-fallback.ts`（Ollama 本地兜底，已存在，不改）。
  - `src/shared/errors/`（存放自定义错误的目录）。

---

## 问题/需求定义

### 当前现象

- 429 会直接抛到 `conversation-engine.ts` 里，用户看到裸 stack。
- 国内 dashscope / groq 等 OpenAI 兼容 provider 网络抖动（`ECONNRESET`）
  也会直接中断整轮对话。
- 长对话里 `prompt too long` 被当作普通 400 错误，没有地方识别并触发压缩。

### 触发条件

- 上游 provider 返回 HTTP 4xx/5xx、或 Node 底层 socket 层错误。
- 流式调用里 SSE 长时间无 chunk。

### 预期行为

- 可恢复错误由 infra 层自动吞掉并重试。
- 不可恢复错误以 `LLMError` 的具体子类抛出，带上 `kind` 字段供上层 switch。

---

## 范围与边界（强约束）

### 允许修改

- 新增 `src/infra/llm/retry/with-retry.ts`
- 新增 `src/infra/llm/retry/errors.ts`
- 新增 `src/infra/llm/retry/classify.ts`
- 修改 `src/infra/llm/openai/provider/index.ts`（仅在外层包 `withRetry`）
- 修改 `src/infra/llm/anthropic/index.ts`（同上）
- 新增测试 `src/infra/llm/retry/__tests__/with-retry.test.ts`

### 禁止修改

- `src/shared/llm-api/base.ts`（保持 `BaseLLMProvider` 接口）
- `src/application/chat/conversation-engine.ts`（Phase 02 才改）
- 任何 `core/agent/*`
- `package.json` 依赖

### 限制

- 不允许引入 `p-retry / axios-retry / got`。用原生 `setTimeout + AbortController`。
- `withRetry` 最多嵌套 2 层（外层业务语义，内层 socket 级）。
- 不允许在 `withRetry` 里吞掉 `AbortError`（`signal.aborted === true`）。

---

## 执行步骤

### 一、行为建模

对标 OpenClaude 文档 §06 的双层重试栈，简化为：

| 错误类别 | 表现 | 分类函数判定 | 行为 |
|---|---|---|---|
| ThrottleError | `status=429`、`status=503`、`retry-after` 头 | `kind='throttle'` | 读 `retry-after` 或指数退避（1s/2s/4s/8s/16s），最多 5 次 |
| OverloadError | `status=529` 或 Anthropic body `"overloaded_error"` | `kind='overload'` | 指数退避，最多 3 次，仅 `context.foreground` |
| OAuth401Error | `status=401` + `www-authenticate: Bearer error=` | `kind='oauth401'` | 调 `deps.refreshOauthToken?.()` 后重试 1 次 |
| TransientIOError | `ECONNRESET/EPIPE/ETIMEDOUT/socket hang up` | `kind='transient'` | 立即重试，最多 3 次，无退避 |
| StreamIdleError | 120s 无 chunk | `kind='stream_idle'` | 抛出，不自动重试（交由调用者决定） |
| PromptTooLongError | `status=400` + body 含 `prompt is too long` / `context length` | `kind='prompt_too_long'` | 抛出，不重试 |
| FatalError | 其余 4xx（`401 非 OAuth`、`403`、`404`、`400 其他`） | `kind='fatal'` | 直接抛出，不重试 |

### 二、任务拆解

| 模块 | 职责 | 依赖 |
|---|---|---|
| `errors.ts` | 定义 `LLMError` 子类（`ThrottleError / OverloadError / OAuth401Error / TransientIOError / StreamIdleError / PromptTooLongError / FatalLLMError`），都带 `kind` 字段 | — |
| `classify.ts` | 把任何 `unknown` 错误归一到上述子类之一；对 SDK 抛出的 `Anthropic.APIError / OpenAI.APIError` 做形状判别 | `errors.ts` |
| `with-retry.ts` | 按 `kind` 选择策略；维持 `AbortSignal` 与 `retry-after` header；提供 `wrapStream` 辅助来检测 120s idle | `classify.ts, errors.ts` |
| `OpenAIProvider.stream / complete` | 用 `withRetry(deps, () => …)` 包住 SDK 调用；传入 `querySource='foreground'` | `with-retry.ts` |
| `AnthropicProvider.stream / complete` | 同上 | `with-retry.ts` |
| 测试 | 用 `mock` 模拟 6 种错误，断言重试次数与最终结果 | Bun test + 简易 mock |

---

## 三、逐模块施工单

### 模块 1 · `src/infra/llm/retry/errors.ts`

1. **模块名称**：LLM 错误基类集合。
2. **职责**：把底层错误抽象成带 `kind` 的可分类对象。
3. **涉及文件路径**：
   - 新增：`src/infra/llm/retry/errors.ts`
4. **当前问题**：全仓只有一个 `LLMError`（`@xqoder/shared`），没有子类。
5. **根因**：没有人负责定义"分类"概念。
6. **改动方案**：

```ts
// src/infra/llm/retry/errors.ts
import { LLMError } from '@xqoder/shared';

export type LLMErrorKind =
    | 'throttle'
    | 'overload'
    | 'oauth401'
    | 'transient'
    | 'stream_idle'
    | 'prompt_too_long'
    | 'fatal';

export interface ClassifiedLLMError extends LLMError {
    kind: LLMErrorKind;
    retryAfterMs?: number;
    httpStatus?: number;
    providerName?: string;
}

export class ThrottleError extends LLMError {
    kind: LLMErrorKind = 'throttle';
    constructor(message: string, readonly retryAfterMs?: number, readonly httpStatus?: number) {
        super(message);
    }
}
// 同样模式：OverloadError / OAuth401Error / TransientIOError /
// StreamIdleError / PromptTooLongError / FatalLLMError
```

   - **注意**：保留继承 `@xqoder/shared` 的 `LLMError`，避免 `instanceof LLMError` 在上游失效。

7. **注意事项**：所有子类必须把 `kind` 以 `public readonly` 放出来，不要使用
   枚举映射（避免 tree-shake 失败）。
8. **不允许**：修改 `@xqoder/shared/LLMError`；给 `LLMError` 直接加 `kind`
   字段（那会污染所有使用 `LLMError` 的调用点）。
9. **预期行为**：任何下游代码 `err instanceof ThrottleError` 能判真；
   `err instanceof LLMError` 同样判真。
10. **验收标准**：`bun x tsc --noEmit` 通过；新文件行数 ≤ 120。
11. **测试方式**：单元测试里 `expect(new ThrottleError('x', 3000)).toBeInstanceOf(LLMError)`。
12. **风险点**：无。
13. **回退**：删除新文件即可。

---

### 模块 2 · `src/infra/llm/retry/classify.ts`

1. **模块名称**：错误分类器。
2. **职责**：输入 `unknown`，输出 `ClassifiedLLMError`。
3. **涉及文件路径**：新增 `src/infra/llm/retry/classify.ts`。
4. **当前问题**：Anthropic / OpenAI SDK 错误形状不一致，逻辑目前散落在多处。
5. **根因**：SDK 原生错误不带 `kind`。
6. **改动方案**：

```ts
// src/infra/llm/retry/classify.ts
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import {
    ThrottleError, OverloadError, OAuth401Error,
    TransientIOError, PromptTooLongError, FatalLLMError,
    type ClassifiedLLMError,
} from './errors.js';

const PROMPT_TOO_LONG = /(prompt is too long|context length|maximum context)/i;
const TRANSIENT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT']);

export function classifyLLMError(
    err: unknown,
    providerName: string,
): ClassifiedLLMError {
    // 1) SDK 自己的 APIError 带 status
    const anyErr = err as { status?: number; code?: string; message?: string;
        headers?: Record<string, string | undefined>; error?: { type?: string } };

    // 低层 IO
    if (typeof anyErr.code === 'string' && TRANSIENT_CODES.has(anyErr.code)) {
        return new TransientIOError(anyErr.message ?? anyErr.code);
    }

    // 4xx/5xx
    const status = anyErr.status;
    if (status === 429 || status === 503) {
        const retryAfter = parseRetryAfter(anyErr.headers?.['retry-after']);
        return new ThrottleError(anyErr.message ?? 'throttled', retryAfter, status);
    }
    if (status === 529 || anyErr.error?.type === 'overloaded_error') {
        return new OverloadError(anyErr.message ?? 'overloaded');
    }
    if (status === 401 && isOAuthChallenge(anyErr.headers?.['www-authenticate'])) {
        return new OAuth401Error(anyErr.message ?? 'oauth');
    }
    if (status === 400 && PROMPT_TOO_LONG.test(anyErr.message ?? '')) {
        return new PromptTooLongError(anyErr.message ?? 'prompt too long');
    }

    return new FatalLLMError(anyErr.message ?? String(err), status);
}

function parseRetryAfter(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const seconds = Number.parseFloat(value);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : undefined;
}

function isOAuthChallenge(header: string | undefined): boolean {
    return !!header && /Bearer\s+error=/i.test(header);
}
```

   - **待验证**：OpenAI SDK v6 里 `err.headers` 的 key 是否小写归一化（目前观察到是）。施工前 **必须** 跑一次真实 429 样本验证；若 headers 是 `Headers` 实例则改用 `.get()`。
7. **注意事项**：`err.error?.type === 'overloaded_error'` 是 Anthropic
   body 上的形状，OpenAI 侧不会走这个分支。
8. **不允许**：在分类器里 `console.log` 或落盘（保持纯函数）。
9. **预期行为**：同一条 429 err，无论从 OpenAI 还是 Anthropic SDK 抛出，
   都返回 `ThrottleError` 且 `retryAfterMs` 正确解析。
10. **验收标准**：覆盖表格里 7 种 kind 的单测全部通过。
11. **测试方式**：构造伪造对象 `{ status: 429, headers: { 'retry-after': '3' } }`
    期望 `classifyLLMError(err, 'openai').kind === 'throttle'`。
12. **风险点**：SDK 升级导致 err 形状变化。对冲方法：classifyLLMError 返回
    `FatalLLMError` 而不是崩溃。
13. **回退**：文件独立，删除即回退。

---

### 模块 3 · `src/infra/llm/retry/with-retry.ts`

1. **模块名称**：withRetry 策略引擎。
2. **职责**：按 `kind` 分派等待与重试次数；遵守 `AbortSignal`。
3. **涉及文件路径**：新增 `src/infra/llm/retry/with-retry.ts`。
4. **当前问题**：没有统一重试入口。
5. **根因**：各 provider 写法不同。
6. **改动方案**：

```ts
// src/infra/llm/retry/with-retry.ts
import { classifyLLMError } from './classify.js';
import type { ClassifiedLLMError, LLMErrorKind } from './errors.js';

export interface WithRetryDeps {
    providerName: string;
    signal?: AbortSignal;
    foreground?: boolean;
    refreshOauthToken?: () => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
}

const MAX_BY_KIND: Record<LLMErrorKind, number> = {
    throttle: 5,
    overload: 3,
    oauth401: 1,
    transient: 3,
    stream_idle: 0,
    prompt_too_long: 0,
    fatal: 0,
};

export async function withRetry<T>(
    deps: WithRetryDeps,
    op: () => Promise<T>,
): Promise<T> {
    let attempt = 0;
    const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

    while (true) {
        if (deps.signal?.aborted) {
            throw new DOMException('aborted', 'AbortError');
        }
        try {
            return await op();
        } catch (err) {
            const classified = classifyLLMError(err, deps.providerName);
            const maxAttempts = MAX_BY_KIND[classified.kind];
            const canRetry =
                attempt < maxAttempts
                && (classified.kind !== 'overload' || deps.foreground === true);
            if (!canRetry) throw classified;

            if (classified.kind === 'oauth401' && deps.refreshOauthToken) {
                await deps.refreshOauthToken();
            }

            const waitMs =
                classified.kind === 'throttle'
                    ? classified.retryAfterMs ?? backoff(attempt)
                    : classified.kind === 'transient'
                        ? 0
                        : backoff(attempt);

            await sleep(waitMs);
            attempt += 1;
        }
    }
}

function backoff(attempt: number): number {
    return Math.min(16_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
```

7. **注意事项**：`signal.aborted` 必须在每轮循环头部检查；不要把 `DOMException`
   换成 `Error`（Bun 的 `fetch` 用 `DOMException`）。
8. **不允许**：在 `withRetry` 里 `setInterval`、全局计数器。
9. **预期行为**：在 5 次 429 连击下总等待时间 ≤ 31s，然后成功返回；
   在第 6 次仍 429 时抛 `ThrottleError`。
10. **验收标准**：单测用 mock sleep 断言调用序列。
11. **测试方式**：手写的 mock provider 在 `new Array(3).fill(429)` 后返回 200。
12. **风险点**：并发多个 stream 调用时，重试退避会放大尾延迟。
    mitigation：在 OpenAIProvider 外层只包一次。
13. **回退**：直接不 `import` 这两个模块即回到当前行为。

---

### 模块 4 · `OpenAIProvider.stream / complete` 集成点

1. **模块名称**：OpenAI / OpenAI-兼容 provider。
2. **职责**：对外保持现有 API；对内用 `withRetry` 包一次。
3. **涉及文件路径**：`src/infra/llm/openai/provider/index.ts`。
4. **当前问题**：直接 `await this.client.chat.completions.create(...)`，无重试。
5. **根因**：从未引入 retry 层。
6. **改动方案**：在 `stream()` 方法中把对 SDK 的调用用 `withRetry` 外裹一层：

```ts
import { withRetry } from '../../retry/with-retry.js';

// 在 OpenAIProvider.stream 里
const response = await withRetry(
    { providerName: 'openai', signal, foreground: true },
    () => this.client.chat.completions.create(params, { signal }),
);
```

   对 `complete()` 做同样处理。

7. **注意事项**：
   - `signal` 需要从原 `StreamCallbacks` 里透出；若目前没有 signal，
     本期**不添加**signal 支持，`foreground: true` 使 overload 分支可用即可。
   - `stream` 模式下 `withRetry` 只负责"握手失败"时的重试；真正开始接收
     SSE 以后出现的 socket 断开在本期不 auto-retry（交给 Phase 05 统一处理
     为"断点续流"，因为那里已经拆成 shim）。
8. **不允许**：改签名、加新参数、改 `OpenAI` SDK 版本。
9. **预期行为**：`stream()` 的首字节在重试成功后到达调用者；调用者无感。
10. **验收标准**：把 `new OpenAIProvider(cfg)` 的 `stream` 方法先失败 2 次（mock）
    再成功，外层 `for await` 照常吐 token。
11. **测试方式**：新写一条集成测试 `openai-provider-retry.test.ts`，
    用 `AnthropicProvider` 上做同样流程。
12. **风险点**：握手阶段 5s 内重试成功，用户仍会看到首字节变慢；需要在
    `logger.warn` 里打 `withRetry attempt=N kind=...` 以便观察。
13. **回退**：把 `withRetry(…)(op)` 换回 `await op()` 一行。

---

### 模块 5 · `AnthropicProvider.stream / complete`

与模块 4 同构，不再重复。区别：`providerName: 'anthropic'`，
`refreshOauthToken` 在本期不接（Anthropic 官方 SDK 自己会刷新 OAuth）。

---

## 四、逐文件修改建议

| 文件 | 动作 | 行数估计 |
|---|---|---|
| 新增 `src/infra/llm/retry/errors.ts` | 新文件 | ≤ 120 |
| 新增 `src/infra/llm/retry/classify.ts` | 新文件 | ≤ 140 |
| 新增 `src/infra/llm/retry/with-retry.ts` | 新文件 | ≤ 100 |
| 修改 `src/infra/llm/openai/provider/index.ts` | 增加 3 行 import + 2 处 `withRetry(…, () => …)` 包裹 | +6 |
| 修改 `src/infra/llm/anthropic/index.ts` | 同上 | +6 |
| 新增 `src/infra/llm/retry/__tests__/with-retry.test.ts` | 新文件 | ≤ 200 |

---

## 五、数据结构

```ts
type LLMErrorKind =
    | 'throttle' | 'overload' | 'oauth401'
    | 'transient' | 'stream_idle' | 'prompt_too_long' | 'fatal';

interface WithRetryDeps {
    providerName: string;
    signal?: AbortSignal;
    foreground?: boolean;
    refreshOauthToken?: () => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
}
```

调用流程：

```
provider.stream(req)
  └─ withRetry(deps, () => sdk.call())
        ├─ 成功 → 返回
        └─ 失败 → classifyLLMError → 选策略 → sleep → 重试
```

---

## 六、关键代码

见"模块 2/3/4"内嵌代码块，全部是最终要落地的形态，**无伪代码**。

---

## 七、验证方案

### 手动测试

- 断网 2s 后恢复，`bun dist/index.js chat "hello"` 应自动重试成功。
- `XQODER_FAKE_429=1` 环境变量（在模块 4 里临时硬编码一个开关以便本地调试）
  让 OpenAIProvider 注入 429，期望看到 `logger.warn('withRetry attempt=1 kind=throttle')`。
  **本开关仅用于本期自验收，合并前必须删除**。

### 边界测试

- `AbortSignal` 在第 2 次重试前 abort：期望立即抛 `AbortError`，不再进第 3 次。
- 连续 5 次 429：第 5 次也 429 → 抛 `ThrottleError`，`httpStatus=429`。
- `retry-after: 1000000`（异常大）：按策略 clamp 到 16s 上限。

### 对比验证

不必。这是 infra 新增层，无对标外部实现。

### 失败判定

- 任何一个错误分类用例走错 `kind` 分支 → 不达标。
- `withRetry` 在 `AbortSignal` aborted 后仍调用 op → 不达标。

---

## 风险与回退

- **最大风险**：`classifyLLMError` 对 SDK error 形状判别错误（SDK 升级）
  → **回退**：把调用点两行 `withRetry` 注释，恢复原样。
- **次要风险**：429 回退时间过长导致 UX 感觉卡住 → 可把 `MAX_BY_KIND.throttle`
  暂调为 3 做灰度。

---

## 不确定项（待验证）

- OpenAI SDK v6 的 `error.headers` 字段形状（`Record` vs `Headers` 实例）。
  施工前必须跑一次真实 429（可用 rate-limited 的 API key 触发）校对。
