# Phase 07 · Provider 选路决策树

## 任务目标（必须可验证）

复刻 OpenClaude `services/api/client.ts::getAnthropicClient` 的 **7 分支
决策树**，并实现 `agentRouting / smartModelRouting / authRouting` 三个
侧枝。

### 对标源

| 源文件 | 行数 |
|---|---:|
| `openclaude/src/services/api/client.ts` | 主入口 |
| `openclaude/src/services/api/providerConfig.ts` | 解析 env / profile |
| `openclaude/src/services/api/agentRouting.ts` | 按 subagent 切 provider |
| `openclaude/src/services/api/smartModelRouting.ts` | 按任务复杂度切模型 |
| `openclaude/src/services/api/authRouting.ts` | OAuth / APIKey / Bedrock / Vertex |

### 成功判定

- `resolveProviderRequest(ctx): ResolvedProvider` 对以下 7 种输入返回正确分支：
  1. `providerOverride='dashscope'` → OpenAI shim + base URL dashscope。
  2. `env.CLAUDE_CODE_GITHUB_ANTHROPIC_API=1` → GitHub native.
  3. `env.USE_BEDROCK=1` → AWS SigV4 client.
  4. `env.USE_VERTEX=1` → GCP client.
  5. `env.USE_OPENAI / USE_GEMINI / USE_MISTRAL / USE_GITHUB` → OpenAI shim（带对应 baseUrl/auth）。
  6. 默认 → first-party Anthropic.
  7. 模型名是 codex alias → codexShim（phase 08）。
- `resolveAgentProvider(subagentName)` 若 user 在 `~/.xqoder/agents/<name>.md`
  frontmatter 写了 `provider: dashscope; model: qwen-plus`，返回该 override；
  否则继承主 provider。
- `routeModel(task, fallbacks)`：当主模型返回 rate-limit 时自动切到 fallbacks 的下一条；
  `FallbackTriggeredError` 用于上浮事件。

## 范围与边界

### 允许修改

- 新增 `src/infra/llm/routing/`：
  - `resolve-provider.ts`
  - `agent-routing.ts`
  - `smart-model-routing.ts`
  - `auth-routing.ts`
  - `fallback.ts`
- 修改 `src/core/agent/llm/factory.ts` 调用 `resolveProviderRequest`。
- 修改 `src/application/chat/provider-turn.ts` 处理 `FallbackTriggeredError`。

### 禁止修改

- `ILLMProvider` 接口。
- 现有 provider 的外部签名。

## 改动要点

### 1) `resolveProviderRequest(ctx)`

```ts
export interface ResolvedProvider {
    kind: 'anthropic' | 'anthropic-bedrock' | 'anthropic-vertex'
        | 'openai-shim' | 'codex-shim' | 'github-native';
    baseUrl?: string;
    auth: { apiKey?: string; oauthToken?: string; awsProfile?: string; gcpProject?: string };
    model: string;
    betas?: string[];
}

export function resolveProviderRequest(ctx: ProviderResolveContext): ResolvedProvider {
    // 1) providerOverride from agent
    if (ctx.providerOverride) return buildFromOverride(ctx.providerOverride, ctx);

    // 2) GitHub native
    if (truthy(ctx.env.CLAUDE_CODE_GITHUB_ANTHROPIC_API)) return { kind: 'github-native', ... };

    // 3-4) Bedrock / Vertex
    if (truthy(ctx.env.USE_BEDROCK)) return { kind: 'anthropic-bedrock', ... };
    if (truthy(ctx.env.USE_VERTEX)) return { kind: 'anthropic-vertex', ... };

    // 5) OpenAI 兼容家族
    const shimKind = detectOpenAiShim(ctx.env);
    if (shimKind) return { kind: 'openai-shim', baseUrl: shimKind.baseUrl, model: shimKind.model, auth: shimKind.auth };

    // 7) codex alias
    if (isCodexAlias(ctx.model)) return { kind: 'codex-shim', ... };

    // 6) default
    return { kind: 'anthropic', model: ctx.model, auth: { apiKey: ctx.env.ANTHROPIC_API_KEY } };
}
```

`detectOpenAiShim` 枚举与 OpenClaude `providerConfig.ts` 完全对齐：

- `USE_OPENAI` → OpenAI
- `USE_GEMINI` → `https://generativelanguage.googleapis.com/v1beta/openai/`
- `USE_MISTRAL` → `https://api.mistral.ai/v1`
- `USE_GITHUB` → `https://models.inference.ai.azure.com`
- dashscope / deepseek / groq / xai / openrouter / minimax / local 走 env 专用前缀。

### 2) `resolveAgentProvider`

从 `~/.xqoder/agents/<name>.md` 读 frontmatter（已由
`core/agent/markdown-agents.ts` 实现），增加 `provider` / `model` / `baseUrl` 字段解析。

### 3) `smartModelRouting`

`routeModel(task, fallbackChain)` 实现 "主模型 → fallback1 → fallback2 → local Ollama"
的链，抛 `FallbackTriggeredError` 让上层记录 tombstone。
触发条件（任一）：

- 收到 `ThrottleError`（429）且 retry 次数已达上限；
- 收到 `OverloadError`（529）且超过 3 次；
- 收到 `FatalLLMError` 且 `status === 404`（模型不存在）。

## 验证

- 单测表格驱动：20 行 `{ env, providerOverride, expectedKind, expectedBaseUrl }`。
- mock provider 触发 429 × 5 → 观察 fallback 切到 Ollama。

## 风险与回退

- **风险**：fallback 链污染用户 config。**缓解**：fallback **仅**在本次
  session 临时生效，下次启动重新选主 provider。
- 回退：`XQODER_DISABLE_SMART_ROUTING=1` 禁 smartModelRouting。

## 不确定项

- OpenClaude 的 `providerConfig.ts` 对 "GITHUB native anthropic" 的凭据路径
  判别较复杂（CLI arg / env / cache）。施工时完全照搬它的优先级。
