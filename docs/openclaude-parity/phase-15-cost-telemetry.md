# Phase 15 · 成本与遥测

## 任务目标（必须可验证）

对齐 OpenClaude 的成本跟踪 + cache metrics + provider 特定 usage 映射 +
analytics sink 四块。

## 对标源

- `openclaude/src/cost-tracker.ts / costHook.ts`
- `openclaude/src/services/api/cacheMetrics.ts / cacheStatsTracker.ts`
- `openclaude/src/services/api/usage.ts`
- `openclaude/src/services/api/codexUsage.ts`
- `openclaude/src/services/api/minimaxUsage.ts`
- `openclaude/src/services/api/emptyUsage.ts`
- `openclaude/src/services/analytics/**`

### 成功判定

- 每个 provider 的 usage 被正确归一到 `NormalizedUsage`：
  `{ input, output, cacheRead, cacheCreate, cacheDelete?, reasoning?,
     costUsd, provider, model }`.
- `session.usage` 与 `~/.xqoder/sessions/<id>/cost.json` 一致。
- `xqoder cost` 命令输出当前 session 与总累计。
- `cacheStatsTracker` 导出命中率 JSON。
- 所有遥测事件走可插拔 sink：默认 noop；可用 `XQODER_TELEMETRY_SINK=datadog` 切换。

## 范围与边界

### 允许修改

- 新增 `src/infra/llm/usage/`:
  - `normalize.ts`
  - `anthropic-usage.ts`
  - `openai-usage.ts`
  - `codex-usage.ts`
  - `minimax-usage.ts`
- 新增 `src/shared/telemetry/`:
  - `sink.ts`
  - `events.ts`
  - `datadog-sink.ts`（默认不启用）
  - `noop-sink.ts`
- 升级 `src/infra/shared/model-costs.ts` 接 NormalizedUsage。
- 新增 `src/commands/core/cost.ts`。

### 禁止修改

- `AgentSessionUsage` 字段形状（只扩展，不移除）。

## 改动要点

### 1) NormalizedUsage

```ts
export interface NormalizedUsage {
    provider: string;
    model: string;
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreate?: number;
    cacheDelete?: number;
    reasoning?: number;
    costUsd?: number;
}

export function normalizeUsage(raw: unknown, provider: string, model: string): NormalizedUsage {
    switch (provider) {
        case 'anthropic':
        case 'anthropic-bedrock':
        case 'anthropic-vertex':
            return normalizeAnthropic(raw, model);
        case 'codex':
            return normalizeCodex(raw, model);
        case 'openai':
        case 'openai-shim':
            return normalizeOpenAI(raw, model);
        default:
            return normalizeGeneric(raw, provider, model);
    }
}
```

### 2) cacheStatsTracker

```ts
export class CacheStatsTracker {
    private hit = 0; private miss = 0; private create = 0;
    record(u: NormalizedUsage) {
        this.hit += u.cacheRead ?? 0;
        this.create += u.cacheCreate ?? 0;
        this.miss += u.input - (u.cacheRead ?? 0);
    }
    summary() {
        const total = this.hit + this.miss;
        return { hit: this.hit, miss: this.miss, create: this.create,
                 hitRate: total ? this.hit / total : 0 };
    }
}
```

### 3) `xqoder cost`

```
xqoder cost             # 当前 session
xqoder cost --session <id>
xqoder cost --total     # 累计跨 session
xqoder cost --json
```

输出列：`input / output / cacheRead / cacheCreate / $cost / duration`。

### 4) 遥测 sink

```ts
export interface TelemetrySink {
    log(event: TelemetryEvent): void;
    flush(): Promise<void>;
}

export function getTelemetrySink(): TelemetrySink {
    const choice = process.env.XQODER_TELEMETRY_SINK ?? 'noop';
    if (choice === 'datadog') return createDatadogSink();
    return createNoopSink();
}
```

**任何** 模型调用、工具调用、hook 调用都应发 1 条事件；事件结构：

```ts
type TelemetryEvent =
  | { type: 'model.completed'; usage: NormalizedUsage; durationMs: number }
  | { type: 'tool.completed'; name: string; success: boolean; durationMs: number }
  | { type: 'hook.completed'; event: HookEventName; decision: string; durationMs: number }
  | { type: 'session.ended'; totalUsage: NormalizedUsage; sessionId: string };
```

## 验证

- Unit：5 个 provider 的 usage fixture → normalize 断言。
- e2e：跑一轮对话，`session.usage` 与 CLI `xqoder cost` 一致。

## 风险与回退

- **风险**：cost 不准（中转商不返回准确 cache 字段）。
  **缓解**：`costUsd` 作为"best-effort"，在 UI 上加 tooltip "approximate"。
- **回退**：`XQODER_DISABLE_TELEMETRY=1` 退到 noop sink。

## 不确定项

- 各 provider 的具体 usage 字段路径需要现场抓样（尤其 minimax / xai）。
  参考 OpenClaude `minimaxUsage/fetch.ts / parse.ts` 做 map。
