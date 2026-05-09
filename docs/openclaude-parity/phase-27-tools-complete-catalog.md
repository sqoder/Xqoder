# Phase 27 · 40+ 工具完整补齐

## 任务目标（必须可验证）

把 XQoder 的工具集从当前约 25 个扩到 40+（对齐 OpenClaude `src/tools/**`
下的约 50 个子目录）。每个新增工具必须满足：
- 有单元测试 fixture。
- 标注 `concurrencySafe`（phase-12）。
- 列出 schema、权限策略、错误形态。

## 对标源（目录级清单）

```
openclaude/src/tools/
├── AgentTool/             ← phase-16
├── AskUserQuestionTool/   ★ 本期
├── BashTool/              ← XQoder 有，需补齐 BashTool 的 commandSemantics / security
├── BriefTool/             ★ 本期
├── ConfigTool/            ★ 本期
├── EnterPlanModeTool/     ★ 本期（+ ExitPlanModeTool）
├── EnterWorktreeTool/     ← phase-19
├── ExitPlanModeTool/
├── ExitWorktreeTool/      ← phase-19
├── FileEditTool/          ← 已有 EditFileTool，映射
├── FileReadTool/          ← 已有
├── FileWriteTool/         ← 已有
├── GlobTool/              ← 已有
├── GrepTool/              ← 已有
├── ListMcpResourcesTool/  ← phase-13
├── LSPTool/               ← 已有
├── McpAuthTool/           ← phase-13
├── MCPTool/               ← 已有
├── MonitorTool/           ★ 本期（feature MONITOR_TOOL）
├── NotebookEditTool/      ★ 本期
├── PowerShellTool/        ★ 本期（Windows only）
├── ReadMcpResourceTool/   ← phase-13
├── RemoteTriggerTool/     ★ 本期
├── REPLTool/              ★ 本期
├── ScheduleCronTool/      ← phase-19
├── SendMessageTool/       ← phase-19
├── SkillTool/             ← phase-17
├── SleepTool/             ★ 本期
├── SuggestBackgroundPRTool/ ★ 本期
├── SyntheticOutputTool/   ★ 本期
├── TaskCreateTool/        ← phase-19
├── TaskGetTool/           ← phase-19
├── TaskListTool/          ← phase-19
├── TaskOutputTool/        ← phase-19
├── TaskStopTool/          ← phase-19
├── TaskUpdateTool/        ← phase-19
├── TeamCreateTool/        ← phase-19
├── TeamDeleteTool/        ← phase-19
├── TodoWriteTool/         ← 已有 TodoWriteTool/TodoReadTool
├── ToolSearchTool/        ★ 本期（仅 feature 开时启用）
├── TungstenTool/          —  Ant 内部工具，**不复刻**
├── VerifyPlanExecutionTool/ ★ 本期
├── WebFetchTool/          ← 已有 FetchUrlTool
├── WebSearchTool/         ← 已有
├── WorkflowTool/          ★ 本期（feature WORKFLOW_SCRIPTS）
```

★ = 本期新增；其余已在前面的 phase 处理或已实现。

### 成功判定

- 所有 ★ 工具均已实装并在 `registerDefaultAgentTools` 注册（按 feature flag
  控制是否注册）。
- 每个新工具至少 3 条单测（正常 / 边界 / 失败）。
- Registry `getAllBaseTools()` 返回数组长度 ≥ 40（含 MCP alias 后更多）。
- `/tool-search` 命令和 `ToolSearchTool` 可选（仅 feature 开启）。

## 范围与边界

### 允许修改

- 新增 `src/core/agent/tools/*.ts` 每个工具一个文件（或一个子目录放多文件）。
- 修改 `src/core/agent/agent-default-tools.ts` 按 feature flag 注册。
- 补齐每个工具的 **prompt 描述** —— 这是 tool selection 的关键输入。

### 禁止修改

- `Tool` 接口签名。

## 改动要点（逐工具骨架）

下列只给"最小可行骨架"，不展开 prompt 文本（施工时参考 OpenClaude 对应
`prompt.ts` 自写）。

### AskUserQuestionTool

```ts
// 结构化问卷，返回 {answers: Record<questionId, choice>}
```
`concurrencySafe = false`。

### BriefTool

```ts
// 会话级摘要，用于压缩 phase。内部调 subagent summarizer。
```
`concurrencySafe = true`。

### ConfigTool

```ts
// 读写 ~/.xqoder/config.json 的指定 key，给模型用于自我配置。
```
`concurrencySafe = false`。

### EnterPlanModeTool / ExitPlanModeTool

```ts
// 切 permissionMode = 'plan' / 恢复原 mode
```
`concurrencySafe = false`。

### MonitorTool

```ts
// 观测 session 运行时指标；feature MONITOR_TOOL gated.
```

### NotebookEditTool

```ts
// 对 .ipynb 按 cell 编辑：{path, cellIndex, newSource}
```
`concurrencySafe = false`。

### PowerShellTool

```ts
// Windows 平台；非 Windows 注册时跳过。
// wrapper = spawn('powershell.exe', ['-NoProfile','-Command', cmd])
```
`concurrencySafe = false`。

### RemoteTriggerTool

```ts
// 调用 phase-25 的 daemon API 远程触发 session 任务
```
`concurrencySafe = false`。

### REPLTool

```ts
// 在沙箱 JS VM 里跑代码（vm2 不能用；用 node:vm module 的 SourceTextModule）
// 允许内部封 Bash/Read/Edit 三个原语
```
`concurrencySafe = false`。

### SleepTool

```ts
// {ms: number} → await new Promise(r => setTimeout(r, ms))
```
`concurrencySafe = true`。

### SuggestBackgroundPRTool

```ts
// 建议在后台创建 PR（Ant 内部集成）；v1 返回 "not supported in external build"
```

### SyntheticOutputTool

```ts
// 强制模型以指定 JSON Schema 返回结构化结果。
// 实现上等价于"一次只允许该 tool"的模式（limit tools list to 1）。
```

### ToolSearchTool（按需发现）

```ts
// 工具池过大时，模型可先搜工具：{query} → 返回最多 8 个工具的 summary。
// 激活后把选中的工具注入下一轮 tools 数组（仅当轮）。
```
feature `TOOL_SEARCH_LAZY`（默认 off）。

### VerifyPlanExecutionTool

```ts
// 验收已执行步骤：{steps: [...] } → 对每步查证 → 返回 pass/fail 表。
// 内部对每步按类型跑验证（read-file / run-cmd / expected-pattern 等）。
```
`concurrencySafe = false`。

### WorkflowTool

```ts
// 运行预定义脚本（YAML）。
// feature WORKFLOW_SCRIPTS gated.
```

## 验证

- `getAllBaseTools()` 返回数组在 feature flag 全开时长度 ≥ 40。
- 每工具至少 3 测。
- `bun run lint:application-chat-strict` 通过。

## 风险与回退

- **风险**：工具太多让模型 tool selection 困难（上下文变大）。
  **缓解**：开 `TOOL_SEARCH_LAZY`，默认只暴露 core 12–15 个，其它按需。
- **回退**：`XQODER_FEATURE_TOOL_SEARCH_LAZY=0` 显示全部；`=1` 仅 core +
  ToolSearchTool。

## 不确定项

- `TungstenTool` 是 Ant 内部 Tungsten 集成，外部不复刻。
- `PowerShellTool` 的 sandbox 策略（限定 `-NoProfile` 不够）。v1 走与 BashTool
  相同的 sandbox 规则（cwd 限制 + allowedPaths 白名单）。
