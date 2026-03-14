# OpenCode 与 Xqoder serve / attach / ACP 对照

> 用于落实 [xqoder-vs-opencode-roadmap.md](./xqoder-vs-opencode-roadmap.md) 阶段 3：serve 模式、attach 连接远程后端、ACP 协议与行为对齐。

---

## 一、Serve（无头 HTTP 服务）

| 项目 | OpenCode | Xqoder | 状态 |
|------|----------|--------|------|
| 命令 | `opencode serve [--port] [--hostname] [--mdns] [--cors]` | `xqoder serve -p/--port --hostname --mdns --cors` | ✓ 参数对齐 |
| 鉴权 | `OPENCODE_SERVER_PASSWORD`、`OPENCODE_SERVER_USERNAME` | `XQODER_SERVER_PASSWORD`、`XQODER_SERVER_USERNAME` | ✓ |
| 健康检查 | `GET /global/health` → `{ healthy, version }` | `GET /global/health` 同 | ✓ |
| API 文档 | `GET /doc` — OpenAPI 3.1 spec | 已实现 `GET /doc.openapi.json`（OpenAPI 3.1）以及 `GET /doc`（HTML + `Accept: application/json` 协商）；并补齐 health/project/config/provider/find/file/session/message/question 等核心 schema 与 response 文档，session/stream 与 share/file/find 路由已统一 400/401/404/409/500/503 错误响应引用与示例 payload；关键路由补齐 operationId、最小请求示例与 BasicAuth 安全声明 | 🟡（仍可继续细化少量 endpoint schema） |
| Session API | `GET/POST /session`、`GET/POST/DELETE/PATCH /session/:id`、message、prompt_async、command、fork、share、abort 等 | 已实现最小集：`GET/POST /session`、`GET /session/:id`、`GET /session/:id/messages`、`POST /session/:id/message`、`POST /session/:id/message/stream`、`POST /session/:id/question/:requestId/resolve`、`POST /session/:id/stream/:streamId/cancel` | ✓（满足 attach 与基本客户端使用；其余可视需要补） |
| Project / Config / Provider | `/project`、`/config`、`/provider` 等 | 已实现 `GET /project`、`GET /config`、`GET /provider` | ✓（基础能力已对齐） |
| File / Find | `/file`、`/find`、`/find/file`、`/find/symbol` | 已实现 `GET /file`、`GET /find/file`、`GET /find`（文本检索）、`GET /find/symbol`（符号检索） | ✓ |
| Event 流 | `GET /event` — SSE | 已实现 `GET /event` SSE（广播 AppEvent） | ✓ |
| TUI 驱动 | `POST /tui/append-prompt`、`submit-prompt`、`execute-command` 等 | 未实现 | **Gap**（attach 依赖后端具备 TUI 或等价 message API） |

结论：Xqoder serve 当前已从最小会话 API 扩展到 **session + project/config/provider + file/find/symbol + SSE event + OpenAPI 文档** 的可用服务面；与 OpenCode 仍有差距主要在 OpenAPI schema 深度、`find/symbol` 语义索引能力与更深的 TUI 驱动端点。

---

## 二、Attach（TUI 连接远程后端）

| 项目 | OpenCode | Xqoder | 状态 |
|------|----------|--------|------|
| 命令 | `opencode attach [url]`，如 `opencode attach http://10.20.30.40:4096` | `xqoder attach [url]` | ✓ |
| 行为 | TUI 作为客户端，与远程 serve 通信；session、message 走 HTTP API | **已实现**：`xqoder attach` 通过 `RemoteTuiAgentService` 调用 serve 的 `/session`、`/session/:id/messages`、`/session/:id/message/stream`；`question.requested` 时回传 `/session/:id/question/:requestId/resolve`，TUI 仅做 UI，不本地起 agent | ✓ |

实现方式：attach 时解析 url，所有「发消息、拉 session 列表、恢复 session」等请求发往该 base URL（`/session`、`/session/:id/messages`、`/session/:id/message/stream`）。流式协议已加 `seq/cursor/streamId`，attach 端在断线后可用 `streamId+cursor` 续传；出现 `question.requested` 时弹窗后调用 `/session/:id/question/:requestId/resolve` 回传答案；用户取消时调用 `/session/:id/stream/:streamId/cancel`，服务端中断对应 agent loop。

---

## 三、ACP（Agent Client Protocol）

| 项目 | OpenCode | Xqoder | 状态 |
|------|----------|--------|------|
| 命令 | `opencode acp`（stdio，JSON-RPC/nd-JSON） | `xqoder acp --cwd <dir>`（stdio，nd-JSON） | ✓ |
| 协议 | [ACP](https://agentclientprotocol.com/) 标准，Zed/JetBrains/Neovim 等可配 | JSON-RPC 2.0 风格（id, method, params / result / error），nd-JSON 逐行 | ✓ 已对齐 ACP 标准 |
| initialize | 协商 protocolVersion、agentCapabilities | `initialize` → protocolVersion: 1、loadSession、sessionCapabilities.list 等 | ✓ |
| session/new | 创建会话，返回 sessionId | `session/new`（params.cwd）→ 项目下 `.xqoder/data/sessions.sqlite`，与 serve 同路径 | ✓ |
| session/list | 列出会话，支持 cwd/cursor | `session/list`（params.cwd、limit）→ sessions[]（sessionId、cwd、title、updatedAt） | ✓ |
| session/load | 加载会话并回放历史 | `session/load`（sessionId、cwd）→ 流式 session/update（user/agent_message_chunk）→ result: null | ✓ |
| session/prompt | 在会话中发消息，流式 agent 回复 | `session/prompt`（sessionId、content: ContentBlock[]）→ session/update 流 → stopReason | ✓ |
| agents/list | 列出可用 agent | `agents/list` → agents[]（name、description、mode） | ✓ |
| 兼容旧端 | — | 保留 `chat`（无 session 单轮）、`reset`、`ping`、`shutdown`；启动时发 `init` 能力 | ✓ |
| 扩展能力 | permissions、MCP、slash commands 等 | 已实现 `permissions/get|set`、`mcp/list`、`slash/list` | ✓ |

结论：Xqoder 的 `acp` 已实现 **ACP 核心 + 常用扩展面**：initialize、session 创建/列表/加载/发消息、agents/list、permissions、mcp/slash 列表能力，与 serve 共用同一项目目录下的 session 存储。

---

## 四、执行清单（阶段 3）

- [x] 文档化 serve/attach/ACP 与 OpenCode 的对照与差距（本文档）。
- [x] **Serve**：在现有 health/doc 基础上，优先实现 **session 与 message** 的 REST（如 `GET/POST /session`、`POST /session/:id/message`），以便 attach 与 run --attach 复用。
- [x] **Attach**：当 serve 提供 session/message API 后，实现 attach 到远程 URL（TUI 仅调远程 API，不本地起 agent）。
- [x] **ACP**：对照 ACP 标准补齐 method（initialize、session/new、session/list、session/load、session/prompt、agents/list），使 Zed/JetBrains 等可配置 `xqoder acp`。

---

## 五、相关代码路径

- **Serve**：`packages/cli/src/commands/serve.ts`、`packages/cli/src/server/index.ts`（createServer）。
- **Attach**：`packages/cli/src/commands/attach.ts`（调用 `RemoteTuiAgentService`，完整 attach 模式）。
- **ACP**：`packages/cli/src/commands/acp.ts`（nd-JSON、initialize、session/*、agents/list，兼容 chat/reset/ping/shutdown）。
