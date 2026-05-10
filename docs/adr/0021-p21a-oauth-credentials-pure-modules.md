# 0021 · P21a — OAuth + credentials pure modules

- Status: Accepted
- Date: 2026-05-11
- Phase: P21a

## Context

Phase 21 目标:统一多 provider 的 OAuth 登录 + 凭据管理。P21 要做的事
多,按 S5 的拆期习惯继续 a/b/c:

- **P21a(本期)**:PKCE + device flow + 加密文件存储 + credentials
  manager 纯模块 + 单测。零 CLI / provider 相关代码。
- P21b:Anthropic Console / Codex / GitHub device / Gemini 专属流程 +
  本地 callback server + 浏览器打开。
- P21c:`xqoder login|logout|auth status` CLI + `provider-bootstrap`
  hydrate + withRetry oauth401 refresh 接入。

## Decisions

### 1) 模块位置:`src/shared/auth/`

P15a/b/c + P20a 教训:凡是 application、infra、core 都要依赖的 contract +
纯函数,放 `src/shared/`。架构守卫禁止 shared → infra,但 shared 内部
自由组合。

### 2) 零第三方依赖

OAuth 常规做法是引一个 openid-client 或 oauth4webapi。我们:
- PKCE:Node `crypto.randomBytes` + `createHash('sha256').digest('base64url')`
- URL 构造:`URLSearchParams` + `URL`
- HTTP:`globalThis.fetch`(可注入)
- 加密:Node `crypto.createCipheriv('aes-256-gcm')`

理由:OAuth 协议本身简单,第三方库主要解决兼容性问题,我们自己
按单一用户(CLI)场景实现就够,依赖越少越好。

### 3) `parseTokenResponse(payload, now, previousRefresh?)` 保留上次 refresh

refresh token 端点有时候**不**返回新 refresh_token。spec 允许。裸调
`parse` 会丢原 refresh,下次就 401。所以 `refresh` 调用方式:

```ts
const fresh = parseTokenResponse(payload, Date.now(), tokens.refreshToken);
```

直接 `exchangeCode` 不需要这层(初次授权一定返回 refresh_token),接口
保留第三参数给 `refreshAccessToken` 使用。

### 4) `EncryptedFileStorage` 数据布局

```
iv(12)  ‖  authTag(16)  ‖  ciphertext
```

AES-256-GCM。iv 每次写入随机生成。master.key:32 字节 + 0600 权限 +
放 `~/.xqoder/master.key`(默认,可自定义)。

**文件名清洗**:`anthropic/console` → `anthropic_console.enc`。防止
用户输入导致路径穿越。`[^A-Za-z0-9._-]` 都换 `_`。

### 5) `CredentialsManager` 核心:`ensureFreshTokens(provider)`

- 读 → null → 抛 `NotLoggedInError`
- 不在 refresh window(默认 5min)→ 返回原 tokens
- 在 window 且有 refresh_token → 调 refresh callback → 存新 → 返回
- 在 window 但无 refresh_token → 抛 `RefreshNotPossibleError`
- `expiresAt === undefined` → 视为无限期(Bearer without exp),原样返回

refresh callback 是注入的——P21a 不知道任何具体 provider 的 refresh
端点,P21b 的 provider 模块负责注入。

### 6) Device flow 的 `slow_down` 处理

RFC 8628:收到 `slow_down` 时必须**把 interval 加 5s**,不是重置。
测试里有 3 次 sleep 断言 [1000, 6000, 11000] 验证这点(两次 slow_down
叠加 = +10s,第三次才成功)。

### 7) `InMemorySecureStorage` 作为测试 double

P21c wiring 测试不需要真实磁盘 IO,提供 in-memory 作为 `SecureStorage`
的简单实现。和 EncryptedFileStorage 共享相同接口签名。

## Validation

- `bun run release:check`:**1245 pass / 0 fail**(P20b 1203 → +42),
  coverage **69.51%**(+0.15%),所有 lint + e2e + size + security ✅
- 42 条新测试覆盖:PKCE 生成 / URL 组装 / token 端点 POST / refresh /
  device flow 三种分支 / 加密文件 round-trip / master.key 0600 / 文件
  名清洗 / credentials 生命周期 / refresh window 边界

## 零红线触碰

0 修改文件。全部为新增。

## 文件清单

新增:
- `src/shared/auth/types.ts`(33L)
- `src/shared/auth/oauth-client.ts`(~130L)
- `src/shared/auth/device-flow.ts`(~110L)
- `src/shared/auth/secure-storage.ts`(~120L)
- `src/shared/auth/credentials-manager.ts`(~115L)
- `src/shared/auth/index.ts`(barrel)
- `test/shared/auth/oauth-client.test.ts`(13 条)
- `test/shared/auth/device-flow.test.ts`(5 条)
- `test/shared/auth/credentials-manager.test.ts`(13 条)
- `test/shared/auth/secure-storage.test.ts`(11 条)
- `docs/adr/0021-p21a-oauth-credentials-pure-modules.md`(本文)

## 不做 / 搁置

- **平台绑定 keychain**(macOS Keychain / libsecret / DPAPI)→ P21b
  可选实现或 P21c 按需;headless/Docker fallback 到 EncryptedFileStorage
  已经工作
- **本地 callback HTTP server** → P21b
- **provider-specific 授权 URL + token 端点** → P21b
- **`xqoder login|logout`** → P21c

## 下一期

P21b:
- `src/shared/auth/callback-server.ts`:临时 HTTP server 收 `?code=...`
- Provider 模块:
  - `providers/anthropic-console.ts` → PKCE + localhost callback
  - `providers/codex.ts` → PKCE + metadata 里存 `account_id`
  - `providers/github-models.ts` → Device flow
  - `providers/gemini.ts` → PKCE + Google `access_type=offline`
- 每 provider 自带 `refresh` 实现注入到 CredentialsManager
