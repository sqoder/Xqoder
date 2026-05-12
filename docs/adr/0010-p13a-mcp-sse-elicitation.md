# ADR 0010 — P13a: MCP SSE 传输 + Elicitation

- **Date**: 2026-05-10
- **Status**: Accepted
- **Phase**: P13a (P13 的子期 a,拆分为 a/b/c)

## Context

Phase 13 施工单要求把 MCP 子系统扩到 OpenClaude `services/mcp/**` 的水平:
三种 transport(stdio / http / sse)+ OAuth + elicitation + `/mcp` 命令族,
总改动 ~2500-4000 行,一个会话吃不下(CLAUDE.md 的 150k token 铁律)。

于是把 P13 拆成三个子期:

- **P13a(本期)**: 真 SSE 传输 + elicitation 回调 + manager 路由
- **P13b**: OAuth 2.1 + `McpAuthTool`
- **P13c**: `mcp auth`/`debug` CLI + doctor 扩展 + `mcp:live-smoke` 拉到 HTTP/SSE

## Decision

### SSE 传输:per-method POST + 长连接收 server→client

- 新增 `src/core/agent/mcp-sse-client.ts`,实现 `McpClientAdapter`。
- 每一次 JSON-RPC 请求都发一次 `POST`,响应内容类型支持两种:
  - `application/json`:整条响应一次返回;
  - `text/event-stream`:流式返回单个 `data:` 帧(streamable HTTP fallback)。
- 初始化完成后,额外开一条长连接(`POST /` + `Accept: text/event-stream`)
  用于接收 server→client 请求(`roots/list` / `ping` / `elicitation/create`)。
  长连接以 250ms → 500ms → 1000ms 的退避重连 3 次,随后把错误暴露给下一次方法调用。
- 不复用 `McpHttpClient`:SSE 有 server→client 通道 + 流式响应语义,
  强行合并会让两个 client 都难读。保留两份实现,重叠的只是 `collectCursorPages` 等
  小段,按 Karpathy"三次重复再抽象"原则暂不提炼。

### Elicitation:单独的 handler + 可选回调

- 新增 `src/core/agent/mcp-elicitation.ts`,导出:
  - `ElicitationRequest` / `ElicitationResponse` / `ElicitationAsk`(类型)
  - `handleElicitation(request, ask, { timeoutMs })`(实现)
- 规则:`ask` 不传 → cancel;超时 → cancel;返回 null → cancel;
  缺必填字段 → cancel;都通过 → `{ action: 'accept', data }`。
- 默认 120s 超时。最小实现,不支持 OpenClaude 的全部字段(enum / pattern 等);
  P13 施工单明确允许只覆盖 `{ key, type, required }` 最小集。
- 唯一允许扩展的 `McpManagerOptions` 字段:`elicit?: ElicitationAsk`。
  `McpClientAdapter` 接口冻结,不碰。

### 路由:`mcp-server-manager.ts` 分支

`createDefaultMcpClient`:

- `transport === 'sse'` → `new McpSseClient(...)`
- `transport === 'http'` → `new McpHttpClient(...)`(不变)
- 其他 → `new McpStdioClient(...)`(不变)

`McpStdioClient` 增加一条 `elicitation/create` 分支(和 SSE client 对称)。

## Consequences

### 好的

- `McpClientAdapter` 接口零变更,所有已有工具(`McpRemoteTool` 等)零修改。
- `McpHttpClient` 保持纯 JSON POST,现有部署不受影响。
- Server→client `elicitation/create` 走通了;未注入 `elicit` 时默认 cancel,
  不会崩。
- `release:check` 全绿(1018 pass / 0 fail,coverage gate PASS,
  mcp:live-smoke 仍绿)。

### 需要在 P13b/P13c 处理

- 本期不做 OAuth,SSE client 只支持通过 `config.headers` 注入静态认证头;
  真实 OAuth 2.1 流程 + 401 自动刷新 → P13b。
- `mcp:live-smoke` 仍只跑 stdio;HTTP/SSE 真连通烟测 → P13c。
- `mcp doctor` 未扩展 SSE 握手 / auth 检查 → P13c。
- 长连接重连后的"补发挂起请求"语义未实现:若长连接挂掉期间有 server→client
  请求丢失,客户端无感。v1 可接受(只影响通知,不影响 client→server 的 RPC)。
- `McpHttpClient` 与 `McpSseClient` 的重叠(cursor 分页、initialize 握手等)
  未抽公共基类,等 P13b 定型后再评估。

## Tests

- `test/core/mcp-elicitation.test.ts` — 6 条(cancel/accept/timeout/missing required)
- `test/core/mcp-sse-client.test.ts` — 8 条(Bun.serve 模拟 SSE 服务,覆盖
  initialize、tools/list、tools/call、两种响应类型、server ping、
  elicitation 注入 + 未注入、close 后再调用)
- `test/core/mcp-server-manager.test.ts` — 补 2 条路由单测
- 合计 16 条新测试(≥ 15 要求)

## 不确定项 / 后续监控

- SSE 长连接重连 3 次仍失败后,状态是"只读失效"——下一次 RPC 抛错,
  但已缓存的 tools/prompts/resources 仍能读。这个半失效状态是否对上层合适,
  等 P13c 的 `mcp doctor` 覆盖到再验证。
- `readFirstSseFrame` 用 `AbortController.abort()` 提前结束 SSE 流,Bun 的
  `ReadableStream` 在 abort 后 releaseLock 会抛 "body stream has been lock"
  之类的错——用 try/catch 吞掉,功能不受影响但日志略吵。
