# ADR 0012 — P13c: MCP auth/debug CLI + doctor OAuth enrichment + HTTP/SSE live-smoke

- **Date**: 2026-05-10
- **Status**: Accepted
- **Phase**: P13c (P13 的子期 c, a/b/c 三段式收官)

## Context

P13b 落地了 OAuth 2.1 + PKCE 的底层 primitives (token store, auth provider, 401
refresh, McpAuthTool)。遗留在 P13c 清单上的四件事:

1. `xqoder mcp auth <name>` CLI 子命令 — 现在只有 McpAuthTool 能触发 OAuth,
   运维场景(CI / 登录准备)需要用户直接命令行调用
2. `xqoder mcp debug <name>` CLI 子命令 — 针对单个 server 做深度诊断
   (OAuth 状态 / initialize handshake / listTools 预览)
3. `xqoder mcp doctor` 扩展:把 OAuth token 状态(present / expired /
   refresh token / 文件 0600 权限)附到 doctor 结果里
4. `bun run mcp:live-smoke` 扩展到 HTTP + SSE fixture,不只是 stdio

没有硬红线 / 软红线改动。`tool-orchestrator.ts` / `conversation-engine.ts` /
`events.ts` / `verification-gate.ts` 零触碰。

## Decision

### 1. 新增模块落在 `src/application/integrations/`,不进 `@xqoder/agent`

三个新 TS 文件:

- `mcp-oauth-status.ts` — `collectMcpOAuthStatuses` 纯数据收集器,
  异步 `fs.stat` + `store.load` 合成 `McpOAuthStatus[]`
- `mcp-auth-command.ts` — `runAuthMcpCommand` 封装 `runMcpOauth`,
  `writeOutput` / `json` 双模式,错误抛出不吞
- `mcp-debug-command.ts` — `runDebugMcpCommand` 组合 `createStandaloneMcpClient`
  + OAuth 状态,handshake 失败不抛 (写进 `handshake.status='error'`)

**理由**:这三个是命令/应用层逻辑,不是核心 agent 能力。`@xqoder/agent`
barrel 只新增 `createStandaloneMcpClient` + OAuth primitives 的转发
(P13b 留的尾巴),不增加业务入口。这样 `conversation-engine` / `query-loop`
等主循环模块仍然只看到 agent 层的 pure primitives。

### 2. `runDoctorMcpCommand` 返回类型从 `McpServerInspection[]` 升级为 `McpDoctorEntry[]`

`McpDoctorEntry` = `McpServerInspection & { oauth: McpOAuthStatus }`。保持
superset 语义,现有调用方(`system-compat-command-surfaces.test.ts` +
以后 TUI)零破坏。接到 JSON 里多一个 `oauth` 字段,文本输出多两行
`oauth=... refreshToken=...` + `oauth.tokenFile=...`。

### 3. Token 文件权限探测:`stat.mode & 0o004`

`defaultTokenStorePath()` 复用 P13b 的逻辑,`collectMcpOAuthStatuses`
做一次 `fs.stat`,`mode & 0o777` 格式化为 `0600` / `0644` 等八进制字符串,
`mode & 0o004` 判断 world-readable。**读到才填**(文件不存在时相关字段
留空,让上层知道"还没登录"而不是"登录了但不安全")。

### 4. `mcp:live-smoke` 用 `Bun.serve` 起 in-process HTTP / SSE fixture

不起独立进程,不起 express/fastify。每个 transport 走同一个
`handleFixtureRequest(body)` 路由器,HTTP 返 `Response.json()`,SSE 返
单 frame `ReadableStream`。

**理由**:脚本跑在 `bun run` 下,`Bun.serve` 是原生 API,冷启动 < 10ms,
0 依赖。端口通过 `Bun.serve({ port: 0 })` 分配后 `stop(true)` 释放,
之后在同端口跑真 fixture(`pickFreePort` helper)。没用固定端口,避免
CI 并发冲突。

### 5. 不做 CLI 子命令路由到 `/mcp` 顶层 fast-path

施工单里 P13 列了 `xqoder /mcp add / list / debug / auth` 作为顶层命令,
但项目里 `/<name>` 是 skill 语法,`xqoder mcp ...` 是 subcommand,
两者语义不同。P13c 只接入 `xqoder mcp auth` / `xqoder mcp debug`,
保持和既有 `xqoder mcp list / add / remove / doctor` 一致的 Commander.js
子命令形式。`/mcp` 作为 skill 调用留给 P17 (skill 体系) 自然覆盖。

## Consequences

### 好的

- `release:check` 全绿(1055 pass / 0 fail,coverage gate PASS,
  cli/mcp/security/size-guardrail 全部通过)
- 新增 9 条测试覆盖:auth 短路 / force / disabled / no-oauth + debug ok / error / unknown
  + doctor OAuth enrichment + oauth-status world-readable 探测
- `mcp:live-smoke` 输出从 1 个 transport 扩到 3 个,报告结构变 JSON 数组
- `xqoder mcp doctor --json` 的 JSON 多了 `oauth` 字段,文本输出多两行;
  向后兼容(既有字段全保留)

### 需要在后续处理

- **P17 skill 体系**:`/mcp` 顶层 skill 形式 (和现有 `/plan` / `/autoplan` 一致)
  还没接
- **P14+**:OAuth 登录成功后自动推送到 TUI UI 通知(现在只写日志)
- **P15 cost dashboard**:MCP token 刷新次数 / OAuth 失败率 observability
  (现在只有 logger.warn)

### 已知小限制

- `collectMcpOAuthStatuses` 的 `fs.stat` 失败只在文件不存在(ENOENT)时
  静默;其他 IO 错误会 throw 到调用方。对 doctor / debug 路径可接受,
  因为错误信息会进 `McpOAuthStatus.error` 字段后由上层格式化展示
- `xqoder mcp debug <name>` 的 handshake 仍走 `McpServerManager`
  的同一个 `createStandaloneMcpClient` 路径;初始化失败的 error message
  格式和 doctor 一致。没做 raw JSON-RPC 录制(施工单没要求,P15
  observability 里考虑)
- HTTP/SSE live-smoke 仍只测 2 次 JSON-RPC(initialize + tools/list + tools/call),
  没测 prompts/resources。理由:HTTP/SSE client P13a 已经覆盖了 prompts/resources
  的 cursor 分页单测,live-smoke 只需证明端到端活着即可

## Tests

- `test/application/integrations/mcp-p13c.test.ts` — 9 条:
  - runAuthMcpCommand: 短路 / force / 无 oauth / disabled (4)
  - runDebugMcpCommand: ok / error / unknown server (3)
  - runDoctorMcpCommand: OAuth enrichment + expired (1)
  - collectMcpOAuthStatuses: world-readable 探测 (1)
- `test/commands/system-compat-command-surfaces.test.ts` — 更新 expected
  subcommand list 增加 `auth` / `debug`

mcp:live-smoke 从 1 transport 扩到 3 transport,每个 transport 独立 `checks[]`。

## 不确定项 / 后续监控

- `Bun.serve({ port: 0 })` 在 macOS 上稳定分配端口;Linux CI 如果碰上
  SO_REUSEADDR 抢占问题,`pickFreePort` helper 会变成 flaky。实际碰上再加 retry
- `McpDoctorEntry` 是 `McpServerInspection` 的 structural superset,TypeScript
  compile-time 兼容。但反序列化 JSON 时的 downstream 代码如果做 exact-match
  schema 校验会碰上 `oauth` 这个额外字段。目前没有这种 consumer,有了再说
- HTTP fixture 在 P15 加 OAuth live smoke 时需要扩展成 `/authorize` + `/token`
  回路,和 `runMcpOauth` 串起来。P13c 不做,留给 P15
