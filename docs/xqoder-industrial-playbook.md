# XQoder 从 0 到工业级项目操作文档

## 1. 文档目的

这份文档不是单纯的使用说明，而是面向维护者、核心开发者和未来插件作者的操作手册。

目标只有一个：

把 XQoder 建设成一个可持续演进的 AI Coding Agent 平台，而不是一个随着功能堆叠越来越难维护的大型单体 CLI。

本文同时基于两部分事实：

1. 你的设计意图已经明确：核心要按 `内核 + Provider 适配层 + 插件层 + 协议层` 来做。
2. 当前 XQoder 仓库已经有了这条路线的雏形，不需要推倒重来，而是要沿现有包结构继续工业化。

---

## 2. 当前代码库现状判断

### 2.1 已经存在的关键分层

当前 monorepo 已经包含这些核心包：

| 层 | 包 | 当前职责 |
| --- | --- | --- |
| 协议层 | `@xqoder/protocol` | 定义 `AppEvent`、`CoreMessage`、JSON 类型等统一内部协议 |
| 权限层 | `@xqoder/permissions` | 抽象权限决策接口和策略 |
| 扩展契约层 | `@xqoder/plugin-sdk` | 定义 `ModelProvider / AgentProvider / ToolProvider / SyncProvider / AuthProvider / Plugin` |
| 运行时内核 | `@xqoder/core-runtime` | 提供 `RuntimeKernel`、事件总线、Provider 注册表、SessionStore 抽象 |
| Agent 能力层 | `@xqoder/agent` | LLM Provider、工具系统、Session、MCP、LSP、OpenClaw、子代理 |
| 工程运行层 | `@xqoder/runtime` | 项目启动、日志捕获、错误分析、测试运行 |
| 工作流层 | `@xqoder/workflow` | `build/fix` 等闭环流程编排 |
| 产品入口层 | `@xqoder/cli` | Commander 命令面、TUI、命令编排 |
| GUI 层 | `@xqoder/gui-electron` | Electron GUI 外壳 |
| 共享基础层 | `@xqoder/shared` | 配置、路径、日志、类型、成本、格式化工具 |

### 2.2 已经做对的地方

下面这些设计已经明显朝工业化方向走了：

1. `@xqoder/protocol` 已经定义统一事件协议，避免 UI、模型、工具、同步层各说各话。
2. `@xqoder/plugin-sdk` 已经把 Provider 和 Plugin 契约抽象出来，方向正确。
3. `@xqoder/core-runtime` 已经有 `RuntimeKernel`，能注册并调度 Model / Agent / Tool / Sync / Auth Provider。
4. TUI 已经通过 `runtime-plugin-loader.ts` 使用 `definePlugin(...)` 加载内建 Agent Provider，说明“内核 + 插件注册”的链路不是空壳。
5. `@xqoder/agent` 已经内置多种 LLM Provider 和工具能力，说明未来扩展不是从零开始。
6. Session 已经有 SQLite 持久化，具备做审计、回放、统计、分享、回滚的基础。

### 2.3 当前离工业级还差什么

当前仓库最关键的差距，不在“有没有功能”，而在“有没有完全切换到平台化运行方式”。

核心差距如下：

1. `packages/cli/src/program.ts` 仍然是硬编码命令注册，产品入口还没有完全插件化。
2. 插件契约已经存在，但外部插件发现、安装、自动加载、版本兼容机制还没有落地。
3. `core-runtime` 的 `SessionStore` 目前偏轻量，TUI 桥接里仍然使用 `InMemorySessionStore`；而持久化 Session 的主实现还在 `@xqoder/agent` 内部，责任边界还不够统一。
4. Provider 已经抽象，但仓库结构仍以“能力都塞进 `agent` 包”为主，还没有形成 `provider-*`、`plugin-*` 的标准扩展布局。
5. CLI、TUI、未来 Web / Electron 之间还没有完全围绕同一套 Runtime API 收敛。
6. CI、发布、审计、指标、故障回放、兼容矩阵这些工业级要求，还没有形成正式操作制度。
7. README 中提到的 `docs/opencode-parity-master-gap.md` 当前仓库里并不存在，说明文档体系还没有跟上代码演进。

结论：

XQoder 现在不是“还没开始设计”，而是“已经有平台雏形，但需要从功能工程转入产品工程”。

---

## 3. 工业级目标定义

### 3.1 产品定位

XQoder 应被定义为：

**终端原生的 AI Coding Agent 平台内核 + 可插拔能力层 + 多入口产品壳。**

而不是：

**一个把聊天、修复、部署、MCP、LSP、工作流全部直接塞进单一 CLI 的应用。**

### 3.2 工业级目标

满足以下条件，才算进入工业级：

1. 新接一个模型或 Agent 系统时，不需要改 Core 代码。
2. 新接一个工具集合时，不需要改 UI 主流程。
3. CLI、TUI、Web、Electron 都围绕统一 Runtime 协议运行。
4. 所有外部系统输入都先转换成内部统一事件协议。
5. 工具执行有权限审批、回滚点、审计日志。
6. 会话能持久化、导出、回放、压缩、共享。
7. 发布有版本校验、构建校验、测试矩阵、回滚方案。
8. 运行时故障可追踪，关键事件可观测。

### 3.3 不可妥协的设计原则

这些原则必须一直成立：

1. Core 不直接依赖 OpenAI、Anthropic、Claude Team、OpenClaw 等具体 SDK。
2. UI 不直接调用 Provider。
3. 模型只负责生成意图，不直接拥有工具执行权。
4. Runtime 决定是否允许执行工具，权限层决定是否放行。
5. 所有外部事件必须先映射到 `AppEvent`。
6. 所有写文件操作必须可回滚。
7. 所有配置必须遵守统一加载优先级。
8. 所有新增能力必须先决定属于 `provider`、`plugin`、`workflow` 还是 `product shell`，不能随手塞进 CLI。

---

## 4. XQoder 当前推荐架构图

```text
User / CLI / TUI / GUI
        |
        v
Application Service / Command Layer
        |
        v
RuntimeKernel (@xqoder/core-runtime)
        |
        +--> Protocol (@xqoder/protocol)
        +--> Permissions (@xqoder/permissions)
        +--> Plugin API (@xqoder/plugin-sdk)
        |
        +--> Agent Providers
        +--> Model Providers
        +--> Tool Providers
        +--> Sync Providers
        +--> Auth Providers
        |
        v
Session / Storage / Logs / Rollbacks / Metrics
```

### 4.1 现阶段推荐的包职责

#### `@xqoder/protocol`

只做统一协议，不做业务逻辑。

建议长期稳定的内容：

1. `AppEvent`
2. `CoreMessage`
3. JSON 类型
4. 事件版本兼容策略
5. 协议演进规则

#### `@xqoder/plugin-sdk`

只做扩展契约，不做具体实现。

建议长期稳定的内容：

1. Provider 接口
2. Plugin 接口
3. 命令注册接口
4. 配置 schema 扩展接口
5. 生命周期 Hook 接口

#### `@xqoder/core-runtime`

这是平台内核，不应该知道“Claude Team 是什么”。

应长期承担：

1. Provider 注册与查找
2. 事件总线
3. RuntimeDescriptor
4. 权限检查
5. Tool 执行调度
6. SessionStore 抽象
7. Runtime Snapshot / Introspection

#### `@xqoder/agent`

建议逐步收敛为“默认官方 Agent 能力实现包”，而不是“所有外部集成都往里堆”的总包。

它适合保留：

1. 官方内建 Agent 实现
2. 官方内建工具
3. 官方内建 LLM Provider 实现
4. Session 管理主实现
5. MCP / LSP 官方桥接

#### `@xqoder/runtime`

负责项目运行、错误捕获、日志归一化、测试执行等工程能力。

#### `@xqoder/workflow`

负责流程编排，不负责 UI，不负责具体 SDK 直接接入。

#### `@xqoder/cli`

应该逐步变成“产品壳 + 命令装配层”，而不是长期承担所有产品逻辑。

---

## 5. 目录规划建议

当前仓库已经是 pnpm workspace，因此不要大改工程组织方式，只需要把未来扩展按命名约定纳入现有结构。

推荐目录规划如下：

```text
Xqoder/
  docs/
  packages/
    protocol/
    permissions/
    plugin-sdk/
    core-runtime/
    shared/
    agent/
    runtime/
    workflow/
    cli/
    gui-electron/
    provider-openai/
    provider-anthropic/
    provider-claude-team/
    provider-openclaw/
    plugin-github/
    plugin-browser/
    plugin-local-index/
    plugin-team-sync/
  apps/
    web-console/
```

说明：

1. 保持 `packages/*` 兼容当前 `pnpm-workspace.yaml`。
2. 新增 Provider 用 `provider-*` 命名。
3. 新增产品插件用 `plugin-*` 命名。
4. 新增独立前端或服务端壳用 `apps/*`。

---

## 6. 从 0 到可运行版本的操作步骤

这一部分是实际操作流程，适用于新开发机、CI 机和新成员入项。

### 6.1 环境准备

最低要求：

1. Node.js `22+`
2. pnpm `10+`
3. Git
4. 可访问目标 LLM Provider 的网络环境
5. 对应 Provider 的 API Key 或 Token

建议额外准备：

1. `uv` 或 Python 运行时，用于后续工具扩展
2. Docker，用于运行隔离和未来沙箱扩展
3. `sqlite3` 命令行工具，便于诊断会话数据库

### 6.2 安装依赖

```bash
cd /Users/wangxinglin/Desktop/Xqoder
pnpm install
pnpm build
```

### 6.3 验证基础构建链路

```bash
pnpm test
pnpm lint
```

如果只是本地快速验证，可先执行：

```bash
pnpm build
pnpm xqoder -- --help
```

### 6.4 初始化配置

XQoder 采用分层配置加载，优先级如下：

1. `~/.xqoder/config.json`
2. `XDG_CONFIG_HOME/xqoder/config.json`
3. 项目目录向上搜索到的 `.xqoder/config.json` 或 `.xqoder.json`
4. `XQODER_CONFIG=<path>` 指定的显式配置

初始化方式：

```bash
pnpm xqoder -- config init \
  --provider openai \
  --model gpt-4.1 \
  --small-model gpt-4.1-mini \
  --default-agent general \
  --instruction "reply in Chinese"
```

检查最终生效配置：

```bash
pnpm xqoder -- config show
pnpm xqoder -- config doctor
```

### 6.5 推荐的全局配置模板

下面是适合当前 XQoder 的一份起步配置：

```json
{
  "theme": "xqoder",
  "llm": {
    "provider": "openai",
    "model": "gpt-4.1",
    "apiKey": ""
  },
  "providers": {
    "openai": {
      "defaultModel": "gpt-4.1",
      "apiKey": ""
    },
    "anthropic": {
      "defaultModel": "claude-sonnet-4"
    }
  },
  "defaultAgent": "general",
  "smallModel": {
    "provider": "openai",
    "model": "gpt-4.1-mini"
  },
  "agents": {
    "general": {
      "mode": "primary"
    },
    "coder": {
      "mode": "primary",
      "instructions": [
        "prefer minimal correct changes"
      ]
    },
    "reviewer": {
      "mode": "subagent",
      "provider": "anthropic",
      "model": "claude-sonnet-4",
      "instructions": [
        "focus on bugs, risks and regressions"
      ],
      "permissionMode": "ask"
    }
  },
  "instructions": [
    "reply in Chinese"
  ],
  "permissions": {
    "defaultMode": "ask",
    "tools": {
      "run_command": "ask",
      "apply_patch": "ask",
      "write_file": "ask"
    }
  },
  "sandbox": {
    "mode": "project",
    "allowedPaths": []
  },
  "mcp": {
    "servers": []
  },
  "lsp": {
    "servers": []
  },
  "share": "manual",
  "autoupdate": true
}
```

原则：

1. API Key 优先走环境变量，不建议长期明文落盘。
2. 默认主模型负责主任务，小模型负责 `plan / summary / title / compaction`。
3. 所有高风险工具默认 `ask`。

### 6.6 配置认证与模型

```bash
pnpm xqoder -- auth login openai --api-key <openai-key>
pnpm xqoder -- auth login anthropic --api-key <anthropic-key> --default-model claude-sonnet-4
pnpm xqoder -- auth list

pnpm xqoder -- models list
pnpm xqoder -- models use claude-sonnet-4 --provider anthropic
pnpm xqoder -- models use gpt-4.1-mini --provider openai --small
```

### 6.7 首次运行产品能力

```bash
pnpm xqoder -- agent list
pnpm xqoder -- chat "先看看这个项目"
pnpm xqoder -- session list
pnpm xqoder -- stats
pnpm xqoder -- share list
```

### 6.8 使用 TUI

```bash
pnpm xqoder -- tui
```

TUI 建议重点验证：

1. 是否能自动续接当前项目最近会话
2. `/sessions` 是否能列出历史
3. `/resume` 是否能切换会话
4. `/share` 是否能生成本地分享资产
5. `Ctrl+Y` 是否能复制最后一条 AI 回复

### 6.9 暴露本地命令

```bash
pnpm link --global
xqoder chat "继续刚才那个会话"
```

---

## 7. 从可运行版本到稳定产品的阶段路线

这一节不是抽象愿景，而是实际落地顺序。

### 7.1 阶段 A：MVP 核心闭环

目标：

让用户完成“配置 -> 对话 -> 工具调用 -> 会话持久化 -> 恢复继续”的最小闭环。

必须完成：

1. `chat`
2. `session list/show`
3. `config init/show/doctor`
4. `auth`
5. `models`
6. TUI 基础收发
7. SQLite Session 持久化
8. 工具审批最小链路

验收标准：

1. 新用户 10 分钟内能从安装到第一次对话
2. 进程退出后会话可恢复
3. 错误时有可读输出，不是直接堆栈崩溃

### 7.2 阶段 B：OpenCode Parity 核心命令面

目标：

把 XQoder 变成真正可替代 OpenCode / OpenClaw 类产品的命令工具。

建议覆盖：

1. `stats`
2. `export / import`
3. `share`
4. `rollbacks`
5. `serve / web / attach / acp`
6. `github`
7. `mcp`
8. `lsp`

验收标准：

1. 会话资产可导出导入
2. 工具修改可回滚
3. 语言服务和外部工具可按项目启用

### 7.3 阶段 C：平台化改造

目标：

把“功能可用”升级为“能力可插拔”。

必须完成：

1. 命令注册从硬编码迁移到 Plugin API
2. Provider 从 `agent` 包内部逐步拆分
3. 形成 `provider-*` 与 `plugin-*` 标准包
4. 提供插件装配和版本兼容机制
5. 定义 Runtime 生命周期 Hook

验收标准：

1. 新增一个 Provider 不需要改 CLI 主入口
2. 新增一个工具包不需要改 TUI 主流程
3. 插件可单独测试、单独发布、单独禁用

### 7.4 阶段 D：工业级运营

目标：

让项目可以长期多人协作、稳定发布、可追踪故障、可扩容。

必须完成：

1. CI/CD
2. 多平台发布
3. 配置迁移
4. 数据库迁移
5. 指标和日志体系
6. 审计和权限追踪
7. 性能与成本监控
8. 安全扫描和依赖治理

验收标准：

1. 每次发布都可重复构建
2. 每次发布都能追踪差异
3. 每次线上问题都能定位到会话、命令、Provider、工具调用

---

## 8. Provider 适配层建设规范

这是你以后接入 Claude Team、OpenClaw、OpenAI、Gemini、Copilot、OpenRouter 的核心规则。

### 8.1 Provider 分类

所有外部能力都必须先归类：

1. `ModelProvider`
2. `AgentProvider`
3. `ToolProvider`
4. `SyncProvider`
5. `AuthProvider`

不要出现“先写一坨集成代码，后面再看算什么”的情况。

### 8.2 Provider 包结构建议

推荐每个 Provider 都独立成包：

```text
packages/
  provider-claude-team/
    src/
      index.ts
      auth.ts
      provider.ts
      mapper.ts
      plugin.ts
      tests/
```

### 8.3 Provider 接入步骤

以接入 `Claude Team` 或 `OpenClaw` 为例，标准流程如下：

1. 明确它属于 Model、Agent、Auth、Sync 中的哪几类。
2. 把对方 SDK 或 HTTP 协议封装在独立包中。
3. 把对方事件统一映射为 `AppEvent`。
4. 把认证过程统一映射为 `AuthSession`。
5. 使用 `definePlugin(...)` 对外暴露注册入口。
6. 通过 RuntimeKernel 注册，不允许 UI 直接实例化底层 SDK。

### 8.4 外部事件归一化规则

外部世界可能有这些差异：

1. 有的返回 `delta`
2. 有的返回 `chunk`
3. 有的返回 `tool_use`
4. 有的返回 `function_call`
5. 有的先流式返回，再最终聚合

在 XQoder 内部，全部统一成：

1. `message.started`
2. `message.delta`
3. `message.completed`
4. `tool.called`
5. `tool.output`
6. `tool.completed`
7. `approval.requested`
8. `approval.resolved`
9. `status.changed`
10. `error`

### 8.5 Provider 实现红线

1. 不允许 Provider 自己直接写 UI。
2. 不允许 Provider 自己决定是否放行高风险工具。
3. 不允许 Provider 自己绕过 Session 体系。
4. 不允许 Provider 直接写项目文件而不经过工具层。

---

## 9. 插件层建设规范

插件层是未来避免“主仓库持续膨胀”的关键。

### 9.1 什么应该做成插件

以下能力优先做成插件：

1. 新模型家族
2. 新团队协作能力
3. GitHub / GitLab / Browser / Search 集成
4. 特定语言工具链
5. 特定行业工作流
6. 通知、同步、分享扩展

### 9.2 插件最小能力

一个标准插件至少允许做这些事：

1. 注册命令
2. 注册 Provider
3. 扩展配置 schema
4. 订阅事件
5. 注入 UI 能力

### 9.3 插件装载策略

建议按三层装载：

1. 内建插件：跟随主程序发布
2. 工作区插件：项目级启用
3. 用户插件：全局安装

### 9.4 工业级插件系统必须补齐的能力

1. 插件清单文件
2. 插件版本范围
3. 插件兼容性校验
4. 插件启用/禁用
5. 插件隔离日志
6. 插件异常熔断
7. 插件权限声明

---

## 10. 协议层建设规范

协议层是整个系统稳定性的底盘。

### 10.1 为什么协议层不能省

如果没有统一内部协议，后果会很快出现：

1. 每个 Provider 都向 UI 暴露不同数据结构
2. TUI 和 CLI 会重复处理底层差异
3. 日志、回放、分享、统计都无法统一
4. 后续接 Web / Electron 会全面返工

### 10.2 当前协议层已经具备的基础

当前 `@xqoder/protocol` 已经定义：

1. `AppEvent`
2. `CoreMessage`
3. `EventEnvelope`
4. `RunStatus`

这意味着方向已经正确。

### 10.3 下一步必须补的协议规则

1. 为 `AppEvent` 增加版本演进说明
2. 明确哪些字段允许 optional，哪些不能变
3. 给工具调用事件增加稳定的 correlation id
4. 给同步事件预留远程来源信息
5. 给日志/审计系统定义可直接落盘的事件格式

### 10.4 协议设计要求

1. 所有事件必须可序列化
2. 所有事件必须具备 `sessionId`
3. 所有关键事件必须带 `timestamp`
4. 所有可审计动作必须带来源 `source`
5. 事件字段尽量稳定，避免频繁 breaking change

---

## 11. 命令层和产品壳的改造路线

### 11.1 当前现状

当前 `@xqoder/cli` 已经提供这些命令：

1. `chat`
2. `config`
3. `auth`
4. `models`
5. `agent`
6. `session / sessions`
7. `stats`
8. `export / import / share`
9. `rollbacks`
10. `build / fix / run / start / test / deploy`
11. `lsp / mcp`
12. `serve / web / attach / acp`
13. `github`
14. `tui`

问题不是命令少，而是命令装配还没有完全插件化。

### 11.2 推荐改造方式

把命令层拆成两部分：

1. Product Shell
2. Command Providers

也就是：

```text
CLI/TUI
  -> Application Service
  -> RuntimeKernel
  -> Registered Commands / Providers / Plugins
```

### 11.3 命令层改造原则

1. Commander 只负责参数解析
2. 命令逻辑尽量下沉到 service 或 plugin
3. 命令之间共享的能力必须复用 RuntimeKernel
4. TUI 和 CLI 尽量共享同一业务服务，而不是各写一套

---

## 12. Session、存储、回滚、审计

工业级系统必须把“聊天记录”升级为“操作资产”。

### 12.1 当前已有资产

XQoder 当前已经具备：

1. SQLite Session 持久化
2. share 资产
3. rollback point
4. export/import
5. stats

这是一条很强的产品线，应该继续强化。

### 12.2 建议长期保存的资产

1. Session 摘要
2. 用户消息
3. 助手消息
4. 工具调用记录
5. 文件修改记录
6. 命令历史
7. 回滚快照
8. Provider 与模型使用统计
9. 审批记录

### 12.3 必须形成的存储边界

建议最终形成两层：

1. `core-runtime` 只依赖 `SessionStore` 抽象
2. `agent` 或独立 `storage-*` 包负责 SQLite / 本地文件具体实现

这样 Core 不会被 SQLite 绑定死，未来换远程同步存储才有空间。

### 12.4 工业级审计要求

以下行为都应可审计：

1. 执行命令
2. 写文件
3. 应用补丁
4. 安装依赖
5. 访问项目外路径
6. 发起网络请求
7. 触发权限审批
8. 用户放行或拒绝

---

## 13. 工具层与权限控制规范

### 13.1 当前正确方向

当前仓库已经有：

1. `preview_diff`
2. `apply_patch`
3. `run_command`
4. `rollback point`
5. `tool approval`

这说明工具链已经具备工业级雏形。

### 13.2 必须坚持的执行链路

正确链路应始终是：

```text
Model/Agent
  -> 生成调用意图
  -> Runtime 判断权限
  -> Tool Provider 执行
  -> EventBus 广播
  -> UI 渲染结果
```

禁止简化成：

```text
UI -> 直接调 Provider SDK -> 直接写文件/执行命令
```

### 13.3 工具分级建议

建议把工具按风险分为三类：

1. 低风险：只读文件、代码搜索、LSP 查询
2. 中风险：改项目内文件、运行测试、启动开发服务
3. 高风险：安装依赖、执行 shell、访问项目外路径、网络写操作

默认策略：

1. 低风险可自动放行
2. 中风险建议项目级授权
3. 高风险必须明确审批并记录

### 13.4 工具层工业级要求

1. 所有写操作先支持 diff 预览
2. 所有写操作自动创建回滚点
3. 所有命令执行保留 stdout/stderr 摘要
4. 所有失败都能回到 session 历史定位

---

## 14. 工作流层建设规范

### 14.1 当前定位

`@xqoder/workflow` 适合承载：

1. `build`
2. `fix`
3. `deploy`
4. 以后更复杂的项目生成和修复闭环

### 14.2 工作流层不要承担的职责

1. 不要直接渲染 UI
2. 不要直接依赖具体 Provider SDK
3. 不要绕过 Runtime 做文件修改

### 14.3 工作流标准结构

建议所有工作流统一具备：

1. 输入定义
2. Step 列表
3. 每步验证
4. 回滚逻辑
5. 最终产物
6. 事件回调

### 14.4 当前工作流的优势

当前 `build-flow.ts` 和 `fix-flow.ts` 已经具备：

1. 分步执行
2. 校验
3. 回滚
4. 结果聚合

这部分不需要推翻，只需要进一步和 Runtime 事件流打通。

---

## 15. 测试、质量与 CI/CD 规范

### 15.1 当前命令

根目录已有：

```bash
pnpm build
pnpm test
pnpm lint
pnpm release:check
```

这是很好的起点。

### 15.2 建议测试矩阵

工业级至少要有四层测试：

1. 单元测试：Provider 映射、协议转换、配置合并、工具参数校验
2. 集成测试：CLI 命令、Session 持久化、LSP/MCP 桥接、Workflow 闭环
3. E2E 测试：TUI 烟测、真实项目修复烟测
4. Real LLM 测试：仅在受控环境启用，验证真实 Provider 兼容性

### 15.3 CI 建议流水线

建议主分支 CI 至少包含：

1. `pnpm install --frozen-lockfile`
2. `pnpm build`
3. `pnpm test`
4. `pnpm lint`
5. `pnpm release:check`

建议额外补：

1. Node 22 / Node 最新 LTS 双版本
2. macOS / Linux 双平台
3. Provider mock 集成测试
4. 文档链接检查

### 15.4 发布前门禁

发布前必须通过：

1. 版本同步校验
2. 构建成功
3. 单元测试成功
4. E2E 烟测成功
5. 关键命令帮助页可用
6. Session 数据库迁移验证

---

## 16. 发布、升级与兼容性策略

### 16.1 版本策略

建议分三层版本：

1. Core Protocol 版本
2. Product 版本
3. Plugin API 版本

这样未来插件兼容性才可控。

### 16.2 升级策略

每次升级都要考虑：

1. 配置结构是否变更
2. SQLite schema 是否变更
3. 插件接口是否变更
4. CLI 命令行为是否变更
5. Session 导入导出格式是否变更

### 16.3 升级原则

1. 配置尽量向后兼容
2. 数据库变更必须走迁移
3. 插件 breaking change 必须提升主版本
4. 用户可见命令改名必须提供迁移期

---

## 17. 可观测性与成本治理

### 17.1 工业级必须观测的指标

1. 每个 Session 的消息数
2. 每次会话的 token 消耗
3. 每个 Provider 的成功率
4. 每个工具的调用次数与失败率
5. 权限审批通过率
6. 回滚恢复次数
7. TUI / CLI 崩溃率

### 17.2 日志分层建议

1. 用户可见日志：简洁、面向任务
2. 调试日志：详细请求链路
3. 审计日志：写操作与审批
4. 性能日志：时延、成本、重试

### 17.3 成本控制建议

建议把模型路由固定下来：

1. `general / coder` 用主模型
2. `plan / summary / title / compaction` 用小模型
3. 复杂修复链路支持按步骤选择模型

长期建议：

1. 为每个 Agent 记录平均 token 成本
2. 为每种工作流记录平均耗时和成功率
3. 对高成本调用增加提示和预算开关

---

## 18. 安全要求

XQoder 的核心风险不只是 API Key，还包括“它有能力改代码、执行命令、访问文件系统”。

### 18.1 最低安全要求

1. API Key 尽量走环境变量
2. 高风险工具默认 `ask`
3. 项目外路径操作必须显式授权
4. 插件必须声明能力范围
5. 网络工具必须可被禁用
6. 会话导出应支持脱敏

### 18.2 需要长期补强的点

1. 插件签名或至少来源校验
2. 机密信息脱敏落盘
3. 团队模式下的权限域隔离
4. 远程同步时的访问控制

---

## 19. 面向当前 XQoder 的立即执行清单

这部分是最重要的行动建议，按优先级排序。

### P0：先补平台骨架

1. 把 CLI 命令注册逐步迁移到 Plugin API，减少 `program.ts` 的硬编码装配。
2. 把“内建能力”整理成官方插件，而不是继续散落在 CLI 内部。
3. 统一 SessionStore 边界，让 `core-runtime` 面向抽象，持久化实现下沉。
4. 给 Plugin 增加发现、装载、启用、禁用和版本兼容能力。

### P1：先补工业级制度

1. 建立 `docs/` 下的正式架构文档、命令文档、发布文档。
2. 把 README 中引用但缺失的文档补齐。
3. 建立 CI 门禁和发布前检查清单。
4. 明确配置迁移和数据库迁移规则。

### P2：再扩展生态

1. 拆分内建 Provider，形成 `provider-*` 标准结构。
2. 增加 `plugin-github`、`plugin-browser`、`plugin-team-sync` 等插件。
3. 接入 `Claude Team`、`OpenClaw` 时，强制通过 Provider + Protocol 进入系统。

---

## 20. 新功能进入仓库前的决策流程

以后每次加功能，先回答下面 5 个问题：

1. 这是产品壳能力，还是平台能力？
2. 它应该属于 Core、Provider、Plugin、Workflow 还是 UI？
3. 它是否需要新的协议事件？
4. 它是否需要新的权限规则？
5. 它是否需要持久化、导出、回滚、审计？

如果这 5 个问题都没想清楚，不要直接写代码。

---

## 21. 从现在到工业级的 30 / 60 / 90 天路线

### 30 天目标

1. 稳定 CLI / TUI / Session / Auth / Config / Agent 主链路
2. 补齐文档体系
3. 固化 CI 门禁
4. 统一命令帮助和配置帮助

### 60 天目标

1. 完成 OpenCode parity 的主命令面
2. 开始 Provider / Plugin 拆包
3. 建立插件加载机制
4. 建立审计日志和指标体系

### 90 天目标

1. CLI / TUI / Electron 共用 Runtime 主链路
2. 外部 Provider 接入标准化
3. 工作流、插件、权限、同步都形成平台化能力
4. 具备稳定发布与升级路径

---

## 22. 工业级验收清单

达到以下条件，说明 XQoder 已经进入工业级阶段：

1. 可以独立新增一个 Provider 包并接入，不改 Core。
2. 可以独立新增一个 Plugin 包并接入，不改 CLI 主流程。
3. CLI、TUI、GUI 使用同一套 Runtime 事件流。
4. 工具写操作都有审批、回滚和审计。
5. Session 可恢复、导出、导入、分享、压缩。
6. 配置加载优先级明确且可诊断。
7. 发布前有自动化门禁。
8. 线上问题可通过日志和 Session 资产回放定位。

---

## 23. 最终结论

基于当前仓库判断，XQoder 最正确的路线不是“继续给 CLI 堆新命令”，而是：

**以现有 `protocol + plugin-sdk + core-runtime` 为平台底盘，继续把 `agent / runtime / workflow / cli / gui` 收敛到统一运行时模型下。**

换句话说：

1. 你现在的方向没有错。
2. 代码已经有工业级平台的前置结构。
3. 真正要做的不是重写，而是继续去耦、补制度、补装配、补可观测性。

如果后续严格按这份文档推进，XQoder 可以从“可用的 AI CLI”演进成“可扩展的工业级 AI Agent 平台”。
