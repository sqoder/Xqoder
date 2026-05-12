# 跨期通用规范

以下约定对所有 phase-0X 文档 **默认生效**，无需在每份施工单里重复。

## 1. 命名空间

- 所有新目录一律落在三个 root 之一：
  - `src/infra/llm/**`（HTTP / provider / shim / retry / cache）
  - `src/core/**`（主循环、session、工具、agent、mcp、skill、plugin、cron）
  - `src/platform/terminal/ink/**`（Ink 渲染全部）
- 禁止在 `src/application/chat/**` 之外再新增"业务主路径"文件。
  application 层只做 orchestration，不做 provider / tool 的实现。
- `domain/**` 只允许定义纯类型与纯函数，不允许 `import` infra 层。

## 2. 错误模型

- 全仓新增错误必须继承 `@xqoder/shared::LLMError`（provider 相关）或
  `@xqoder/shared::XqoderError`（非 provider）。
- 错误对象必须带 `kind: string` 字段以便 switch；不允许仅靠 message 判别。
- 新错误类型一经添加必须在 `src/shared/errors/index.ts` barrel 导出。

## 3. Feature flag

- 仿 OpenClaude `bun:bundle::feature()` 的模式，引入轻量 **运行时** 开关：
  - 实现：`src/shared/feature-flags.ts::feature(name: string): boolean`
  - 所有开关只读 `process.env.XQODER_FEATURE_<NAME>`，缺省视 `FEATURE_DEFAULTS` 表。
- **不要**在本项目内实现编译期 DCE（Bun 目前不原生支持），保留运行时判断即可。
- 本路线图用到的 flag 必须在 `FEATURE_DEFAULTS` 注册一次：
  - `HTTP_WITH_RETRY`（默认 true，phase 01）
  - `ADVANCED_COMPACTION`（默认 true，phase 02）
  - `PROMPT_CACHE`（默认 true，Anthropic provider；phase 03）
  - `PERMISSION_MODE_V2`（默认 true，phase 04）
  - `PERMISSION_YOLO_CLASSIFIER`（默认 false，phase 04 addendum）
  - `OPENAI_SHIM`（默认 true，phase 05）
  - `INK_REPL`（默认 true，phase 06）
  - `CODEX_SHIM`（默认 false，phase 08）
  - `COORDINATOR_MODE`（默认 false，phase 16+19）
  - `CRON_TASKS`（默认 false，phase 19）
  - `BRIDGE_MODE`（默认 false，phase 25）
- CLI 里 `xqoder features ls / enable / disable` 直写 `~/.xqoder/features.json`。

## 4. Hook 命名（phase 14 前沿共识）

| 事件 | 何时触发 | payload 必含字段 |
|---|---|---|
| `PreToolUse` | 工具调用前 | `toolName`, `toolInput`, `toolUseId`, `sessionId`, `cwd`, `permissionMode` |
| `PostToolUse` | 工具 **成功** 调用后 | 上面 + `toolResult` |
| `PostToolUseFailure` | 工具 **失败** 后 | 上面 + `toolResult(error)` |
| `UserPromptSubmit` | 用户消息入队之前 | `prompt`, `attachments`, `sessionId`, `cwd` |
| `SessionStart` | `AgentSession.start` 之后 | `sessionId`, `cwd`, `sourceType(resume/new/fork)` |
| `SessionEnd` | session 关闭前最后一刻 | `sessionId`, `usage`, `durationMs`, `stopReason` |
| `Stop` | 主 agent 完成一个 turn | `sessionId`, `stopReason`, `turnId` |
| `SubagentStop` | 子 agent 完成 | `sessionId`, `subagentType`, `stopReason` |
| `PreCompact` | 进入任何压缩函数之前 | `level: 'budget'|'snip'|'micro'|'auto'|'collapse'`, `before: int messages`, `before: int bytes` |
| `PostCompact` | 压缩完成后 | 上面 + `after: int messages`, `after: int bytes` |

统一入口：`src/core/agent/hooks/runLifecycleHook(event, payload)`。
所有 hook 实现保持 **单向，不允许写回 session** —— 只允许读 payload、
产出 `HookDecision = { decision?: 'allow'|'deny'|'ask'; reason?: string; additionalContext?: string }`。

## 5. 类型兼容

- `AgentPermissionMode` 当前字面量不新增、不移除（外部 `.claude/` 生态读这个字段）。
  需要的新 mode（`dontAsk / bubble` 等 OpenClaude 特有）**不引入**，通过
  `PermissionSettings.extras?: Record<string, unknown>` 扩展；本仓只对齐
  用户可见的 5 档。

## 6. 测试布局

- 每期所有新增代码的测试 **必须** 与实现同目录放 `__tests__/`。
- 不强制写 E2E；必须写单元测试与 "集成最小环" 测试。
- 测试必须在 `bun test ./src` 全绿。
- Provider 相关测试用 `mock` 严禁对外部网络有任何调用。

## 7. 兼容回退

- 每期必须提供 `process.env.XQODER_DISABLE_<PHASE>` 的开关，能一键回到本期之前
  的行为。命名见每期文档内"风险与回退"小节。

## 8. Git commit 习惯

- 不合并多期到同一 commit。
- 每期 PR 标题以 `phase-NN:` 开头，描述写 "对齐 OpenClaude 的哪几个源文件"。

## 9. 版本节奏

- 每 2 期合并后更新 `README.md` 的 fidelity 矩阵分数。
- 每 5 期跑一次 `bun run release:check` 全套并用 `docs/release/`
  留存 baseline。
