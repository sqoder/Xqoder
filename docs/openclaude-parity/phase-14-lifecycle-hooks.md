# Phase 14 · 生命周期 hook 8 元

## 任务目标（必须可验证）

把 hook 事件从现在的 3 种（PreToolUse / PostToolUse / PostToolUseFailure）
扩展到 OpenClaude 的 10 种（见 conventions.md），并支持 3 种 handler：
exec script / HTTP / prompt agent。

## 对标源

- `openclaude/src/utils/hooks/hookEvents.ts`
- `openclaude/src/utils/hooks/hookHelpers.ts`
- `openclaude/src/utils/hooks/hooksConfigManager.ts`
- `openclaude/src/utils/hooks/hooksConfigSnapshot.ts`
- `openclaude/src/utils/hooks/hooksSettings.ts`
- `openclaude/src/utils/hooks/postSamplingHooks.ts`
- `openclaude/src/utils/hooks/sessionHooks.ts`
- `openclaude/src/utils/hooks/execAgentHook.ts`
- `openclaude/src/utils/hooks/execHttpHook.ts`
- `openclaude/src/utils/hooks/execPromptHook.ts`
- `openclaude/src/utils/hooks/AsyncHookRegistry.ts`
- `openclaude/src/utils/hooks/fileChangedWatcher.ts`
- `openclaude/src/schemas/hooks.ts`
- `openclaude/src/types/hooks.ts`
- `openclaude/src/commands/hooks/**`

### 成功判定

- `.xqoder/hooks.json` 可配置（对齐 OpenClaude `~/.claude/hooks.json`）：
  ```json
  {
    "UserPromptSubmit": [ { "type": "command", "command": "./bin/filter.sh" } ],
    "PreToolUse": [ { "type": "agent", "agent": "guard" } ],
    "PostToolUse": [ { "type": "http", "url": "https://example.com/audit" } ],
    "Stop": [ { "type": "command", "command": "./bin/notify.sh" } ]
  }
  ```
- 每个 hook 都能返回 `{ decision: 'allow'|'deny'|'ask', reason, additionalContext }`。
- `UserPromptSubmit` 返回 deny → 主循环不进入。
- `Stop` hook 不阻塞主流程（fire-and-forget，超时 5s 自动放弃）。
- `xqoder hooks add/remove/list/test` CLI 可用。

## 范围与边界

### 允许修改

- 重写 `src/core/agent/hooks.ts`（保留已有 payload 构造器）。
- 新增 `src/core/agent/hooks/`：
  - `registry.ts`
  - `dispatch.ts`
  - `exec-command.ts`
  - `exec-http.ts`
  - `exec-agent.ts`
  - `watch-files.ts`
- 新增 `src/commands/core/hooks.ts`。

### 禁止修改

- `PreToolUse / PostToolUse / PostToolUseFailure` 的 payload 形状
  （已被 agent-tool-execution 消费）。

## 改动要点

### 1) 事件类型扩展

```ts
export type HookEventName =
  | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'
  | 'UserPromptSubmit' | 'SessionStart' | 'SessionEnd'
  | 'Stop' | 'SubagentStop' | 'PreCompact' | 'PostCompact';
```

### 2) Handler 分发

```ts
export async function dispatchHook(event, payload, registry): Promise<HookDecision> {
    const handlers = registry.get(event);
    for (const h of handlers) {
        const result = await executeHandler(h, payload);
        if (result.decision === 'deny') return result; // short circuit
        if (result.additionalContext) mergeAdditionalContext(result.additionalContext);
    }
    return { decision: 'allow' };
}
```

### 3) Command handler

```ts
// exec-command.ts
export async function execCommandHook(handler, payload): Promise<HookDecision> {
    const proc = spawn(handler.command, [], { stdio: ['pipe', 'pipe', 'pipe'], timeout: handler.timeoutMs ?? 5000 });
    proc.stdin.end(JSON.stringify(payload));
    const [code, stdout] = await collectOutput(proc);
    if (code !== 0) return { decision: 'allow' }; // 失败不阻断
    return parseHookOutput(stdout);
}
```

### 4) HTTP handler

```ts
export async function execHttpHook(handler, payload): Promise<HookDecision> {
    const res = await fetch(handler.url, { method: 'POST', body: JSON.stringify(payload), signal: abortAfter(5000) });
    if (!res.ok) return { decision: 'allow' };
    return parseHookOutput(await res.text());
}
```

### 5) Agent handler

```ts
export async function execAgentHook(handler, payload): Promise<HookDecision> {
    const result = await runForkedAgent({
        subagent: handler.agent,
        task: `Review: ${JSON.stringify(payload)}`,
        readOnly: true,
        maxTurns: 3,
    });
    return parseHookOutput(result.response);
}
```

### 6) 各调用点挂接

- `turn-intake.ts` → `dispatchHook('UserPromptSubmit', ...)`（phase 11 已埋点）。
- `conversation-engine.ts::createConversationTurnStream` 起始 →
  `dispatchHook('SessionStart', ...)`（首次）或 `SessionResumed`。
- `conversation-engine.ts` 结束 → `dispatchHook('SessionEnd')`。
- 每 turn 结束 → `dispatchHook('Stop')`。
- phase-02 的 `maybeAutoCompact` 进入每一级前后 →
  `dispatchHook('PreCompact'|'PostCompact')`。

### 7) CLI

```
xqoder hooks list
xqoder hooks add <event> <type> <spec>
xqoder hooks remove <id>
xqoder hooks test <event>
```

## 验证

- 单测：3 种 handler × 10 种 event 组合的 fixture。
- e2e：配置一个 UserPromptSubmit command hook 拒绝 → 用户输入 `/forbidden`
  时看到 blocked 消息。

## 风险与回退

- **风险**：Command hook 被滥用跑耗时脚本，阻塞主流程。
  **缓解**：strict 5s timeout + 调用时带 `trace id` 记 telemetry。
- **回退**：`XQODER_DISABLE_HOOKS=1` 全部跳过。

## 不确定项

- OpenClaude 有 "PostSamplingHooks"（在模型 sampling 完成后 / assistant
  消息写入前触发）。本期 v1 不纳入，留 phase-27 评估。
