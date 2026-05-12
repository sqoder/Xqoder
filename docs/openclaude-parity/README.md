# OpenClaude 完整复刻 · 总索引 v2

## 写在前面 · 复刻真实成本

OpenClaude 的源代码规模是 **2,348 个 .ts/.tsx 文件 · ~60.4 万行**
（`openclaude/src/**`）。核心热点单文件已经到这个量级：

| 文件 | LOC |
|---|---:|
| `services/api/claude.ts` | 3,463 |
| `services/api/openaiShim.ts` | 2,321 |
| `query.ts` | 1,914 |
| `utils/permissions/yoloClassifier.ts` | 1,603 |
| `QueryEngine.ts` | 1,430 |
| `services/api/withRetry.ts` | 879 |

XQoder 当前 `src/` 总 LOC ≈ 6.3 万，属于同量级的 **1/10**。**"完全复刻"**
意味着要再写约 55 万行 TypeScript，业务功能匹配，UI 匹配，性能匹配，
hook / feature flag / fast-path / SDK / Bridge / Chrome 扩展也匹配。
写这套文档 **不是** 让你在一周内实现，而是提供一张 **按层独立落地** 的
路线图：**每一期都是独立可验收、可回退、可部分交付的 PR 级工作包**。

完全跑满本路线图，以我自身经验估算 **至少 4–6 人月全职**；如只做终端+对话
核心（phase 01–10），1.5 人月可接近"看起来像 Claude Code"。

---

## 逐层 fidelity 矩阵（对标 OpenClaude 源）

> 0 = 没有；1 = 存在基础 stub；2 = 功能部分可用；3 = 主要 code path 覆盖；
> 4 = 边界行为覆盖；5 = 逐行对齐 OpenClaude。

| # | 层 / 子系统 | OpenClaude 主要源 | XQoder 当前 | 目标 | 对应 phase |
|---|---|---|---:|---:|---|
| L01 | CLI 启动 fast-path | `entrypoints/cli.tsx` (~1700 行), `bin/openclaude`, `utils/providerFlag.ts`, `utils/providerProfile.ts`, `utils/providerValidation.ts`, `utils/cliArgs.ts` | 2 | 4 | P10 |
| L02 | Ink 渲染层 | `src/ink/**`（47 文件）+ `components/**`（150+ 文件）+ `screens/REPL.tsx` | 0 | 3 | P06, P22, P23 |
| L03 | 输入预处理 | `utils/processUserInput/**`, `commands.ts`, `context.ts`, `memdir/**` | 3 | 4 | P11 |
| L04 | Query 主循环 | `query.ts`（1914） + `QueryEngine.ts`（1430） + `query/config.ts / deps.ts / stopHooks.ts / tokenBudget.ts` | 3 | 4 | P09 |
| L05 | Provider 选路 | `services/api/client.ts / providerConfig.ts / agentRouting.ts / smartModelRouting.ts / authRouting.ts` | 3 | 4 | P07 |
| L06 | Model 调用 façade | `services/api/claude.ts` | 2 | 4 | P03（改 Anthropic 时） + P05（OpenAI 时） |
| L07 | 格式适配（shim） | `services/api/openaiShim.ts / codexShim.ts / toolArgumentNormalization.ts / openaiSchemaSanitizer.ts / thinkTagSanitizer.ts / compressToolHistory.ts / cacheMetrics.ts` | 1 | 4 | P05, P08 |
| L08 | HTTP / retry | `services/api/withRetry.ts / fetchWithProxyRetry.ts / errors.ts / openaiErrorClassification.ts` | **3 (P01 done)** | 4 | P01 ✅ |
| L09 | 工具调度 | `services/tools/toolExecution.ts / toolOrchestration.ts / toolHooks.ts / StreamingToolExecutor.ts` + `Tool.ts`, `tools.ts` | 3 | 4 | P12 |
| L09-M | MCP 集成 | `services/mcp/**`（30+ 文件）+ `tools/MCPTool / McpAuth / ListMcpResources / ReadMcpResource` | 3 | 4 | P13 |
| L09-H | 生命周期 hook | `utils/hooks/**`（16 文件）+ `schemas/hooks.ts` + `types/hooks.ts` + `services/autoFix/**` | 2 | 4 | P14 |
| L10 | 渲染 UX | `components/messages/**`, `components/Spinner/**`, `components/diff/**`, `components/PromptInput/**`, `components/StructuredDiff/**` | 0 | 3 | P22 |
| L11 | 成本 / 遥测 | `cost-tracker.ts / costHook.ts / services/api/cacheMetrics.ts / cacheStatsTracker.ts / usage.ts / services/analytics/**` | 2 | 4 | P15 |
| — | 权限系统 | `utils/permissions/**`（25 文件）含 `yoloClassifier.ts`（1603，**LLM 驱动**）+ `bashClassifier.ts / dangerousPatterns.ts / permissions.ts / PermissionRule.ts / PermissionMode.ts` | 2 | 4 | P04（修正版） |
| — | 压缩管线 | `services/compact/**`（14 文件）+ `services/contextCollapse/**` + `utils/hybridContextStrategy.ts` | 1 | 4 | P02 |
| — | Prompt cache | `services/api/claude.ts` 的 `addCacheBreakpoints` + `promptCacheBreakDetection.ts` + `cacheStatsTracker.ts` + `cachedMicrocompact.ts` | 0 | 4 | P03 |
| — | Agent 嵌套 | `tools/AgentTool/**`（15 文件）含 `builtInAgents.ts / loadAgentsDir.ts / forkSubagent.ts / runAgent.ts / agentMemory.ts` + `coordinator/**` + `tasks/**`（6 个 Task 类型） | 2 | 3 | P16, P19 |
| — | Skills | `skills/bundledSkills.ts / loadSkillsDir.ts / mcpSkillBuilders.ts` + `tools/SkillTool` + `utils/skills/**` | 0 | 3 | P17 |
| — | Plugin 生态 | `plugins/**` + `services/plugins/**` + `utils/plugins/**` + `hooks/useManagePlugins.ts` | 1 | 3 | P18 |
| — | 思考档位 | `utils/thinking.ts / effort.ts / fastMode.ts / thinkingTokenExtractor.ts` + commands `/think /nothink /effort /fast` | 1 | 3 | P20 |
| — | OAuth | `services/oauth/**`（7 文件）+ `utils/auth.ts / authPortable.ts / authFileDescriptor.ts / codexCredentials.ts / geminiCredentials.ts / githubModelsCredentials.ts` | 0 | 3 | P21 |
| — | 会话生命周期 | `utils/sessionStorage.ts / sessionRestore.ts / sessionStart.ts / sessionState.ts / sessionTitle.ts / conversationRecovery.ts / conversationArc.ts` + `assistant/sessionHistory.ts` | 3 | 4 | P24 |
| — | Bridge / 远程 | `bridge/**`（34 文件）+ `remote/**` + `server/**` + `grpc/**` + `hooks/useReplBridge.tsx` | 1 | 3 | P25 |
| — | Task V2 | `Task.ts`, `tasks.ts`, `tasks/**`（DreamTask / InProcessTeammateTask / LocalAgentTask / LocalShellTask / MonitorMcpTask / RemoteAgentTask） | 1 | 3 | P19 |
| — | Cron | `utils/cron.ts / cronScheduler.ts / cronTasks.ts / cronJitterConfig.ts / cronTasksLock.ts` + `tools/ScheduleCronTool/**` | 0 | 2 | P19 |
| — | Worktree | `tools/EnterWorktreeTool / ExitWorktreeTool` + `utils/worktree.ts / getWorktreePaths.ts` | 0 | 2 | P19 |
| — | VSCode 扩展 | `openclaude/vscode-extension/**` | 3 | 3 | 复用 XQoder 自有 |
| — | Web / Chrome MCP | `web/**`, `utils/claudeInChrome/**` | 0 | 0 | 不在本期范围 |
| — | SDK | `entrypoints/sdk/**`, `remote/sdkMessageAdapter.ts`, `utils/sdkEventQueue.ts` | 0 | 2 | P26 |
| — | Vim / 键绑定 | `keybindings/**`, `vim/**`, `hooks/useVimInput.ts` | 0 | 2 | P23 |
| — | 输出样式 | `outputStyles/**`, `constants/outputStyles.ts`, `commands/output-style/**` | 1 | 3 | P17 |
| — | 40+ 工具 | `tools/**`（~50 个工具子目录） | 约 25 工具 | 约 40 工具 | P27 |

---

## 24 期完整路线图

### 阶段 A · 稳定性地基（必做）

| 期 | 标题 | 状态 | 估工作量（人·日） |
|---|---|---|---:|
| **P01** | HTTP withRetry + 错误分级恢复 | 已出文档 | 3 |
| **P02** | 压缩管线四驾马车 | 已出文档（需补 `cachedMicrocompact`） | 4 |
| **P03** | Prompt cache 断点 + `addCacheBreakpoints` + `promptCacheBreakDetection` | 已出文档 | 3 |
| **P04** | 权限五档 + **LLM 驱动 yolo 分类器**（两阶段） | 已出文档 · **修订版** 见 phase-04 | 5 |
| **P05** | openaiShim 双向翻译（含 codexShim） | 已出文档 | 6 |

### 阶段 B · 协议与对话

| 期 | 标题 | 估工作量 |
|---|---|---:|
| **P06** | Ink REPL 骨架（渲染器 + 组件骨架 + 键盘事件） | 10 |
| **P07** | Provider 选路 `getAnthropicClient` 决策树 + `agentRouting` + `smartModelRouting` | 4 |
| **P08** | `codexShim` + `compressToolHistory` + `thinkTagSanitizer` + `toolArgumentNormalization` | 4 |
| **P09** | Query 主循环：`queryLoop` 状态机 + `snip/micro/collapse/autocompact` 五级压缩整合 + `tokenBudget` + `stopHooks` | 8 |
| **P10** | CLI fast-path 分流（`--version / --dump-system-prompt / --claude-in-chrome-mcp / daemon / bridge / remote-control / --worktree --tmux`）+ `feature()` 编译期宏 | 6 |

### 阶段 C · 工具生态

| 期 | 标题 | 估工作量 |
|---|---|---:|
| **P11** | 输入预处理：slash / `@file` / memdir / contextPreload / handlePromptSubmit hook | 5 |
| **P12** | 工具调度 `partitionToolCalls` 并发批次 + `StreamingToolExecutor` + Pre/Post hook 全链 + autoFix | 8 |
| **P13** | MCP 全家桶：stdio/http/sse + OAuth + `elicitationHandler` + `channelNotification` + `ListMcpResources / ReadMcpResource / McpAuth / MCPTool` 工具 + `useManageMCPConnections` | 10 |
| **P14** | Hook 事件 8 元：`PreToolUse / PostToolUse / PostToolUseFailure / UserPromptSubmit / SessionStart / SessionEnd / Stop / SubagentStop / PreCompact / PostCompact`  + `execHttpHook / execPromptHook / execAgentHook` + `AsyncHookRegistry` + `hooksSettings` | 7 |
| **P15** | 成本 / 遥测：`cost-tracker` + `cacheStatsTracker` + `cacheMetrics` + `usage` + `codexUsage` + `minimaxUsage` + analytics sink | 4 |
| **P16** | Agent 嵌套：`AgentTool` + `builtInAgents` + `loadAgentsDir` + `forkSubagent` + `agentMemory` + `agentColorManager` | 6 |
| **P17** | Skills + OutputStyles：`loadSkillsDir` + `bundledSkills` + `mcpSkillBuilders` + `SkillTool` + `outputStyles/loadOutputStylesDir` | 4 |
| **P18** | Plugins：`PluginInstallationManager` + `pluginOperations` + `bundled` + `pluginCliCommands` + `/plugin` 命令 | 5 |
| **P19** | Task V2 + Cron + Worktree：`Task.ts / tasks.ts` + `tasks/*` 6 个 Task 类型 + `cron*` + `EnterWorktree / ExitWorktree` + 所有 Task/Cron 工具 | 7 |
| **P20** | 思考档位：thinking / effort / fastMode + `/think /nothink /effort /fast` 命令 + `thinkingTokenExtractor` | 4 |
| **P21** | OAuth + 多 provider 凭据：`services/oauth/**` + `codexCredentials` + `geminiCredentials` + `githubModelsCredentials` + `auth.ts / authFileDescriptor / authPortable` | 6 |

### 阶段 D · UX 与周边

| 期 | 标题 | 估工作量 |
|---|---|---:|
| **P22** | Ink 消息 / diff / tool 渲染组件：`components/messages/**` + `StructuredDiff` + `FileEditToolDiff` + `ToolUseLoader` + `Spinner` + `Markdown` | 10 |
| **P23** | 键绑定 / Vim / 历史：`keybindings/**` + `vim/**` + `useVimInput` + `useArrowKeyHistory` + `HistorySearchDialog` | 5 |
| **P24** | 会话生命周期：`sessionStorage / sessionRestore / sessionStart / sessionTitle / conversationArc / conversationRecovery` + `ResumeConversation.tsx` + `MessageSelector.tsx`（rewind 分支） | 6 |
| **P25** | Bridge / Remote / Daemon：`bridge/**` + `remote/**` + `server/directConnectManager` + `grpc/server` + `openclaude --daemon-worker` 类进程管理 | 10 |
| **P26** | SDK 入口：`entrypoints/sdk/**` + `remote/sdkMessageAdapter` + `utils/sdkEventQueue` + structured IO | 4 |
| **P27** | 工具补齐：补齐 `PowerShellTool / REPLTool / NotebookEditTool / WebFetchTool / WebSearchTool / AskUserQuestionTool / BriefTool / ConfigTool / SendMessageTool / SleepTool / SyntheticOutputTool / TodoWriteTool / ToolSearchTool / VerifyPlanExecutionTool / RemoteTriggerTool / WorkflowTool / MonitorTool / SuggestBackgroundPRTool / TungstenTool / TeamCreateTool / TeamDeleteTool` | 12 |

### 阶段 E · 验收 / 打磨

| 期 | 标题 | 估工作量 |
|---|---|---:|
| **P28** | Vitest/Bun 测试同步（OpenClaude 有 ~300 条测试；每期交付时新增测试） | 贯穿各期 |
| **P29** | Golden task parity：从 OpenClaude 的 acceptance suite 搬 20 条跑通 | 3 |
| **P30** | 体积 / 启动时间回归测试（目标 ≤ OpenClaude 的 1.5×） | 2 |

**合计**：约 150 人·日 ≈ **4–6 人月（全职）**。如果团队是 2–3 人并行，
按本文件列出的**硬串行约束**把 P01→P05→P09→P22 作为关键路径。

---

## 施工顺序的硬约束（串行段）

- `P01 → P02 → P03 → P05 → P08 → P09` 必须严格串行。
  理由见 v1 README。
- `P06 → P22 → P23` 串行（Ink → 消息组件 → 键绑定）。
- `P13 → P14 → P17 → P18` 串行（MCP 底层 → hook → skill → plugin）。
- `P16 → P19` 串行（子 agent → task v2 + 协调器）。
- `P07 / P10 / P11 / P15 / P20 / P21 / P24 / P25 / P26 / P27` 各自独立，
  可在串行段的任一稳定点切入。

---

## 不再保留的假设（v1 里我说错了）

| v1 说法 | v2 更正 |
|---|---|
| "yolo 分类器是纯正则" | **错**。OpenClaude 的 `yoloClassifier.ts` 是 **2 阶段 LLM 分类器**（`utils/permissions/yoloClassifier.ts` 1603 行），regex 只是 fallback/bashClassifier。详见 phase-04 修订版。 |
| "`'auto' / 'plan' / 'bypassPermissions'` 已经有" | 部分对。OpenClaude 的 `PermissionMode` 枚举是 `default / acceptEdits / bypassPermissions / dontAsk / plan + ['auto' feature flag] + 'bubble'`（`types/permissions.ts`）。XQoder 把内部 "auto" 扁平化了，需要区分 "auto"（LLM 分类，仅 feature 开时可用）与普通 "default"。 |
| "ink 只是 UI 层 1 个目录" | **错**。OpenClaude 把 Ink 源码**自己 fork 了一份**（`src/ink/**` 47 文件 + 自定义 reconciler），不是依赖 npm 包。XQoder 用依赖形式的 `ink@6` 是合法选择，但不要奢望行为完全一致。 |
| "压缩管线四级就够了" | 不完全。真实层级是 `tool-result-budget → snipCompact → microCompact → cachedMicrocompact → apiMicrocompact → sessionMemoryCompact → autoCompact → contextCollapse`。详见 phase-02 修订版（下次 pass 更新）。 |

---

## 清单

### 总览（先读这三份）

- [00-executive-summary.md](./00-executive-summary.md) · 执行摘要
- [01-architecture-overview.md](./01-architecture-overview.md) · **项目整体逻辑总谱**（重点）
- [02-execution-order-logic-first.md](./02-execution-order-logic-first.md) · 执行顺序（TUI 最后做）

### 已出文档（v1 保留或修订）

- [phase-01-http-retry-fallback.md](./phase-01-http-retry-fallback.md)
- [phase-02-compaction-pipeline.md](./phase-02-compaction-pipeline.md)
- [phase-03-prompt-cache.md](./phase-03-prompt-cache.md)
- [phase-04-permission-modes.md](./phase-04-permission-modes.md)（**需要看 phase-04-addendum**）
- [phase-04-addendum-llm-classifier.md](./phase-04-addendum-llm-classifier.md)（**新 · 关键修正**）
- [phase-05-openai-shim.md](./phase-05-openai-shim.md)
- [phase-06-ink-repl.md](./phase-06-ink-repl.md)

### v2 新增（按下文详细展开）

- [phase-07-provider-routing.md](./phase-07-provider-routing.md)
- [phase-08-codex-shim-and-compress-tools.md](./phase-08-codex-shim-and-compress-tools.md)
- [phase-09-query-loop.md](./phase-09-query-loop.md)
- [phase-10-cli-fastpath-and-feature-flags.md](./phase-10-cli-fastpath-and-feature-flags.md)
- [phase-11-input-preprocessing.md](./phase-11-input-preprocessing.md)
- [phase-12-tool-orchestration.md](./phase-12-tool-orchestration.md)
- [phase-13-mcp-full.md](./phase-13-mcp-full.md)
- [phase-14-lifecycle-hooks.md](./phase-14-lifecycle-hooks.md)
- [phase-15-cost-telemetry.md](./phase-15-cost-telemetry.md)
- [phase-16-agent-tool-and-subagents.md](./phase-16-agent-tool-and-subagents.md)
- [phase-17-skills-and-output-styles.md](./phase-17-skills-and-output-styles.md)
- [phase-18-plugins.md](./phase-18-plugins.md)
- [phase-19-tasks-cron-worktree.md](./phase-19-tasks-cron-worktree.md)
- [phase-20-thinking-effort-fastmode.md](./phase-20-thinking-effort-fastmode.md)
- [phase-21-oauth-and-credentials.md](./phase-21-oauth-and-credentials.md)
- [phase-22-ink-messages-diff-tools.md](./phase-22-ink-messages-diff-tools.md)
- [phase-23-keybindings-vim-history.md](./phase-23-keybindings-vim-history.md)
- [phase-24-session-lifecycle.md](./phase-24-session-lifecycle.md)
- [phase-25-bridge-remote-daemon.md](./phase-25-bridge-remote-daemon.md)
- [phase-26-sdk-entrypoint.md](./phase-26-sdk-entrypoint.md)
- [phase-27-tools-complete-catalog.md](./phase-27-tools-complete-catalog.md)

### 跨期标准

- [conventions.md](./conventions.md) · 所有期共用的接口命名 / 错误策略 / 
  feature flag 注册表 / 测试布局
