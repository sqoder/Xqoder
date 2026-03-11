# XQoder

XQoder 是一款终端原生的 AI coding agent。

从 **2026-03-08** 开始，项目主目标切换为：

1. 先对齐 OpenCode 的 `CLI / TUI / Session / Auth / Config / Agents`
2. 再对齐 `stats / export / import / share / undo / redo`
3. 然后补 `serve / web / attach / ACP / IDE`
4. parity 完成后，再把 XQoder 自己的 workflow 能力加回默认体验

当前已经具备、并会继续复用的底层能力：

- `chat`: 持续项目会话，默认自动续接当前项目最近一次 session
- `session`: 查看持久化 session、摘要和历史，兼容 `sessions`
- `stats / export / import / share`: 管理本地 session 资产
- `rollbacks`: 查看和恢复本地回滚点
- `mcp`: 接入外部 MCP server
- `lsp`: 接入内置与外部 Language Server

以下工作流能力会保留，但在 OpenCode parity 完成前降级为增强项：

- `build`
- `fix`
- `run`
- `test`
- `deploy`

详细规格见 `docs/opencode-parity-master-gap.md`。

## Requirements

- Node.js 22+
- pnpm 10+

之所以要求 Node 22+，是因为 XQoder 现在使用 SQLite 持久化 chat session。

## Quick Start

```bash
pnpm install
pnpm build

pnpm xqoder -- config init --provider openai --api-key <your-key>
pnpm xqoder -- auth list
pnpm xqoder -- models list
pnpm xqoder -- agent list
pnpm xqoder -- chat "先看看这个项目"
pnpm xqoder -- session list
pnpm xqoder -- stats
pnpm xqoder -- share list
```

如果你想把本地仓库暴露成命令行入口：

```bash
pnpm link --global
xqoder chat "继续刚才那个会话"
```

## Config System

XQoder 现在不再只读单一 `llm` 配置，而是按以下优先级解析 product config：

1. `~/.xqoder/config.json`
2. `XDG_CONFIG_HOME/xqoder/config.json`
3. 当前项目向上搜索到的 `.xqoder/config.json` 或 `.xqoder.json`
4. `XQODER_CONFIG=<path>` 指定的显式配置

当前 schema 已经支持：

- `providers`
- `defaultAgent`
- `smallModel`
- `agents`
- `instructions`
- `commands`
- `permissions`

查看当前目录下真正生效的配置和来源：

```bash
pnpm xqoder -- config show
pnpm xqoder -- config doctor
```

初始化默认全局配置：

```bash
pnpm xqoder -- config init \
  --provider openai \
  --model gpt-4.1 \
  --small-model gpt-4.1-mini \
  --default-agent general \
  --instruction "reply in Chinese"
```

## Auth And Models

`auth` 和 `models` 现在已经是独立命令面，不再要求用户只通过 `config init` 手工改 provider/model。

认证命令：

- `xqoder auth login <provider> --api-key <key>`
- `xqoder auth logout <provider>`
- `xqoder auth list`

模型命令：

- `xqoder models list`
- `xqoder models list --all`
- `xqoder models use <model>`
- `xqoder models use <model> --provider <provider> --agent <name>`
- `xqoder models use <model> --provider <provider> --small`

示例：

```bash
pnpm xqoder -- auth login openai --api-key <openai-key>
pnpm xqoder -- auth login anthropic --api-key <anthropic-key> --default-model claude-sonnet-4
pnpm xqoder -- auth list

pnpm xqoder -- models list
pnpm xqoder -- models use claude-sonnet-4 --provider anthropic
pnpm xqoder -- models use gpt-4.1-mini --provider openai --small
```

## Agents

Agent 现在已经是 first-class product concept，不再只是内部 helper。

当前内建 agents：

- `general`
- `coder`
- `plan`
- `explore`
- `summary`
- `title`
- `compaction`

CLI 已支持：

- `xqoder agent list`
- `xqoder agent show <name>`
- `xqoder agent use <name>`
- `xqoder agent set <name> ...`
- `xqoder agent enable <name>` / `disable <name>`
- `xqoder agent remove <name>`

示例：

```bash
pnpm xqoder -- agent list
pnpm xqoder -- agent set reviewer \
  --mode subagent \
  --provider anthropic \
  --model claude-sonnet-4 \
  --instruction "focus on bugs"
pnpm xqoder -- agent use coder
pnpm xqoder -- chat --agent coder "先检查一下这个仓库的主调用链"
pnpm xqoder -- explain --agent explore src/index.ts
```

## Chat Sessions

`xqoder chat` 默认会把当前项目目录下的对话持久化到 `~/.xqoder/data/sessions.sqlite`。

- 默认行为：自动续接当前项目最近一次 session
- `--new-session`：强制开启新会话
- `--session <id>`：恢复指定 session
- `xqoder session list`：列出当前项目最近的持久化会话
- `xqoder session show [sessionId]`：查看会话摘要、最近转录、命令历史、文件变更历史
- `xqoder stats`：汇总当前项目或全局的 session 统计
- `xqoder export [sessionId] --out <file>`：导出某个 session 为 JSON 或 Markdown
- `xqoder import <file>`：把导出的 JSON session 重新写回本地 SQLite
- `xqoder share create [sessionId]`：生成本地 share 资产
- `xqoder share list`：列出本地 share 资产
- `xqoder share show <id>`：查看本地 share 的详情和落盘路径
- `xqoder share remove <id> --yes`：删除本地 share 资产
- `xqoder rollbacks list`：查看当前项目最近的回滚点
- `xqoder rollbacks show <id>`：查看回滚点包含的文件快照
- `xqoder rollbacks restore <id>`：人工恢复指定回滚点，默认二次确认
- `xqoder rollbacks restore <id> --yes`：跳过确认直接恢复

示例：

```bash
pnpm xqoder -- chat "分析一下目录结构"
pnpm xqoder -- chat "继续，顺便看下构建链路"
pnpm xqoder -- chat --new-session "重新从零审视这个仓库"
pnpm xqoder -- session list
pnpm xqoder -- stats --all
pnpm xqoder -- export --format markdown --out /tmp/demo-session.md
pnpm xqoder -- import /tmp/demo-session.json --dir .
pnpm xqoder -- share create --format markdown
```

本地 share 资产会保存在 `~/.xqoder/data/shares`。这一阶段的 `share` 还是本机资产管理，不是远程 URL 分享；后续接 `serve/web` 时会在这层之上继续扩展。

## TUI Shell

`xqoder tui` 现在已经是一个常驻的会话壳，不只是命令列表页。

- 直接输入一句话：继续当前活动会话；如果你还没手动恢复过 session，会自动续接当前项目最近的会话
- `/sessions`：在 TUI 内列出当前项目最近的持久化会话，并显示可用于恢复的编号
- `/sessions show <sessionId>`：在 TUI 内查看某个会话的摘要、历史和统计
- `/resume [sessionId|编号]`：切换当前活动会话；省略参数时恢复最近一条，也支持 `/resume 1` 这种按列表编号切换
- `/share`：为当前活动会话创建本地 share；如果还没有活动会话，会退回到最近一条 session
- `/share list`：在 TUI 内列出本地 share 资产
- `/share show <shareId>`：在 TUI 内查看某个 share 的详情
- `/share remove <shareId>`：在 TUI 内删除某个本地 share
- `/mouse terminal|app`：切换鼠标模式；`terminal` 让终端原生负责拖拽复制和滚动，`app` 让 TUI 捕获滚轮做应用内视口滚动
- `Ctrl+L`：从控制台视图返回首页
- `Ctrl+G`：快速切换 `mouse mode`
- `Ctrl+Y`：复制最后一条 AI 回复

这一步仍然是增量 parity：`chat/build/fix/run/test/deploy` 这些执行型命令暂时还走既有 runner，但 `session/share/resume` 已经变成壳内原生动作，不再起子命令。

## Tool Safety

这一阶段已经补上的工具层能力包括：

- `preview_diff`：在真正写文件之前先生成 unified diff 预览
- `apply_patch`：按 patch 精确修改已有文件
- `tool approval`：高风险工具在 TTY 下先确认再执行；非交互环境默认放行，避免 CI 卡死
- `list_files` / `glob_files` / `grep_content`：文件树、glob 查找、内容搜索
- `run_command` 流式输出：命令执行时把 stdout / stderr 直接回传到 CLI
- `rollback point`：`write_file` / `apply_patch` 会自动创建回滚点，`restore_rollback_point` 可恢复历史快照

回滚快照保存在 `~/.xqoder/data/rollbacks`。
如果你需要查看最近工具动作和回滚点 ID，可以运行：

```bash
pnpm xqoder -- session show
pnpm xqoder -- rollbacks list
pnpm xqoder -- rollbacks restore <rollback-id> --yes
```

## LSP Context

当前已经接入两层 LSP context：

- 内置 TypeScript / JavaScript 分析
- 通过 `stdio` / `tcp` 接入外部多语言 Language Server

内置工具包括：

- `lsp_workspace_symbols`：按名称搜索工作区符号
- `lsp_file_diagnostics`：读取文件的 TS/JS 诊断
- `lsp_definition`：按文件位置跳到定义
- `lsp_references`：按文件位置查找引用
- `lsp_hover`：读取位置上的类型、文档和 quick info
- `lsp_completion`：读取当前位置的补全候选，并可选执行 `completionItem/resolve`
- `lsp_rename_symbol`：按符号位置执行 rename，并自动走审批与回滚

这些工具会自动暴露给 agent，所以 `chat / build / fix / explain` 在处理 TS/JS 项目时可以直接利用它们。对于 Python、Go、Rust 之类语言，可以把对应的 LSP server 注册到 XQoder：

- `xqoder lsp add <name> --command <cmd> --extension <ext>`：注册一个 stdio LSP server
- `xqoder lsp add <name> --transport tcp --host 127.0.0.1 --port 7658 --extension <ext>`：注册一个 TCP LSP server
- `xqoder lsp list`：查看当前已配置的 servers
- `xqoder lsp show <name>`：查看单个 server 配置
- `xqoder lsp doctor [name]`：真实启动或连接 server，检查 transport 和核心 LSP 能力
- `xqoder lsp enable <name>` / `disable <name>`：启停单个 server
- `xqoder lsp remove <name>`：删除配置
- `xqoder lsp ui --file <path>`：打开独立的 hover / completion / rename TUI

示例：

```bash
pnpm xqoder -- lsp add pyright \
  --command pyright-langserver \
  --arg --stdio \
  --extension .py \
  --language-id python

pnpm xqoder -- lsp doctor pyright
pnpm xqoder -- chat "检查一下这个 Python 项目的诊断和定义跳转"
pnpm xqoder -- lsp ui --file src/index.ts
```

当前边界：

- 支持 `stdio` 和 `tcp` transport，但还没有做 HTTP transport
- 当前聚焦 `workspace/symbol`、`textDocument/definition`、`textDocument/references`、`textDocument/diagnostic`、`textDocument/hover`、`textDocument/completion`、`completionItem/resolve`、`textDocument/rename`
- 已支持 `workspace/applyEdit`，当前仅覆盖 text edit，不处理 create/rename/delete file 这类资源操作
- 已提供独立 `lsp ui`，但还没有做更深的 `completionItem/resolve` 细粒度选择界面和 hover/completion 的历史面板

## MCP Bridge

现在已经支持通过 `stdio` 接入外部 MCP server，并把远端工具、resources、prompts 一起挂到 agent 的工具集里。

- `xqoder mcp add <name> --command <cmd>`：注册一个 stdio MCP server
- `xqoder mcp list`：查看当前已配置的 servers
- `xqoder mcp show <name>`：查看单个 server 配置
- `xqoder mcp doctor [name]`：真实启动 server，检查握手和工具发现是否成功
- `xqoder mcp enable <name>` / `disable <name>`：启停单个 server
- `xqoder mcp remove <name>`：删除配置

示例：

```bash
pnpm xqoder -- mcp add filesystem --command node --arg ./servers/filesystem.mjs
pnpm xqoder -- mcp doctor filesystem
pnpm xqoder -- chat "用 MCP 工具看看项目外的知识库"
```

当前边界：

- 只支持官方 `stdio` transport
- 已处理 `initialize`、`notifications/initialized`、`tools/list`、`tools/call`
- 已处理 `prompts/list`、`prompts/get`
- 已处理 `resources/list`、`resources/templates/list`、`resources/read`
- 已处理 server 反向请求 `roots/list`
- 已处理 `notifications/tools/list_changed`、`notifications/prompts/list_changed`、`notifications/resources/list_changed`
- 还没有做 HTTP transport，也没有做 resources subscribe / prompts 交互 UI

## Workspace Layout

```text
packages/shared    共享类型、配置、路径约定
packages/agent     LLM provider、tool registry、session store
packages/runtime   项目运行、日志捕获、错误分析、测试执行
packages/workflow  build/fix 等稳定工作流
packages/deploy    部署抽象和 provider
packages/cli       命令行入口和 Ink TUI
```

## Common Commands

```bash
pnpm build
pnpm test
pnpm lint
pnpm release:check

pnpm xqoder -- tui
pnpm xqoder -- chat "解释这个项目"
pnpm xqoder -- session list
pnpm xqoder -- session show
pnpm xqoder -- tui
# TUI 内可直接用: /sessions /sessions show <id> /resume [id|编号] /share /share list
pnpm xqoder -- stats
pnpm xqoder -- export --out /tmp/session.json
pnpm xqoder -- import /tmp/session.json
pnpm xqoder -- share create
pnpm xqoder -- share list
pnpm xqoder -- share show <share-id>
pnpm xqoder -- share remove <share-id> --yes
pnpm xqoder -- rollbacks list
pnpm xqoder -- rollbacks show <rollback-id>
pnpm xqoder -- rollbacks restore <rollback-id>
pnpm xqoder -- rollbacks restore <rollback-id> --yes
pnpm xqoder -- lsp list
pnpm xqoder -- lsp doctor
pnpm xqoder -- mcp list
pnpm xqoder -- mcp doctor
pnpm xqoder -- auth list
pnpm xqoder -- auth login openai --api-key <key>
pnpm xqoder -- models list
pnpm xqoder -- models use claude-sonnet-4 --provider anthropic
pnpm xqoder -- agent list
pnpm xqoder -- agent show coder
pnpm xqoder -- agent use coder
pnpm xqoder -- build "vite + react 博客系统"
pnpm xqoder -- fix
pnpm xqoder -- run
pnpm xqoder -- test
pnpm xqoder -- deploy
pnpm xqoder -- config doctor
```

## Release Discipline

当前版本号以仓库根目录 `package.json` 为准。

- `pnpm version:sync`：把根版本同步到所有 workspace 包
- `pnpm release:check`：执行版本同步、构建、测试、类型检查，作为发版前闸门
- `pnpm link --global`：把当前仓库作为本机可执行的 `xqoder` 使用

## OpenCode Parity Direction

XQoder 当前优先做的是 **OpenCode parity first**，不是继续沿着自有 workflow-first 路线扩张。

当前阶段的开发顺序：

1. 对齐 `CLI / TUI / Session / Auth / Config / Agents`
2. 对齐 `stats / export / import / share / undo / redo`
3. 补 `serve / web / attach / ACP / IDE`
4. parity 完成后，再把 `build / fix / run / test / deploy` 作为差异化能力重新提到前台
