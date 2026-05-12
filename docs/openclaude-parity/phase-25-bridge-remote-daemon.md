# Phase 25 · Bridge / Remote / Daemon

## 任务目标（必须可验证）

把 OpenClaude 的远程/后台能力三件套移植为 XQoder 的可选扩展：

- **Bridge**：终端与浏览器 / 移动 App 桥接（`bridge/**` 34 文件）。
- **Remote**：`remote/RemoteSessionManager` + WebSocket + session ingress。
- **Daemon**：`openclaude --daemon` 常驻 supervisor + `--daemon-worker` 子进程。

## 对标源（节选）

- `openclaude/src/bridge/bridgeMain.ts / replBridge.ts / sessionRunner.ts / bridgeMessaging.ts / bridgeApi.ts / remoteBridgeCore.ts / replBridgeTransport.ts / bridgePermissionCallbacks.ts / bridgeUI.ts / bridgeConfig.ts / bridgeEnabled.ts / workSecret.ts / trustedDevice.ts / jwtUtils.ts / codeSessionApi.ts / pollConfig.ts / sessionIdCompat.ts`
- `openclaude/src/remote/RemoteSessionManager.ts / SessionsWebSocket.ts / remotePermissionBridge.ts / sdkMessageAdapter.ts`
- `openclaude/src/server/createDirectConnectSession.ts / directConnectManager.ts`
- `openclaude/src/grpc/server.ts`
- `openclaude/src/hooks/useReplBridge.tsx`
- `openclaude/src/commands/bridge/**`
- `openclaude/src/commands/remote-env/** / remote-setup/**`

### 成功判定

- `xqoder daemon start/stop/status` 启动常驻进程，监听 `unix:/tmp/xqoder.sock`。
- `xqoder daemon ps` 列出 daemon 里当前运行的 session。
- `xqoder bridge register` 生成 pairing code + signed JWT。
- 手机 / 浏览器端通过 bridge HTTP server 拉消息流并下发指令。
- `xqoder remote-control / rc` 子命令 attach 远端 session。

## 范围与边界

### 允许修改

- 新增 `src/core/daemon/`:
  - `daemon.ts` (entry)
  - `worker.ts`
  - `supervisor.ts`
  - `ipc.ts` (unix socket RPC)
- 新增 `src/core/bridge/`:
  - `bridge-api.ts`
  - `repl-bridge.ts`
  - `work-secret.ts`
  - `jwt.ts`
  - `pairing.ts`
- 新增 `src/core/remote/`:
  - `session-manager.ts`
  - `sessions-websocket.ts`
  - `permission-bridge.ts`
- 新增 commands：`src/commands/remote/bridge.ts / daemon.ts / remote-control.ts`。

### 禁止修改

- 单进程交互模式（`xqoder chat`）必须继续可用，不强制依赖 daemon。

## 改动要点

### 1) Daemon supervisor

```ts
// src/core/daemon/daemon.ts
export async function runDaemon(args): Promise<void> {
    const server = await createUnixSocketServer('/tmp/xqoder.sock');
    server.on('rpc', handleRpc);
    setupHousekeeping(); // cleanup stale workers every 60s
    process.on('SIGTERM', () => gracefulShutdown(server));
    await untilSIGTERM();
}

async function handleRpc(req: RpcRequest, reply): Promise<void> {
    switch (req.method) {
        case 'spawn': return reply(await spawnWorker(req.params));
        case 'attach': return reply(attachToWorker(req.params));
        case 'ps': return reply(listWorkers());
        // ...
    }
}
```

Worker 用 `child_process.fork` 跑 `src/core/daemon/worker.ts`，独立 session
store 但共享 `~/.xqoder/sessions/*.sqlite`。

### 2) Bridge pairing

```ts
// src/core/bridge/pairing.ts
export async function createPairingCode(): Promise<PairingResult> {
    const code = generateNumericCode(6);
    const jwt = signJwt({ scope: 'bridge', exp: Date.now() + 300_000 }, workSecret);
    storePairingCode(code, jwt);
    return { code, expiresAt: Date.now() + 300_000 };
}
```

Bridge HTTP server（`/api/bridge/pair`）用 pairing code 换 JWT。
后续所有消息带 `Authorization: Bearer <jwt>`。

### 3) Remote session WS

```ts
// src/core/remote/sessions-websocket.ts
export class SessionsWebSocket {
    async open(url, jwt): Promise<void> {
        this.ws = new WebSocket(url, { headers: { Authorization: `Bearer ${jwt}` }});
        this.ws.on('message', this.onMessage);
        this.ws.on('close', () => this.reconnectWithBackoff());
    }
    send(envelope: ConversationEventEnvelope) { this.ws.send(JSON.stringify(envelope)); }
}
```

### 4) permissionBridge

远端审批流程：
- Daemon 端工具调用触发 `permission.request`，
- WS 推到 UI 端，
- UI 用户点击 `allow/deny`，
- WS 回 `permission.resolve`。

## 验证

- Unit：IPC RPC 序列化；JWT 签名；pairing 过期。
- e2e：开两个 bun 进程，一个 `xqoder daemon`，一个 `xqoder attach <session>`
  → 交互成功。

## 风险与回退

- **风险**：Daemon 进程僵尸、socket 残留、端口冲突。
  **缓解**：`DaemonSupervisor` 启动前做 stale socket 探测 + 清理。
- **回退**：`XQODER_FEATURE_DAEMON=0`。所有 daemon/bridge/remote 不可用，
  但单进程模式不变。

## 不确定项

- OpenClaude 的 bridge 深度与 Anthropic console + claude.ai 对接。外部复刻
  只能做"自托管版本"（本文档默认如此）。
