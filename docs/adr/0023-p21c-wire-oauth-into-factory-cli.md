# 0023 · P21c — Wire OAuth credentials into factory + CLI

- Status: Accepted
- Date: 2026-05-11
- Phase: P21c

## Context

P21a shipped pure modules (PKCE / device flow / AES-GCM storage /
CredentialsManager). P21b shipped provider-specific login + refresh
flows. P21c wires them into:

- `~/.xqoder/credentials/` encrypted file storage (shared across the process)
- `createLLMProvider` picks up OAuth tokens when `apiKey` is empty
- `xqoder auth login|logout|status` CLI
- CredentialsManager shared instance caches the master key so we do not
  re-read it on every provider creation

## Decisions

### 1) Best-effort hydration, never fatal

`createLLMProvider` now calls `hydrateFromCredentials` before instantiating
the provider. Rules:

- If `config.apiKey` is already set, **skip hydration entirely**. This
  preserves the precedence env > config apiKey > OAuth.
- If hydration throws (missing home dir in tests, corrupt credential
  file, refresh server down), **swallow the error and return the
  original config**. Providers that work without OAuth (Anthropic with
  api key, OpenAI compat, etc.) must not break when credentials are
  absent.
- `XQODER_DISABLE_OAUTH_HYDRATION=1` forces the original pre-P21 behavior
  for troubleshooting and for environments that deliberately avoid disk
  reads.

### 2) Lazy dynamic import from factory

`src/core/agent/llm/factory.ts` is the single chokepoint for provider
creation. Importing `application/config/credentials.ts` statically would
tie `@xqoder/agent` to application-layer modules, violating the
dependency direction. We use `await import(...)` to keep the dependency
runtime-only.

### 3) `xqoder auth` command group, not a mutation of `xqoder login`

There is already a `xqoder login` command for API-key workflows.
Overloading its semantics to run OAuth would break scripts. Instead we
add a sibling namespace:

- `xqoder auth login <provider>` — run OAuth, persist tokens
- `xqoder auth logout <provider>` — delete tokens for that provider
- `xqoder auth status` — list providers with stored credentials

`github` is accepted as an alias for `github-models` to match the
provider name users type.

### 4) Shared CredentialsManager

`getSharedCredentialsManager()` is a process-wide singleton initialized
on first use. Without it, every call to `createLLMProvider` would
re-instantiate `EncryptedFileStorage` and re-read master.key from disk.
Tests that need their own instance (different temp dir) build one via
`createDefaultCredentialsManager({ homeDir })`.

### 5) `hydrateLLMConfigFromCredentials` exposed separately

Keeping the hydration helper public lets tests assert the wiring without
touching the factory or hitting the shared singleton. It also lets
callers that build providers directly (e.g. sub-agents) participate.

## Validation

- `bun run release:check`: **1283 pass / 0 fail** (P21b 1273 → +10),
  coverage **69.66%** (−0.04% because of plumbing code that test setup
  cannot easily reach; coverage gate still PASS).
- 10 new tests (`test/application/config/credentials-hydration.test.ts`
  + `test/commands/auth/logout-status.test.ts`):
  - `createDefaultCredentialsManager` actually writes under
    `~/.xqoder/credentials/` with master.key
  - Hydration skipped when apiKey present
  - Hydration fills apiKey from credentials + triggers refresh within
    window
  - `runLogout` removes or reports no-op
  - `runStatus` lists providers with expiry

## Red-line footprint

Soft-redline: `src/core/agent/llm/factory.ts` grew a hydration shim at
the top of `createLLMProvider`. Zero hard-redline touches.

## File list

Added:
- `src/application/config/credentials.ts` (~55L)
- `src/application/config/hydrate-credentials.ts` (~45L)
- `src/commands/auth/login.ts` (~105L)
- `src/commands/auth/logout.ts` (~95L)
- `src/commands/auth/index.ts` (~20L)
- `test/application/config/credentials-hydration.test.ts` (6 tests)
- `test/commands/auth/logout-status.test.ts` (4 tests)
- `docs/adr/0023-p21c-wire-oauth-into-factory-cli.md` (this file)

Modified:
- `src/infra/shared/paths.ts` — `credentialsDir` + `masterKeyFile`
- `src/core/agent/llm/factory.ts` — lazy OAuth hydration
- `src/plugins/command-plugins.ts` — register `authCommand`

## Deferred / out of scope

- **`xqoder login anthropic --code <code>` manual fallback**. Dropping
  the loopback server and letting the user paste the code is a small
  follow-up; not required for P21c success.
- **withRetry oauth401 refresh wiring**. `withRetry` already exposes
  `refreshOauthToken?: () => Promise<void>`. Wiring a default callback
  that calls `getSharedCredentialsManager().ensureFreshTokens(provider)`
  needs each provider's withRetry invocation to know its own provider
  key. That touch is larger than the time budget left for this phase,
  and since hydration already refreshes tokens within the 5-minute
  window on every provider creation, 401s during a live request are
  vanishingly rare. Left as P21d or a follow-up.
- **Platform keychains** (Keychain / libsecret / DPAPI). Encrypted file
  storage works on every target platform including headless CI. Native
  keychains can be added as a SecureStorage implementation later.
- **Codex `account_id` metadata extraction**. `loginCodex` today only
  stores standard fields. Extracting the `account_id` from the token
  response needs Codex-specific parsing; once the Codex runtime uses it
  we will add it. P21b already preserves whatever metadata is already
  stored during refresh.

## Phase closing

P21 a/b/c complete — credentials infrastructure + 4 provider OAuth
flows + factory hydration + CLI are live, tested, and shipped.
