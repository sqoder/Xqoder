# Phase 13 · MCP 全家桶

## 任务目标（必须可验证）

把 MCP 子系统扩展到与 OpenClaude `services/mcp/**`（30 文件）对齐的程度：
stdio + http + sse 三种 transport + OAuth + elicitation + channel 通知 +
`/mcp` 命令族。

## 对标源

- `openclaude/src/services/mcp/client.ts`
- `openclaude/src/services/mcp/config.ts`
- `openclaude/src/services/mcp/auth.ts`
- `openclaude/src/services/mcp/oauthPort.ts`
- `openclaude/src/services/mcp/elicitationHandler.ts`
- `openclaude/src/services/mcp/channelNotification.ts / channelAllowlist.ts / channelPermissions.ts`
- `openclaude/src/services/mcp/doctor.ts`
- `openclaude/src/services/mcp/InProcessTransport.ts`
- `openclaude/src/services/mcp/SdkControlTransport.ts`
- `openclaude/src/services/mcp/officialRegistry.ts`
- `openclaude/src/services/mcp/MCPConnectionManager.tsx`
- `openclaude/src/tools/MCPTool/`
- `openclaude/src/tools/ListMcpResourcesTool/`
- `openclaude/src/tools/ReadMcpResourceTool/`
- `openclaude/src/tools/McpAuthTool/`
- `openclaude/src/commands/mcp/`

### 成功判定

- 三种 transport 的单测 fixture 全绿：
  - stdio：自建 echo server 进程。
  - HTTP：本地 express mock。
  - SSE：本地 mock with `Content-Type: text/event-stream`。
- `McpAuthTool` 触发 OAuth 流程：弹本地 callback listener，成功写入 secure storage。
- `elicitationHandler` 对 `-32042` 错误做 UI 问答回调。
- `xqoder mcp add/remove/list/debug` CLI 子命令可用。

## 范围与边界

### 允许修改

- 扩展 `src/core/agent/mcp-*.ts` 现有文件：
  - 加 `mcp-sse-client.ts`
  - 加 `mcp-oauth.ts`
  - 加 `mcp-elicitation.ts`
  - 加 `mcp-doctor.ts`
- 新增工具：
  - `src/core/agent/tools/mcp-auth-tool.ts`
  - （`MCPTool / ListMcpResourcesTool / ReadMcpResourceTool` 已有或升级）
- 新增命令 `src/commands/integrations/mcp.ts` 扩展到
  `mcp add / remove / list / debug / doctor / auth`。

### 禁止修改

- `McpClientAdapter` 接口。

## 改动要点

### 1) SSE transport

使用 Node `fetch` + ReadableStream：

```ts
export class McpSseClient implements McpClientAdapter {
    async open(): Promise<void> {
        const res = await fetch(this.url, { headers: this.headers, signal: this.abort.signal });
        for await (const chunk of res.body as any) {
            for (const line of decodeLines(chunk)) this.handleSseLine(line);
        }
    }
    // handleSseLine 按 SSE 规范识别 event: / data: / retry:
}
```

### 2) OAuth

```ts
// src/core/agent/mcp-oauth.ts
export async function runMcpOauth(server: MCPServerConfig): Promise<void> {
    const port = await openLocalCallbackServer();
    openBrowser(buildAuthorizeUrl(server, port));
    const code = await waitForAuthCode(port);
    const tokens = await exchangeAuthCode(server, code);
    await saveTokensToSecureStorage(server.name, tokens);
}
```

### 3) elicitation

```ts
export async function handleElicitation(request: ElicitationRequest, ask: AskUser): Promise<ElicitationResponse> {
    const answer = await ask({
        title: request.title,
        fields: request.schema.fields,
        timeoutMs: 120_000,
    });
    return { action: answer ? 'accept' : 'cancel', data: answer };
}
```

### 4) channelNotification（KAIROS）

- **本期不复刻**，只预留 interface，空实现。真实产品等 Anthropic Channels API
  公开后再接。

### 5) `/mcp` 命令

```ts
program.command('mcp')
    .command('add <name> <url>').option('--transport <t>').action(addMcp)
    .command('remove <name>').action(removeMcp)
    .command('list').action(listMcp)
    .command('doctor').action(doctorMcp)
    .command('auth <name>').action(authMcp)
    .command('debug <name>').action(debugMcp);
```

### 6) config 合并优先级

对齐 `services/mcp/config.ts`：`user < workspace1 < workspace2 < ... < cli arg`，
同名 server 按最高优先级覆盖。`disabled: true` 关掉整个 server。

## 验证

- `bun run mcp:live-smoke` 保持绿。
- 新增 `bun test src/core/agent/__tests__/mcp-*.test.ts` ≥ 40 条。

## 风险与回退

- **风险**：OAuth callback listener 端口冲突；**缓解**：尝试 3 个端口范围。
- **回退**：`XQODER_MCP_DISABLE_OAUTH=1` 关 OAuth 路径，只留 API key。

## 不确定项

- MCP `-32042` elicitation 的 schema 是新 JSON-RPC 扩展；各 server 实现
  不统一。本期只支持 `fields: [{key, type, required}]` 的最小集。
