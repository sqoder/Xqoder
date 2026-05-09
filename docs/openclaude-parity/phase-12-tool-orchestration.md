# Phase 12 · 工具调度（partitionToolCalls + StreamingToolExecutor + autoFix）

## 任务目标（必须可验证）

把工具调度升级到 OpenClaude `services/tools/**` 的水平：

| 源文件 | 目的 |
|---|---|
| `services/tools/toolOrchestration.ts` | 顶层调度入口，管 abort / permission / hook |
| `services/tools/toolExecution.ts` | 单工具执行一条流水线 |
| `services/tools/toolHooks.ts` | Pre/Post hook 串联 |
| `services/tools/StreamingToolExecutor.ts` | 并发批次执行（只读可并发；写入串行） |
| `services/autoFix/autoFixRunner.ts` | 执行后自动跑 lint/test 修正 |

### 成功判定

- 模型一轮返回 `[read, read, glob, grep, edit, write]`：
  - 前 4 个只读工具 **并发** 执行（上限 10）。
  - 后 2 个写入工具 **串行** 执行。
- Pre/Post hook 按 `PreToolUse → call → PostToolUse → PostToolUseFailure?
  → autoFix?` 顺序跑。
- autoFix 只对修改文件的工具启用；失败不阻断下一轮 LLM。
- 工具 abort：用户 Ctrl+C 能立即终止当前批次，未开工的工具不再起。

## 对标源

- `openclaude/src/services/tools/toolExecution.ts`
- `openclaude/src/services/tools/toolOrchestration.ts`
- `openclaude/src/services/tools/toolHooks.ts`
- `openclaude/src/services/tools/StreamingToolExecutor.ts`
- `openclaude/src/services/autoFix/autoFixRunner.ts`
- `openclaude/src/services/autoFix/autoFixHook.ts`
- `openclaude/src/services/autoFix/autoFixConfig.ts`
- `openclaude/src/Tool.ts`（ToolRegistry + isConcurrencySafe）

## 范围与边界

### 允许修改

- `src/application/chat/tool-orchestrator.ts` 重构为"事件薄层"。
- 新增 `src/core/tools/`：
  - `orchestrator.ts`（总调度）
  - `executor.ts`（单工具流水线）
  - `partition.ts`（并发分批）
  - `streaming-executor.ts`
  - `auto-fix-runner.ts`
- `src/core/agent/tools/tool.ts` 的 `ToolRegistry` 增加 `isConcurrencySafe(): boolean` 字段。
- 所有现有工具在其 class 上标注 `readonly concurrencySafe: boolean`。

### 禁止修改

- Tool 接口的 `call(args, ctx): Promise<ToolResult>`。
- 现有 hook payload 类型。

## 改动要点

### 1) partition

```ts
// src/core/tools/partition.ts
export interface ToolBatch { concurrent: boolean; calls: ToolCall[]; }

export function partitionToolCalls(
    calls: ToolCall[],
    registry: ToolRegistry,
    options: { maxConcurrent?: number } = {},
): ToolBatch[] {
    const max = options.maxConcurrent ?? 10;
    const batches: ToolBatch[] = [];
    let current: ToolBatch | null = null;

    for (const call of calls) {
        const tool = registry.get(call.name);
        const safe = tool?.concurrencySafe === true;
        if (!current || current.concurrent !== safe || (current.concurrent && current.calls.length >= max)) {
            current = { concurrent: safe, calls: [] };
            batches.push(current);
        }
        current.calls.push(call);
    }
    return batches;
}
```

### 2) StreamingToolExecutor

```ts
export async function runToolBatches(
    batches: ToolBatch[],
    ctx: ToolExecutionContext,
): AsyncIterable<ToolExecutionResult> {
    for (const batch of batches) {
        if (ctx.signal.aborted) return;
        if (batch.concurrent) {
            const results = await Promise.all(batch.calls.map(c => runToolUse(c, ctx)));
            for (const r of results) yield r;
        } else {
            for (const c of batch.calls) {
                if (ctx.signal.aborted) return;
                const r = await runToolUse(c, ctx);
                yield r;
            }
        }
    }
}
```

### 3) autoFix

`src/core/tools/auto-fix-runner.ts`：

- 触发条件：`tool.name in { edit_file, write_file, apply_patch }` 且
  session 配置 `autoFix.enabled`。
- 流程：`runLint() → runTypeCheck() → (若失败) 把错误 append 为 system
  message 让模型下一轮修复`。
- 触发次数上限：本 session 每轮 ≤ 2 次；超上限自动禁用本轮 autoFix。

### 4) 每工具标注

已有的 30+ 工具（`src/core/agent/tools/*`）逐一添加 `concurrencySafe`：

- 只读：`ReadFileTool, GrepContentTool, GlobFilesTool, FetchUrlTool,
  WebSearchTool, DiagnosticsTool, SearchCodeTool, ReadAnyFileTool,
  Lsp*Tool（只读部分）, SourcegraphTool, DiscoverSkillsTool` → `true`
- 写入 / 命令：`WriteFileTool, EditFileTool, ApplyPatchTool,
  PreviewDiffTool, RunShellTool, RunCommandTool, InstallPackageTool,
  RestoreRollbackPointTool, InspectGitHubRepoTool` → `false`
- 交互类：`QuestionTool, SkillTool, TodoWriteTool` → `false`
- 子 agent：`DelegateTaskTool` → `false`（可并发但先保守串行）

## 验证

- 单测：`partitionToolCalls([read, read, edit, read])` → 3 批次
  `[concurrent(2), serial(1), concurrent(1)]`。
- 集成：模拟 5 个 read → 并发 Promise.all；中途 abort → 后续不运行。
- autoFix：mock `runLint` 返回错误 → 检测到 system message 追加。

## 风险与回退

- **风险**：并发 read 竞争 LSP；LSP 一些操作非线程安全。
  **缓解**：LSP 相关工具默认 `concurrencySafe = false`。
- **回退**：`XQODER_DISABLE_TOOL_PARTITION=1` 所有工具串行。

## 不确定项

- OpenClaude 的 `autoFixRunner` 还对 "test" 做了执行，风险较大（会改真实文件）。
  v1 只跑 lint/type-check；test 留 v2。
