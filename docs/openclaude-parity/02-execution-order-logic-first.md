# 执行顺序 · Logic First（TUI 最后做）

> 你的决策：**先把整个项目的逻辑写清楚；TUI 最后做**。
> 本文档把 27 期施工单重排，保证你按本顺序做，到最后一步才接 Ink REPL。

## 重排后的 7 个阶段

| 阶段 | 目的 | 包含 phase | 阶段产出 |
|---|---|---|---|
| **S1** · 地基 | 错误分类 / retry / feature flags | P01 + P10 | 断网自动恢复；features CLI 可用 |
| **S2** · Provider 核心 | 多家 provider 可靠接入 | P07 + P05 + P08 | OpenAI/Codex/dashscope/qwen 全可用；strict schema；thinkTag 剥离 |
| **S3** · 主循环骨架 | 压缩 + 缓存 + 主状态机 | P02 + P03 + P09 | 长对话不爆；prompt cache 命中；queryEngine 接管循环 |
| **S4** · 权限 / 输入 / 工具调度 | autopilot 能力底座 | P04 + P04-addendum + P11 + P12 | 5 档 permission；yolo 分类器；并发工具；autoFix |
| **S5** · 协议与集成 | hook / MCP / telemetry / thinking | P14 + P13 + P15 + P20 + P21 | 10 元 hook；MCP 全家桶；cache 指标；thinking 档位；OAuth |
| **S6** · 生态 / 体验 | skill / plugin / subagent / task / session | P16 + P17 + P18 + P19 + P24 + P25 + P26 + P27 | 子 agent / swarm；插件；cron；resume/rewind；SDK；40+ 工具 |
| **S7** · TUI 收尾（最后做） | Ink 渲染层 | P06 + P22 + P23 | 终端体验对齐 Claude Code |

## 一张图看全顺序

```
S1 ─┬─ P01  HTTP withRetry + 错误分类
    └─ P10  CLI fast-path + feature flags runtime

S2 ─┬─ P07  Provider 选路决策树
    ├─ P05  openaiShim 双向协议
    └─ P08  codexShim + compressToolHistory + thinkTag + toolArg

S3 ─┬─ P02  压缩管线四驾马车 + reactive
    ├─ P03  Anthropic prompt cache 断点
    └─ P09  Query 主循环（queryEngine / loop / tokenBudget / stopHooks）

S4 ─┬─ P04  权限五档（acceptEdits 补齐）
    ├─ P04-addendum  LLM 驱动 yolo 分类器
    ├─ P11  输入预处理（slash / @file / memdir / UserPromptSubmit hook）
    └─ P12  工具调度（partition / 并发批 / autoFix）

S5 ─┬─ P14  生命周期 hook 10 元
    ├─ P13  MCP 全家桶（stdio/http/sse + OAuth + elicitation）
    ├─ P15  成本与遥测归一
    ├─ P20  thinking / effort / fastMode
    └─ P21  OAuth 与多 provider 凭据

S6 ─┬─ P16  AgentTool + 5 built-in subagent + forkSubagent
    ├─ P17  Skills + Output Styles
    ├─ P18  Plugin 生态
    ├─ P19  Task V2 / Cron / Worktree / Coordinator
    ├─ P24  Session 生命周期（resume / rewind / teleport / arc）
    ├─ P25  Bridge / Remote / Daemon
    ├─ P26  SDK 入口（headless / ndjson / structuredIO）
    └─ P27  40+ 工具完整补齐

S7 ─┬─ P06  Ink REPL 骨架
    ├─ P22  Ink 消息 / diff / 工具块组件
    └─ P23  键绑定 / Vim / 历史搜索
```

## 每一阶段的"可验证 DoD"

### S1 · 地基

- `bun test src/infra/llm/retry/__tests__` 全绿。
- `bun dist/index.js --version` < 30ms。
- `xqoder features ls/enable/disable` 可用。
- 模拟 429 + retry-after：自动退避成功。

### S2 · Provider 核心

- dashscope / qwen / deepseek / groq / openrouter / xai 6 家 OpenAI 兼容 provider 跑同一条 `/chat/completions` shim。
- Codex 别名（codexplan / gpt-5.x-codex）走 `/responses`，非流式也可用。
- `bun test src/infra/llm/openai/shim/__tests__` 全绿（≥ 20 条）。
- 长对话里 30 对 tool_use/result 被 `compressToolHistory` 滚动压缩到 6 对 + 1 条 summary。

### S3 · 主循环骨架

- 同 session 5 轮对话：`cacheReadTokens > 0` 从第 2 轮起；命中率 ≥ 70%。
- 200 轮模拟对话 + 随机大 tool_result：全程 messages.length 稳定。
- `provider.PromptTooLongError` → reactive compaction 自动展开。
- `QueryEngine` 完全接管 `conversation-engine.ts` 的循环逻辑；旧 conversation-engine 变薄。

### S4 · 权限 / 输入 / 工具调度

- 5 档 permission 全部分支单测覆盖。
- yolo LLM 分类器：mock provider 覆盖 stage1 safe / stage2 deny / stage2 flip / unavailable / timeout。
- `partitionToolCalls` 按 `concurrencySafe` 正确分批；5 个 read 并发成功。
- autoFixRunner：edit → lint fail → 自动追加 system → 下一轮修复。
- `@file` 展开 / slash 命令 / memdir 扫描 e2e 过。

### S5 · 协议与集成

- 10 种 hook 事件的 3 种 handler（command/http/agent）fixture 全绿。
- MCP stdio/http/sse 三种 transport 接入；`McpAuthTool` OAuth 流程通。
- `NormalizedUsage` 5 家 provider fixture 全绿。
- `/think /effort /fast` 命令落实到请求参数。
- `xqoder login anthropic / codex / github-models / gemini` 可用（受各 provider Client ID 可行性限制）。

### S6 · 生态 / 体验

- 子 agent fork → 并发 3 个 explore 独立回填 tool_result。
- Skill activate 后 allowedTools 临时扩展；deactivate 恢复。
- Plugin install/reload/disable 三态完整。
- `xqoder task create "...": --background` + `xqoder task output <id>` 通。
- Cron 命中触发。
- resume / rewind / export / import 完整。
- Daemon + Bridge + Remote 三件套可选启用（`XQODER_FEATURE_DAEMON=1`）。
- SDK ndjson 双向 I/O 通。
- `getAllBaseTools()` 开启 feature flag 后长度 ≥ 40。

### S7 · TUI 收尾

- Ink REPL 按 `ConversationEventEnvelope` 渲染。
- `XQODER_TUI=classic` 可退到旧 readline。
- 键盘 / Vim / history 组件通。
- `ink-testing-library` snapshot 全绿。

## 为什么这个顺序最合理

**协议稳定 > UI 抢滩**。把 `ConversationEventEnvelope` 打磨到 S6 完成再做 TUI，
避免 UI 组件追着协议改。

**底层依赖硬串**。 retry → shim → 压缩 → cache → queryLoop 这条链一旦错序，后面要
返工。

**autopilot 体验来自 S4**。权限 / 并发 / autoFix 是"感觉像 Claude Code"的真正核心，
比任何 UI 都重要。

**TUI 可插拔**。整条主链 S1–S6 完成后，headless 模式 (S6 里的 P26) 已经能让你
用 `bun dist/index.js -p "..."` 完整跑；TUI 上来只是锦上添花。

## 阶段间的 "灰度锁"

每个阶段都有一个 feature flag 默认开；上一阶段任何回归 → 关 flag 即回退。

| 阶段 | 回退开关 |
|---|---|
| S1 | `XQODER_FEATURE_HTTP_WITH_RETRY=0` |
| S2 | `XQODER_FEATURE_OPENAI_SHIM=0` |
| S3 | `XQODER_FEATURE_ADVANCED_COMPACTION=0` + `XQODER_FEATURE_PROMPT_CACHE=0` + `XQODER_FEATURE_NEW_QUERY_ENGINE=0` |
| S4 | `XQODER_FEATURE_PERMISSION_MODE_V2=0` |
| S5 | `XQODER_DISABLE_HOOKS=1` / `XQODER_MCP_DISABLE_OAUTH=1` |
| S6 | `XQODER_FEATURE_CRON_TASKS=0` / `XQODER_FEATURE_DAEMON=0` |
| S7 | `XQODER_TUI=classic` |

## 最小可用里程碑（不做 TUI 的中途验收点）

- **M1（S1 完）**：`bun dist/index.js chat "hello" --dir .` 在弱网仍能跑完。
- **M2（S2 完）**：把 provider 切 dashscope、qwen、groq、xai、openrouter、deepseek 任一，同一段代码跑通。
- **M3（S3 完）**：跑一次 30 分钟长对话，token / cost 曲线符合 prompt cache 曲线。
- **M4（S4 完）**：跑一次 `xqoder chat` 写代码 + 改文件的自动化任务，中途有 risky shell 被 ask、安全 shell 被 allow、dangerous shell 被 deny。
- **M5（S5 完）**：接入一个真实 MCP server（`filesystem`/`git`），完整跑通 + 成本看板。
- **M6（S6 完）**：`bun dist/index.js -p "foo" --output-format=ndjson | jq .` 跑起来。
- **M7（S7 完）**：终端打开就是 Claude Code 的样子。

---

## 读完本文件后该做什么

1. 确认你同意这个顺序。
2. 打开 `phase-01-http-retry-fallback.md`。
3. 对我说 "开工 phase-01"，我按文档里模块 1 → 模块 5 顺序提交代码。
