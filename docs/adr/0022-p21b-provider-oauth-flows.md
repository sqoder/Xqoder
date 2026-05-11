# 0022 · P21b — Provider-specific OAuth flows + callback server + openBrowser

- Status: Accepted
- Date: 2026-05-11
- Phase: P21b

## Context

P21a 给了 PKCE / device flow / credentials manager / 加密文件存储的纯模块。
P21b 要把这些串成**可登录的 provider 流程**:
- Anthropic Console(PKCE + loopback)
- Codex(PKCE + loopback,保留 account_id metadata)
- GitHub Models(Device Flow,无 callback server)
- Gemini(PKCE + loopback + access_type=offline)

本期仍不写 CLI;P21c 负责 CLI 和 runtime hydrate。

## Decisions

### 1) Client ID 全部来自环境变量

Anthropic / Codex / GitHub / Gemini 的 OAuth client_id 都**不是公开**可以
直接写进代码库的常数。实现方式:
- `XQODER_ANTHROPIC_OAUTH_CLIENT_ID`
- `XQODER_CODEX_OAUTH_CLIENT_ID`
- `XQODER_GITHUB_OAUTH_CLIENT_ID`
- `XQODER_GEMINI_OAUTH_CLIENT_ID`

`resolve*OAuthConfig` 缺值时 throw,CLI 会捕获并给出"请设置 env
XQODER_..."的提示。分发方(Anthropic 官方、用户自建 fork)可以自己注入
client_id,我们不替他们决定。

### 2) `XQODER_ANTHROPIC_OAUTH_BASE` 允许覆盖端点

测试 / 代理 / 企业版 Anthropic 场景下可以把
`https://console.anthropic.com` 换成其它域名:
```bash
export XQODER_ANTHROPIC_OAUTH_BASE=https://auth.my-org.internal
```
会自动组合成 `/oauth/authorize` 和 `/oauth/token`。

### 3) 本地 callback server 只监听 127.0.0.1

`startCallbackServer` 强制 `host='127.0.0.1'`,不接收 `host: 0.0.0.0`。
避免:
- 局域网内其它机器拿到 OAuth code
- 某些 Linux 防火墙策略把 0.0.0.0 当成公网暴露
- Cloud 上的误用导致 code 外泄

路径默认 `/callback`,可覆盖。错误参数(`?error=access_denied`)会让
`done` 以明确 reason reject。

### 4) `openBrowser` 三平台 + 降级

- `darwin` → `open <url>`
- `win32` → `cmd /c start "" <url>`(`&` 转义为 `^&`)
- 其它 → `xdg-open <url>`

spawn 失败(headless / 容器 / 没有 xdg-utils)返回 `false`。调用方看到
`false` 可以降级为"请手动打开以下 URL"。

### 5) Codex refresh 保留 account_id metadata

Codex `/responses` 依赖 `account_id` 做计费归属。
- 初次登录:`parseTokenResponse` 本身不处理自定义字段,所以我们在
  `loginCodex` 的调用方(P21c CLI)会从响应里提取 `account_id` 并存
  到 metadata
- 刷新时:如果服务端新 response **没有** metadata,我们**保留**原 tokens
  的 metadata

本期 `loginCodex` 暂只存标准字段,`account_id` 读取由 CLI 层补(P21c)。

### 6) `refreshForProvider` 作为 CredentialsManager refresh 入口

CredentialsManager 设计为 provider-agnostic,不知道任何具体端点。
P21a 让调用方注入 `refresh: (provider, tokens) => Promise<OAuthTokens>`。
P21b 提供标准实现:

```ts
refresh: (provider, tokens) => refreshForProvider(provider, tokens, process.env)
```

`refreshForProvider` switch 到对应的 `refresh*` 函数,处理 "anthropic"
两种别名(`anthropic-console` 保留兼容),`github-models` 和 `github`
别名,未知 provider 抛错。

## Validation

- `bun run release:check`:**1273 pass / 0 fail**(P21a 1245 → +28),
  coverage **69.70%**(+0.19%),所有 lint + e2e + size + security ✅
- 28 条新测试:
  - `callback-server`(6):成功流 / 错误参数 / 404 / 缺 code / abort /
    任意端口
  - `open-browser`(4):darwin / win32 转义 / linux / spawn 失败
  - `providers`(18):4 个 provider 各自的 resolve + login + refresh,
    state mismatch,metadata 保留,dispatch,unknown error

## 零红线触碰

0 修改文件。全部新增。

## 文件清单

新增:
- `src/shared/auth/callback-server.ts`(~110L)
- `src/shared/auth/open-browser.ts`(~40L)
- `src/shared/auth/providers/anthropic-console.ts`(~110L)
- `src/shared/auth/providers/codex.ts`(~110L)
- `src/shared/auth/providers/gemini.ts`(~110L)
- `src/shared/auth/providers/github-device.ts`(~65L)
- `src/shared/auth/providers/index.ts`(barrel + refreshForProvider)
- `test/shared/auth/callback-server.test.ts`(6 条)
- `test/shared/auth/open-browser.test.ts`(4 条)
- `test/shared/auth/providers.test.ts`(18 条)
- `docs/adr/0022-p21b-provider-oauth-flows.md`(本文)

修改:
- `src/shared/auth/index.ts`(扩充 barrel)

## 不做 / 搁置

- **平台 keychain**(macOS Keychain via `security`,libsecret via
  `secret-tool`,DPAPI via `wincrypt`)→ 可选后续期,EncryptedFileStorage
  已经足够工作
- **`xqoder login|logout|auth status` CLI** → P21c
- **provider-bootstrap.ts hydrate** → P21c
- **withRetry oauth401 refresh 接入** → P21c
- **`xqoder login anthropic --code <code>` 手动模式** → 可以在 P21c 或
  后续期加,原理就是不启动 callback server、直接把手工 paste 的 code
  传给 exchangeCode

## 下一期

P21c:
- `src/commands/auth/login.ts / logout.ts / status.ts`
- `src/application/config/provider-bootstrap.ts`:provider 创建前
  `credentials.ensureFreshTokens(provider)` 注入 `apiKey`
- `src/infra/llm/retry/with-retry.ts` 的 `oauth401` 分支调
  `credentials.ensureFreshTokens`
- e2e:mock stub provider 触发 401 → assert 一次 refresh + 重试
