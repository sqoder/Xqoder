# ADR 0011 — P13b: MCP OAuth 2.1 + McpAuthTool

- **Date**: 2026-05-10
- **Status**: Accepted
- **Phase**: P13b (P13 的子期 b,a/b/c 三段式)

## Context

P13a 交付了 SSE 传输 + elicitation 回调,但 HTTP/SSE client 只能走静态 `config.headers`
注入认证头;遇到 401 没有刷新路径。真实的 MCP 远端(OpenClaude 对标 `services/mcp/auth.ts`
+ `oauthPort.ts`)默认走 OAuth 2.1 Authorization Code + PKCE,token 过期要能无感续签,
否则一次性 token 一过期就必须重跑浏览器流程。

P13b 的目标:把 OAuth 2.1 PKCE 接入 HTTP/SSE client,新增 `mcp_auth` 工具触发授权,
不破坏 `McpClientAdapter` 接口(P13a ADR 里的约束),不影响 stdio 路径。

## Decision

### 1. OAuth 2.1 — Authorization Code + PKCE,**不做** dynamic client registration

- 新增 `src/core/agent/mcp-oauth.ts`(~370 行):
  - `generatePkcePair()` / `generateState()` — SHA-256 challenge + 48B verifier
  - `buildAuthorizeUrl(oauth, { redirectUri, state, codeChallenge })` — 生成授权 URL
  - `startCallbackListener` — Node `http.createServer`,3 端口 fallback
    (默认 `[14500, 14501, 14502]`,测试里传 `[0]` 让 OS 分配)
  - `exchangeAuthCode` / `refreshAccessToken` — 用 `application/x-www-form-urlencoded`
    POST 到 `tokenUrl`,解析 `access_token` / `refresh_token` / `expires_in`
  - `FileMcpTokenStore` — 文件存储在 `~/.xqoder/data/mcp-tokens.json`,
    tmp 写入 → rename 原子性,写入后 `chmod 0o600`
  - `createMcpAuthProvider(server, opts)` — 返回 `{ getAuthHeader, refresh }`,
    自动检查过期(默认 30s skew),过期则自动 refresh,失败则 logger.warn 不抛异常
  - `oauthDisabled(env)` — 检查 `XQODER_MCP_DISABLE_OAUTH=1` 环境变量

- **不做 dynamic client registration**:MCP 规范目前对此支持参差,OpenClaude 也要求
  预注册 `clientId`。`MCPServerConfig.oauth.clientId` 必须在配置文件里给出。
- **不做** refresh token rotation 检测 / JWT validation / well-known endpoint discovery:
  最小够用集,够过 P13c live smoke 即可。

### 2. `MCPServerConfig.oauth` — 顶层字段,不做 sidecar config

在 `src/infra/shared/types.ts` 加 `MCPServerOAuthConfig` 接口:

```ts
interface MCPServerOAuthConfig {
    authorizationUrl: string;  // 必填
    tokenUrl: string;          // 必填
    clientId: string;          // 必填
    clientSecret?: string;     // 公共 client 留空(PKCE 够用)
    scopes?: string[];
    audience?: string;
}
```

`normalizeMCPServerConfig` 在 `config-normalizers-integrations.ts` 里加
`normalizeMcpOAuth`:三个必填缺一则整个 oauth 丢弃(等效"没配 OAuth")。这样配置错误
不会在运行时炸,而是静默回落到"无认证"路径——由下游 401 触发显式失败。

**备选方案**:单独一份 `~/.xqoder/mcp-auth.json` sidecar。否决。理由:
- 多一个文件就多一次同步失败风险
- OpenClaude 的 `services/mcp/config.ts` 也是把 OAuth 和 server 放一起
- 迁移成本高,现在还没用户

### 3. `McpManagerOptions.authProvider?: McpAuthProvider` — 可选注入点

- `McpClientAdapter` 接口零变更(P13a 约束)
- 只在 `McpManagerOptions` 加一个 `authProvider?` 字段
- `McpServerManager.getClient` 兜底:如果调用方没传 `authProvider`,
  自动 `createMcpAuthProvider(server)` 基于 `server.oauth` 配置生成
- `McpHttpClient` / `McpSseClient` 构造时把 `options.authProvider` 存成私有字段,
  每次 `sendRaw` 前调 `getAuthHeader()` 拼 `authorization` 头

### 4. 401 → refresh once → retry,仅此一层

两个 client 都新增 `sendRawWithAuthRetry(payload, alreadyRefreshed)`:

- `alreadyRefreshed=false`:用 `getAuthHeader()` 拿 header(若过期会自动刷新)
- 遇 401 + 有 `authProvider`:cancel body,递归调 `sendRawWithAuthRetry(payload, true)`
- `alreadyRefreshed=true`:强制走 `refresh()`,拿新 header 重试
- 再失败则原样抛 `HTTP 401`(不再递归,防死循环)

SSE client 的 `openStreamOnce`(长连接那条)单独处理 401:刷新一次,不行就抛——
长连接的重试已经被上层 `runStreamLoop` 的 250/500/1000ms 退避包住,不需要再加第三层。

### 5. `McpAuthTool` — 工具入口,调 `runMcpOauth`

- `src/core/agent/tools/mcp-auth-tool.ts`
- 参数:`server: string`(必填),`force?: boolean`(默认 false)
- 默认行为:先用 `createMcpAuthProvider` 看一下已存 token 还有效吗,有效就返回
  "already authorized",不开浏览器
- `force=true` 或 token 不存在:`runMcpOauth(server, { openBrowser, callbackPorts, store })`
- `XQODER_MCP_DISABLE_OAUTH=1` 时直接失败,显式返 error,metadata 带原因
- 审批 risk 设 `medium`(不是 high):浏览器确认 + pre-registered clientId 已经是双重人工
  确认,比 fetch_url 安全

### 6. `openBrowser` 保持注入式

- `runMcpOauth` 的 `openBrowser` 参数是 `(url: string) => void | Promise<void>`
- XQoder 的 TUI / CLI 层负责注入真实的 `open`(或者 `xdg-open` / `start` / `open`)
- 测试里注入 `(url) => fetch(url + '&code=...&state=...')` 模拟回调
- 没有注入 openBrowser 时 `runMcpOauth` 不会自己打开任何东西——只是启动 callback listener
  然后等用户手动访问 URL(很像 `gh auth login --web`)

## Consequences

### 好的

- `McpClientAdapter` 接口零变更,`McpRemoteTool` 等 P13a 工具零修改
- stdio 路径完全不受影响(它根本不读 `options.authProvider`)
- 配置未启用 OAuth 时行为和 P13a 完全一致(`authProvider` 为 undefined 时所有分支短路)
- `XQODER_MCP_DISABLE_OAUTH=1` 是唯一 kill switch:CI / 限制环境可以一行关掉
- `release:check` 全绿(1046 pass / 0 fail,coverage gate PASS,mcp:live-smoke 仍绿)
- 28 条新测试覆盖:PKCE/state 生成、URL 构造、token store + 0600 权限、token exchange、
  refresh、expiry 自动 refresh、mismatched state 拒绝、port fallback、env disable、
  http client 401 refresh、http client 非 401 不刷新、无 authProvider 不注入 header、
  sse client 401 refresh、tool 未知 server / 无 oauth / 已有 token 短路 / 全流程

### 需要在 P13c 处理

- `xqoder mcp auth <name>` CLI 子命令还没接(P13c 施工单明确要做)
- `mcp doctor` 还没扩展到 OAuth 握手 / token 文件权限检查
- `mcp:live-smoke` 还只跑 stdio;真 HTTP/SSE + OAuth 的端到端烟测留给 P13c
- PKCE 的 `code_challenge_method=plain` 回退没做——OAuth 2.1 本来就要求 `S256`,不需要

### 已知小限制(v1 可接受)

- token 文件是 JSON,`schemaVersion` 没加:下次升级字段会破向后兼容。v1 没用户所以 OK
- `expiresAt` 只从 `expires_in` 计算,server 返 `exp` JWT claim 不解析
- refresh token rotation:新 `refresh_token` 会覆盖旧的(见 `tryRefresh`),但老 token
  在硬盘上有短暂窗口(rename 原子性只保证文件本身,不保证 server 端失效)
- `clientSecret` 支持了但测试没 cover confidential client 流程(OpenClaude 主场景是
  public client + PKCE)

## Tests

- `test/core/mcp-oauth.test.ts` — 18 条:PKCE shape + state 唯一性 + URL 构造 +
  FileMcpTokenStore(0600 + remove) + exchangeAuthCode/refreshAccessToken +
  createMcpAuthProvider(undefined cases + cached header + auto-refresh on expiry +
  manual refresh) + runMcpOauth(完整流程 + state mismatch + port fallback +
  disable env) + oauthDisabled helper
- `test/core/mcp-http-client-auth.test.ts` — 4 条:成功不刷新、401 刷新重试、
  503 非 401 不刷新、无 authProvider 不注入 header
- `test/core/mcp-sse-client-auth.test.ts` — 1 条:SSE 401 刷新重试
- `test/core/tools/mcp-auth-tool.test.ts` — 5 条:未知 server、无 oauth、disable env、
  已有 token 短路、全流程

合计 28 条新测试(远超 ≥15 要求)。

## 不确定项 / 后续监控

- `~/.xqoder/data/mcp-tokens.json` 的 0600 权限依赖 Node `fs.writeFile({ mode })` +
  `chmod`。在 NTFS / FAT32 分区(Windows/便携盘)上权限位是假的,但 XQoder 目标平台
  是 macOS/Linux,当前可接受。若有 Windows 支持投诉,改用 DPAPI / keytar。
- `McpAuthProvider.refresh()` 失败只会 `logger.warn`,不会抛异常——调用方需要自己处理
  `getAuthHeader()` 返回 undefined 的情况。已验证 HTTP/SSE client 在这种情况下会让
  服务器返 401 触发第二轮刷新失败,最终抛 `HTTP 401`,语义可接受。
- `redirect_uri=http://127.0.0.1:<ephemeral>/callback` 对某些 OAuth provider(特别是
  strict localhost whitelist 的)会被拒。实际碰上再加 `configurable fixed port`。
