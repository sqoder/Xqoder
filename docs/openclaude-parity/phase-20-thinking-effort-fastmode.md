# Phase 20 · 思考档位（thinking / effort / fastMode）

## 任务目标（必须可验证）

暴露三个独立推理维度的 UX 与内部管线：

- `/think /nothink` —— 开关 Anthropic 的 `thinking` 参数。
- `/effort low|medium|high|xhigh` —— 控制 OpenAI/Codex 的 `reasoning_effort`。
- `/fast` —— 切换 Anthropic 的 `speed: fast` beta 模式。

## 对标源

- `openclaude/src/utils/thinking.ts / thinking.test.ts`
- `openclaude/src/utils/thinkingTokens.test.ts`
- `openclaude/src/utils/thinkingTokenExtractor.ts / .test.ts`
- `openclaude/src/utils/effort.ts / effort.codex.test.ts`
- `openclaude/src/utils/fastMode.ts / fastMode.test.ts`
- `openclaude/src/commands/effort/` / `fast/` / `thinkback/` / `thinkback-play/`
- `openclaude/src/components/ThinkingToggle.tsx`
- `openclaude/src/components/EffortCallout.tsx`
- `openclaude/src/components/EffortPicker.tsx`
- `openclaude/src/components/EffortIndicator.ts`
- `openclaude/src/components/FastIcon.tsx`

### 成功判定

- session metadata 存 `thinking / effort / fastMode` 三字段；
  `/think on` → `thinking=enabled`，`/effort high` → `effort=high`，
  `/fast` → `fastMode=fast`（toggle）。
- 下一次请求时：
  - Anthropic：`thinking={type: 'enabled', budget_tokens: mapEffort(effort)}`。
  - OpenAI / Codex：`reasoning_effort` 或 `output_config.effort`。
  - DeepSeek R1：`thinking: { type: 'enabled' }`（兼容形式）。
- 模型返回的 `thinking` / `reasoning_content` chunk 由 `ThinkingTokenExtractor`
  分离 → emit `thought` 事件 → Ink UI 折叠渲染（phase-22）。
- fastMode 被 API 拒绝时自动进入 `triggerFastModeCooldown`：
  2 分钟 cooldown 期间 toggle fast 无效。
- 新 hooks 事件：`PostThinking`（可选，v2 实现）。

## 范围与边界

### 允许修改

- 新增 `src/core/thinking/`：
  - `thinking-config.ts`
  - `effort.ts`
  - `fast-mode.ts`
  - `token-extractor.ts`
- 升级 `src/infra/llm/anthropic/index.ts` 识别 `thinking`/`fast` 字段。
- 升级 `src/infra/llm/openai/shim/provider.ts` 识别 `reasoning_effort`。
- 新增 `src/commands/core/{think,effort,fast}.ts`。

### 禁止修改

- `CompletionRequest.temperature`（thinking 打开时才禁 temperature）。

## 改动要点

### 1) ThinkingConfig

```ts
interface ThinkingConfig {
    mode: 'disabled' | 'adaptive' | 'enabled';
    budgetTokens?: number;
    effort?: 'low' | 'medium' | 'high' | 'xhigh';
    fastMode?: 'standard' | 'fast';
}

export function resolveThinking(model: string, userOverride: Partial<ThinkingConfig>): ThinkingConfig {
    const defaults = shouldEnableThinkingByDefault(model);
    return { ...defaults, ...userOverride };
}
```

### 2) 映射到 provider 参数

```ts
export function applyThinkingToAnthropicParams(params, tc: ThinkingConfig) {
    if (tc.mode !== 'disabled') {
        params.thinking = { type: 'enabled', budget_tokens: tc.budgetTokens ?? 8000 };
        delete params.temperature; // Anthropic 规则
    }
    if (tc.fastMode === 'fast' && !isFastModeCoolingDown()) {
        params.speed = 'fast';
    }
    return params;
}

export function applyEffortToOpenAiParams(params, tc: ThinkingConfig) {
    if (tc.effort) params.reasoning_effort = tc.effort;
    return params;
}
```

### 3) fast cooldown

```ts
let fastCooldownUntil = 0;
export function triggerFastModeCooldown(ms = 120_000) { fastCooldownUntil = Date.now() + ms; }
export function isFastModeCoolingDown() { return Date.now() < fastCooldownUntil; }
```

在 phase-01 的 `withRetry` 捕获 `FatalLLMError` 且 err.message 匹配
"fast mode rejected" 时自动调用 `triggerFastModeCooldown`。

### 4) ThinkingTokenExtractor

phase-05 的 `ThinkTagFilter` 只剥除；这里升级为 **分离**：

```ts
export function extractThinking(rawContent: string): { visible: string; thinking: string } {
    // 把 <think>...</think> 切到 thinking
}
```

在 provider 的 `openaiStreamToInternal` 里，`delta.content` 过滤后两股输出：
- 主 content → `onToken`
- thinking → `onThinkingToken`

### 5) CLI 命令

```
xqoder think [on|off]   # 切换
xqoder effort <low|medium|high|xhigh>
xqoder fast             # toggle
```

REPL 里也映射 `/think /nothink /effort /fast` slash 命令。

## 验证

- Unit：9 组 { provider, model, user override } 映射 fixture。
- e2e：`XQODER_FEATURE_PROMPT_CACHE=1 /think on /effort high` 一次调用
  params 断言。

## 风险与回退

- **风险**：`thinking` 打开时禁 temperature 破坏既有行为。
  **缓解**：只对 Anthropic 生效；其它 provider 仍传 temperature。
- **回退**：session metadata 默认 `thinking.mode='disabled'`，用户需显式开。

## 不确定项

- DeepSeek R1 / qwen3 / glm-4-plus 的 thinking 字段名差异较大；
  v1 按 provider 分支硬编码，v2 可抽 `thinkingFieldMap`。
