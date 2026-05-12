# Phase 26 · SDK 入口（headless / structuredIO）

## 任务目标（必须可验证）

对齐 OpenClaude `entrypoints/sdk/**` + `cli/structuredIO.ts` 的 SDK 用法：

- `xqoder -p "..."`（print 模式）输出一条最终消息，无 UI，无交互。
- `xqoder --output-format json` 或 `--output-format ndjson` 输出结构化
  事件流，适合集成到 CI / 其他工具。
- `xqoder --input-format ndjson` 从 stdin 读 user / control 消息，做可脚本化的
  双向 IO。

## 对标源

- `openclaude/src/entrypoints/sdk/**`
- `openclaude/src/entrypoints/agentSdkTypes.ts`
- `openclaude/src/entrypoints/sdk.d.ts`
- `openclaude/src/cli/structuredIO.ts`
- `openclaude/src/cli/ndjsonSafeStringify.ts`
- `openclaude/src/cli/transports/**`
- `openclaude/src/utils/sdkEventQueue.ts`
- `openclaude/src/remote/sdkMessageAdapter.ts`
- `openclaude/src/controlMessageCompat.ts`

### 成功判定

- 以下四种模式全部可用：
  - **A** `xqoder -p "…"`（plain text 输出最终回答）。
  - **B** `xqoder -p "…" --output-format=json` 输出单一 JSON 最终结果。
  - **C** `xqoder -p "…" --output-format=ndjson` 按事件 envelope 逐行输出。
  - **D** `xqoder --input-format=ndjson --output-format=ndjson` 全双工 stream。
- 结构化事件形状与 `ConversationEventEnvelope` 一致（protocol 已存在）。
- control 消息：stdin 里可以发 `{ "type": "control.interrupt" }` 中断当前 turn。

## 范围与边界

### 允许修改

- 新增 `src/cli/structured-io.ts`（本层 I/O 转换）。
- 新增 `src/cli/handlers/print.ts`（headless 分流入口）。
- 新增 `src/bootstrap/run-headless.ts`。
- `src/bootstrap/cli-main.ts` 分流进入 headless。

### 禁止修改

- `ConversationEventEnvelope` schema。
- Ink UI 代码（headless 完全不走）。

## 改动要点

### 1) 四模式开关

```ts
// run-headless.ts
export async function runHeadless(args, opts): Promise<number> {
    const input = opts.inputFormat ?? 'text';
    const output = opts.outputFormat ?? 'text';

    const session = await bootstrapSession(opts);
    const engine = new QueryEngine(engineDepsFrom(session));

    const userMessages = input === 'ndjson' ? readNdjsonStdin() : [opts.prompt];

    for await (const text of userMessages) {
        for await (const env of engine.submitMessage({ text })) {
            emitEnvelope(env, output);
        }
    }
    return 0;
}
```

### 2) ndjsonSafeStringify

```ts
export function ndjsonSafeStringify(obj: unknown): string {
    return JSON.stringify(obj, replaceCircular).replace(/\n/g, '\\n') + '\n';
}
```

保证每行一条合法 JSON（无裸换行）。

### 3) Control 消息

```ts
interface ControlMessage {
    type: 'control.interrupt' | 'control.new_turn' | 'control.feature_toggle';
    payload?: unknown;
}
```

控制消息走 stdin 特殊通道（与 user message 混入同一 ndjson 流，用
`type` 前缀区分）。

### 4) Event queue backpressure

```ts
class SdkEventQueue {
    private waiting: QueueItem[] = [];
    enqueue(env) { if (writableHighWaterMark reached) pauseEngine() else write() }
    resume() { /* on drain */ }
}
```

### 5) SDK d.ts 对外

```ts
// src/entrypoints/sdk.d.ts
export interface RunOptions { prompt: string; cwd?: string; model?: string; ... }
export interface SdkEvent extends ConversationEventEnvelope {}
export function run(opts: RunOptions): AsyncIterable<SdkEvent>;
```

供第三方作为 library 调用；需要一个最小 `@xqoder/sdk` 包（本期不拆包，
仍放 monorepo；只输出 `.d.ts`）。

## 验证

- `bun dist/index.js -p "hello" --output-format=ndjson | head -5`
  逐行 JSON parse 成功。
- e2e：写一个 python 脚本用 `subprocess` 走 D 模式双向交互。

## 风险与回退

- **风险**：backpressure 处理不当导致内存涨。
  **缓解**：queue 高水位 1024 条，超过即暂停 engine 读取。
- **回退**：`XQODER_SDK_DISABLE_BACKPRESSURE=1` 退到直接 write，已知有内存风险但简单。

## 不确定项

- `controlMessageCompat` 在 OpenClaude 里处理了多版本 SDK 客户端的协议差异。
  本期 v1 只出 v1 schema；兼容层 v2 再做。
