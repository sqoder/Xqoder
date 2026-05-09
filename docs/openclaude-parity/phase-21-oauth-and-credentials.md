# Phase 21 · OAuth + 多 provider 凭据管理

## 任务目标（必须可验证）

统一 Anthropic Console OAuth + Codex OAuth + GitHub Models OAuth + Gemini
OAuth + AWS SSO + GCP ADC 的凭据管理；secure storage；自动续期。

## 对标源

- `openclaude/src/services/oauth/**`
- `openclaude/src/utils/auth.ts`
- `openclaude/src/utils/authPortable.ts`
- `openclaude/src/utils/authFileDescriptor.ts`
- `openclaude/src/utils/codexCredentials.ts / codexCredentials.test.ts`
- `openclaude/src/utils/geminiCredentials.ts / geminiAuth.ts`
- `openclaude/src/utils/githubModelsCredentials.ts` (+ .hydrate/.refresh tests)
- `openclaude/src/services/api/codexOAuth.ts / codexOAuthShared.ts`
- `openclaude/src/components/ConsoleOAuthFlow.tsx`
- `openclaude/src/components/useCodexOAuthFlow.ts`
- `openclaude/src/utils/secureStorage/**`
- `openclaude/src/commands/login/ / logout/ / oauth-refresh/`

### 成功判定

- `xqoder login anthropic` 启动 Anthropic Console OAuth（localhost callback）。
- `xqoder login codex` 启动 OpenAI/Codex OAuth。
- `xqoder login github-models` 启动 GitHub Device flow。
- `xqoder login gemini` 启动 Gemini OAuth。
- `xqoder logout <provider>`。
- 凭据写 `~/.xqoder/credentials/<provider>.enc`（AES-GCM + keychain 钥匙
  或本地 master key）。
- Access token 过期前 5 分钟自动刷新。
- `handleOAuth401Error`（phase-01）接入：收到 401 先刷新再重试。

## 范围与边界

### 允许修改

- 新增 `src/core/auth/`：
  - `oauth-client.ts`（通用 PKCE OAuth）
  - `device-flow.ts`（GitHub 走 device flow）
  - `secure-storage.ts`（keychain / file fallback）
  - `credentials-manager.ts`
  - `providers/anthropic-console.ts`
  - `providers/codex.ts`
  - `providers/github-models.ts`
  - `providers/gemini.ts`
- 新增 `src/commands/auth/login.ts / logout.ts`。
- 升级 `src/application/config/provider-bootstrap.ts` 在 provider 创建前
  hydrate credentials。

### 禁止修改

- 现有 `~/.xqoder/credentials/<provider>.key`（纯 apiKey 文件）仍支持
  向后兼容；oauth 凭据以新文件 `<provider>.enc` 共存。

## 改动要点

### 1) PKCE OAuth 骨架

```ts
export async function runPkceOauth(config): Promise<OAuthTokens> {
    const verifier = randomVerifier();
    const challenge = await sha256Base64Url(verifier);
    const { port, done } = await listenForCallback();
    openBrowser(buildAuthorizeUrl(config, challenge, port));
    const code = await done;
    return await exchangeCode(config, code, verifier);
}
```

### 2) Secure storage

```ts
export interface SecureStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}

export function createSecureStorage(): SecureStorage {
    if (platform === 'darwin') return new KeychainStorage();
    if (platform === 'linux') return new SecretServiceStorage(); // libsecret
    if (platform === 'win32') return new DPAPIStorage();
    return new EncryptedFileStorage(); // fallback AES-256-GCM
}
```

### 3) Auto refresh

```ts
export async function ensureFreshTokens(provider: string): Promise<OAuthTokens> {
    const t = await storage.get(provider);
    if (!t) throw new Error('Not logged in');
    if (t.expiresAt - Date.now() > 5 * 60 * 1000) return t;
    const refreshed = await refreshOauth(t);
    await storage.set(provider, refreshed);
    return refreshed;
}
```

### 4) handleOAuth401Error 接入

phase-01 `withRetry` 的 `oauth401` 分支调用：

```ts
deps.refreshOauthToken = async () => {
    await ensureFreshTokens(providerNameFromClient(client));
};
```

### 5) login commands

```
xqoder login anthropic --method=console-oauth
xqoder login codex
xqoder login github-models
xqoder login gemini
xqoder logout anthropic
xqoder auth status
```

## 验证

- Unit：`oauth-client.ts` 流程 mock（开 server、exchange、刷新）。
- e2e：浏览器打不开时 fallback 到 `xqoder login anthropic --code <code>` 手动模式。

## 风险与回退

- **风险**：keychain 在 headless / Docker 环境不可用。
  **缓解**：自动 fallback 到 `EncryptedFileStorage`，master key 存
  `~/.xqoder/master.key`（600 权限）。
- **回退**：继续使用 `<provider>.key` 明文 key 文件。

## 不确定项

- 各 provider 的 OAuth 应用 Client ID：Anthropic Console 需要申请（Ant 内部），
  外部复刻按 "CLI-only" 应用申请。本文档不给 Client ID，落地时自申请。
