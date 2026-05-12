# ADR 0035 — P25 Bridge / Remote / Daemon

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P25 (S6 · Bridge / Remote / Daemon)
- **Preceding ADR:** ADR 0034 (P24 Session lifecycle)
- **Supersedes:** —

## Context

The 施工单 `phase-25-bridge-remote-daemon.md` specifies three sub-systems:

1. **Daemon** — Unix socket supervisor + worker child processes.
2. **Bridge** — HTTP pairing + JWT for mobile/browser attachment.
3. **Remote** — Session manager + WebSocket client + permission relay.

All three are feature-gated (`DAEMON`, `BRIDGE_MODE`) and must not affect
the single-process interactive mode.

## Decision

### 1. `src/core/daemon/` — Unix socket IPC + supervisor

Four files:

- `ipc.ts` — JSON-lines RPC over Unix domain socket. `createIpcServer` /
  `createIpcClient` / `isDaemonRunning`. No third-party deps; uses
  `node:net`. Each message is a single JSON line terminated by `\n`.
  Responses carry the request `id` for correlation.
- `supervisor.ts` — `spawnWorker` / `listWorkers` / `killWorker` /
  `killAllWorkers` / `pruneStaleWorkers`. Workers are `child_process.fork`
  of `worker.ts`. Module-level `Map<string, WorkerEntry>` tracks live
  workers; `exit` events auto-remove entries.
- `worker.ts` — Minimal worker entry point. Handles `ping` / `shutdown`
  messages; signals readiness via `process.send({ type: 'ready' })`.
- `daemon.ts` — `runDaemon(options)`: starts IPC server, registers RPC
  handlers (`ping`, `spawn`, `ps`, `kill`, `killAll`), sets up 60s prune
  timer (`.unref()`), handles `SIGTERM`/`SIGINT` for graceful shutdown.

TS alias `@xqoder/core-daemon`.

### 2. `src/core/bridge/` — Pairing + JWT + bridge API

Five files:

- `work-secret.ts` — `getWorkSecret()`: lazy-init 32-byte random secret,
  in-memory only (never written to disk).
- `jwt.ts` — Minimal HS256 JWT: `signJwt` / `verifyJwt`. No third-party
  JWT library. `timingSafeEqual` with length guard prevents timing attacks
  and buffer-length panics.
- `pairing.ts` — `createPairingCode()`: 6-digit numeric code + JWT with
  5-min TTL. `redeemPairingCode(code)`: single-use redemption.
  `validateBridgeJwt(token)`: verifies scope + signature.
- `bridge-api.ts` — Minimal HTTP server: `POST /api/bridge/pair` (code →
  JWT) + `GET /api/bridge/status` (JWT auth). Listens on random port by
  default.
- `repl-bridge.ts` — `activateReplBridge(sessionId)`: creates a pairing
  code and stores the bridge state. `isReplBridgeActive()` / `deactivate`.

TS alias `@xqoder/core-bridge`.

### 3. `src/core/remote/` — Session manager + WS client + permission relay

Three files:

- `session-manager.ts` — `registerRemoteSession` / `touchRemoteSession` /
  `unregisterRemoteSession` / `listRemoteSessions` / `pruneIdleSessions`.
  Module-level `Map<string, RemoteSessionEntry>`.
- `sessions-websocket.ts` — `SessionsWebSocket extends EventEmitter`:
  wraps native `WebSocket` (Node 22+), reconnects with exponential backoff
  (cap: `maxReconnectAttempts`). Gracefully degrades if `WebSocket` is not
  available in the runtime.
- `permission-bridge.ts` — `queuePermissionRequest` returns a `Promise<boolean>`.
  `resolvePermissionRequest` resolves the pending promise. Remote clients
  call `listPendingPermissions` to poll, then `resolvePermissionRequest` to
  approve/deny.

TS alias `@xqoder/core-remote`.

### 4. Architecture guardrails

Three new tests in `test/architecture-guardrails.test.ts`:

```ts
it('keeps the core-daemon layer isolated from infrastructure and domain layers', ...)
it('keeps the core-bridge layer isolated from infrastructure and domain layers', ...)
it('keeps the core-remote layer isolated from infrastructure and domain layers', ...)
```

### 5. Daemon CLI handler

`src/cli/handlers/daemon.ts` remains a stub (`createStub`) — the full
`runDaemon` wiring is deferred to a follow-up that wires the feature flag
check and imports `@xqoder/core-daemon`. The core module is fully tested
independently.

## Consequences

### Positive

- Zero new third-party deps (no `ws`, no `jsonwebtoken`).
- All three modules are independently testable without a running daemon.
- Architecture guardrails enforced at the same level as other core layers.
- 28 new tests (IPC 5, bridge 13, remote 10) — all green.
- `release:check` 1666 pass / 0 fail.

### Negative / accepted

- `SessionsWebSocket` requires Node 22+ for native `WebSocket`; older
  runtimes get a graceful error. Acceptable: XQoder targets Bun which has
  native WS.
- Daemon CLI handler is still a stub — full wiring (feature flag check,
  socket path from config) deferred to a follow-up.
- Bridge HTTP server has no TLS — intended for localhost use only (v1).

## Alternatives considered

1. **Use `ws` npm package** — rejected: adds a dep; Node 22+ / Bun have
   native WebSocket.
2. **Use `jsonwebtoken`** — rejected: adds a dep; our HS256 subset is 50
   lines and covers the bridge use case exactly.
3. **gRPC for daemon IPC** — rejected: heavy dep; JSON-lines over Unix
   socket is sufficient for the 5 RPC methods needed.

## Follow-ups

- P26: SDK entrypoint (headless / structuredIO).
- Later: wire `runDaemon` into CLI handler with feature flag check.
- Later: TLS for bridge HTTP server (self-signed cert for LAN use).
- Later: daemon persistence (restart workers on daemon restart).

## Validation

- `bun test test/core/daemon/` — 5 IPC tests pass.
- `bun test test/core/bridge/` — 13 bridge tests pass.
- `bun test test/core/remote/` — 10 remote tests pass.
- `bun test test/architecture-guardrails.test.ts` — 3 new guardrails pass.
- `bun run release:check` — 1666 pass / 0 fail, coverage PASS.
