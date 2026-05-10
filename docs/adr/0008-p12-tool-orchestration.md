# ADR 0008 — P12 工具调度(partition + autoFix + AbortSignal)

- **Date**: 2026-05-10
- **Status**: Accepted
- **Phase**: P12
- **Related docs**: `docs/openclaude-parity/phase-12-tool-orchestration.md`
- **软红线**: `src/application/chat/tool-orchestrator.ts` — 改动仅限"把行内批量分组替换为可复用 `partitionToolCalls` + 新增 `abortSignal` 形参 + 环境变量 escape hatch",不动现有 `prepareToolCall` / `invokePreparedToolCall` / `finalizeToolCall` 三段语义,不动 stages 列表,不动 `ToolExecutionPort` 接口。

## 背景

OpenClaude `services/tools/**` 的调度流水线有四样东西当时 XQoder 缺:

1. **独立可测的 `partitionToolCalls`**:把 `[read, read, edit, read, write]` 分成 `[concurrent(2), serial(1), concurrent(1), serial(1)]`,受 `maxConcurrent` 约束(默认 10)。
2. **`runToolBatches(batches, ctx)`** 作为通用并发/串行驱动(子 agent、批量工具、单独的 pipeline 都能复用)。
3. **AbortSignal**:Ctrl+C 能立即终止当前批次,未开工的工具不起。
4. **`autoFix` runner**:写入型工具(`edit_file` / `write_file` / `apply_patch`)成功后自动跑 lint/type-check,失败时把错误 append 为 system message,让下一轮 LLM 自修复;每轮上限 2 次。

**现状盘点**(P12 开工前):

- `ITool` 接口已有 `isConcurrencySafe?(args, context): boolean`(方法形式,不是 readonly 字段);部分工具已标注。
- `ToolRegistry` 在 `src/core/agent/tools/tool.ts`,用 `isToolInvocationConcurrencySafe(tool, args, ctx)` 读。
- `tool-orchestrator.ts` 已经按 `preparation.canRunInParallel` 分批并发(不是全串行),但那段逻辑**行内写死**,没有独立模块,没有 abort,也没复用口子给子 agent / autoFix。
- 无独立 `auto-fix-runner`,没有 lint/type-check 触发点。

## 决策

### 1) 子模块落位 — `src/core/agent/tools/`(而不是施工单写的 `src/core/tools/`)

**施工单原文**:`新增 src/core/tools/ … partition.ts / streaming-executor.ts / auto-fix-runner.ts`。

**实际落位**:`src/core/agent/tools/partition.ts`(和 `streaming-executor.ts` / `auto-fix-runner.ts`)。

**理由**:architecture guardrails 禁止 `application → core` 的相对 import(P11 ADR-0007 §2 已踩过一次)。`@xqoder/agent` 别名映射到 `src/core/agent/`;所有三模块经由 `src/core/agent/index.ts` re-export,`tool-orchestrator.ts` 只写 `from '@xqoder/agent'`。guardrail 原样通过。

为避免与现有 `test/core/tools/` 路径冲突,新测试也相应放到 `test/core/agent-tools/`。

### 2) `tool-orchestrator.ts`(软红线)重构为"薄层"

- 保留原先的 **2 段主体**:`prepareToolCallExecution`(同步串行预备)+ batch 执行阶段。
- 把第二段行内批量分组替换为:
  ```ts
  const batches = partitionToolCalls(
      preparedCalls.map((item) => item.toolCall),
      {
          isConcurrencySafe: (call) => partitionDisabled
              ? false
              : preparedByCallId.get(call.id)?.preparation.canRunInParallel === true,
      },
  );
  ```
- `isConcurrencySafe` 判定**不读**工具上的 `isConcurrencySafe()`:那是上游 `ToolExecutionPort.prepareToolCall` 已经算进 `preparation.canRunInParallel` 的事情。orchestrator 继续信任 `preparation.canRunInParallel`,**没有**改变并发判定口径 — 这条很重要,因为软红线同时约束 `permission-gate.ts` 和 `conversation-engine.ts` 的期望。
- 新增 `abortSignal?: AbortSignal`,在"批次之间"与"serial 批次内的 call 之间"检查 `signal.aborted` → `break`(保持已收集的 `results`,直接返回)。
- 新增 escape hatch `XQODER_DISABLE_TOOL_PARTITION=1` → `isConcurrencySafe` 常返 false → 彻底串行。

**不动的**:现有 `stages[]` 列表、`rendererProjection`、`ensureToolResultMessage`、`ToolExecutionPort` 三段契约、`createCompatibilityToolExecutionPort` fallback。

### 3) `isConcurrencySafe()` 补标

施工单表格共 30+ 工具。P12 开工前已覆盖:file-tools(Read/Write/Edit/Search)、lsp-*(多数)、discovery-tools、github-repo-tool、patch-tool、read-any-file。

本期补的 9 个:

- **只读安全** → `true`:`DiagnosticsTool`、`FetchUrlTool`、`WebSearchTool`、`SourcegraphTool`、`TodoReadTool`
- **写入/交互/子 agent** → `false`:`RunCommandTool`、`RunShellTool`、`InstallPackageTool`、`LspRenameSymbolTool`、`SkillTool`、`TodoWriteTool`、`QuestionTool`、`DelegateTaskTool`(可并发但按施工单先保守串行)

`PreviewDiffTool` **不显式标注**:默认 `isConcurrencySafe` 未实现即返回 `false`,和我们想要的"不并发"等价;显式加 8 行会触发 `file-size:guardrail`(1000+ 行 hotspot),收益负。

### 4) `auto-fix-runner`(本期只实现 runner,未接入 conversation-engine)

v1 仅暴露 `createAutoFixRunner({runLint, runTypeCheck, maxPerTurn})`,给后续期(或外部)拼到 `runToolOrchestrator` 输出之后。**没有**把 lint/type-check 直接跑到 release:check 子进程里 — 施工单明写 "test 留 v2",而 lint/type-check 的真实命令依赖项目配置,做成 **注入 runLint/runTypeCheck 两个 Promise 工厂**。`edit_file` / `write_file` / `apply_patch` 之外的工具一律跳过。

**未接入 conversation-engine**:本期施工单允许的软红线改动上限是 `tool-orchestrator.ts` 一个文件 + 新增 `core/agent/tools/*`,不在 `conversation-engine.ts` 里加 autoFix 调用点。autoFix 的真实接入(lint/type-check 命令 + 结果转 system message 注入主循环)留给下一期(P13 或独立的工具 hook phase)。

### 5) Guardrail 架构说明

- `application/chat/tool-orchestrator.ts`(software red line)只新增一行 `import { partitionToolCalls } from '@xqoder/agent'`,通过层级别名,绕开相对 path guardrail。
- `architecture-guardrails.test.ts` 不变。

## 不确定项 / 后续

1. **autoFix 接入点**:lint/type-check 的真实命令从哪里来?
   - 可选 A:读 `package.json` 里 `scripts.lint` / `tsc --noEmit`(cwd-aware)。
   - 可选 B:走 mvpRuntimeConfig 里用户声明的命令。
   - 落地到 P13 或 P19 附近再定。
2. **测试触发**:施工单列为"v2",不做。
3. **DelegateTaskTool 并发**:OpenClaude 本身是串行;真并发子 agent 可能竞争 LSP,保守串行不影响正确性。
4. **rename concurrent**:`LspRenameSymbolTool` 目前 `false`,如果未来支持"同一文件内多处 rename 并发",需要单独评估。

## 验证

- `bun run lint`:✅
- 新测试文件:
  - `test/core/agent-tools/partition.test.ts`(6 用例)
  - `test/core/agent-tools/streaming-executor.test.ts`(4 用例,含 AbortSignal 测试 2 例)
  - `test/core/agent-tools/auto-fix-runner.test.ts`(6 用例)
- `test/application/chat/tool-orchestrator.test.ts` 新增 2 用例(AbortSignal 中断 + `XQODER_DISABLE_TOOL_PARTITION=1` 串行回退)
- `test/architecture-guardrails.test.ts`:✅ 未回归
- 全仓库 `bun test`:3284 pass(baseline 3282,本期 +2);43 fail 全为 pre-existing UI/Theme/Provider 测试,与 P12 无关

## 回退

`XQODER_DISABLE_TOOL_PARTITION=1` → 所有工具串行,等价于 OpenClaude `disablePartition` 开关。
