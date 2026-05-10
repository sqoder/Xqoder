# Periodic Audit 3 — P01 → P11 基线复核

- 执行日期: 2026-05-10
- 范围: 仓库整体(454 TS 文件),重点 `src/**`
- 执行方式: 三个只读 subagent 并行(`architect` / `security-reviewer` / `silent-failure-hunter`),主会话仅汇总
- 前序审查: 无(本次为首轮)
- 触发点: P01 → P11 完成,累计 10 期。按 CLAUDE.md 每 3 期触发。

---

## 0. 执行摘要

本轮审查在**架构**、**安全**、**错误处理**三个维度各暴露出至少一条必须在 P12 之前处理的问题。按严重度合并:

| # | 维度 | 文件 | 问题 | 严重度 |
|---|---|---|---|---|
| 1 | 安全 | `src/core/agent/tools/fetch-tool.ts` | `fetch_url` 完全无 SSRF 防护,`169.254.169.254` / 内网 / loopback 全部可达 | **critical** |
| 2 | 架构 | `src/domain/conversation/events.ts` vs `src/infra/protocol/events.ts` | 硬红线文件存在,但 `ConversationEventEnvelope(schemaVersion:1)` 真正实现在 infra;domain 里是另一套 `ConversationEvent`,双形状并存 | **critical** |
| 3 | 架构 | `src/infra/**` vs `src/infrastructure/**` | 两个 infra root 共存,7 个调用点仍依赖 legacy,有并行 `llm/` 子树 | **critical** |
| 4 | 安全 | `src/core/agent/mcp-stdio-client.ts:230` + `hook-handler-execution.ts:263` | MCP stdio server / 命令型 hook 继承**全量** `process.env`,所有 LLM key / GitHub token 外泄 | **high** |
| 5 | 错误 | `src/core/agent/agent.ts:337` | `void this.run(...)` 无 `.catch`,agent 启动后任意失败静默丢弃 | **high** |
| 6 | 错误 | `src/application/chat/turn-intake/prompt-hook-bridge.ts:77` | 抛错的 hook 被 `continue` 静默跳过,一个 deny hook 抛错就降级成 allow | **high** |
| 7 | 错误 | `src/infra/shared/event-bus.ts:40,56` | EventBus 的 `emit` / `emitAsync` 空 catch,订阅者异常一律静默 | **high** |
| 8 | 错误 | `src/application/chat/compaction-pipeline.ts:73` | 自动压缩失败只 log,turn 继续跑超窗 context | **high** |

建议:在 P12(工具调度)开工前完成 1、2、3、4 四条;5、6、7、8 可并入 P12 前的 hotfix phase(建议标号 P11.1)。

---

## 1. 架构审查(architect subagent)

### 1.1 分层违规
- **[high]** `src/domain/conversation/transcript-projector.ts:8` —— domain 引入 workspace 包 `@xqoder/protocol`,破坏 "domain 纯" 规则 → 内联协议形状或迁出 domain。
- **[high]** `src/domain/permissions/tool-policy.ts:4`、`permission-gate.ts:6`、`permission-mode-helpers.ts:1`、`classifier/llm-classifier.ts:1`、`classifier/decide.ts:1`、`conversation/tool-execution-port.ts:5` —— domain 引入 `@xqoder/foundation-shared` / `@xqoder/shared`。workspace 包仍算外部依赖 → vendor 或本地重声明。
- **[medium]** `src/domain/permissions/filesystem-scope.ts:1-3`、`sensitive-paths.ts:1` —— domain 用 `node:fs` / `node:os` / `node:path` → fs-touching 部分迁 `src/infra/permissions/`,纯 path 字符串工具留 domain。
- **[medium]** `src/platform/terminal/app/agent-runtime.ts:22` —— platform 直接引 `../../../infrastructure/agent/index.js`;platform 未在官方层级链内,且耦合 legacy → 走 application / core port。
- interfaces → infra: 干净。

### 1.2 命名空间违规
规则:新目录只能落在 `src/infra/llm/**`、`src/core/**`、`src/platform/terminal/ink/**`。

- **[high]** `src/commands/` —— P10 扩展了 40+ 文件的新顶层目录(`core/`、`integrations/`、`sessions/`、`system/`、`tools/`、`workflows/`、`remote/`)。要么合并进已有 `src/cli/handlers/`,要么写 ADR 将 `commands` 正式纳入 conventions。
- **[high]** `src/features/` —— `deploy/`、`runtime/`、`sessions/`、`eval/`,不在允许列表 → 合并到 `src/application/<slice>/` 或 `src/core/<slice>/`。
- **[medium]** `src/plugins/` —— 三个文件应下沉到 `src/infra/plugin-sdk/`(已存在)或 `src/core/runtime/plugins/`。
- **[medium]** `src/ux/tool-approval.ts` —— 单文件顶层目录 → 归入 `src/interfaces/tui/` 或 `src/application/chat/`。
- **[medium]** `src/platform/server/`、`src/platform/terminal/app/` —— 规则只允许 `src/platform/terminal/ink/**` → 重命名 `app → ink` 或写 ADR。

### 1.3 禁止文件模式
- **[high]** `src/core/agent/lsp-manager.ts` → 改名(`lsp-session.ts` / `lsp-client.ts`)。
- **[high]** `src/core/agent/mcp-server-manager.ts` → 改名 `mcp-server-pool.ts` 或函数化。
- **[medium]** `src/core/agent/mvp/recovery-manager.ts` → 改名 `recovery.ts`。
- `*-factory.ts`: 无。干净。

### 1.4 软红线 churn 与 ADR 覆盖
当前 ADR: 0001 (P02), 0002 (P04), 0003 (P05), 0004 (P08), 0005 (P09), 0006 (P10), 0007 (P11)。

- **[high]** `src/application/chat/conversation-engine.ts` 在 commit `5223846`("consolidate conversation engine runtime and harden permissions", 2026-05-09)有改动但**无 ADR**。
- **[high]** `src/application/chat/tool-orchestrator.ts` 在 `5223846` / `d79001c` / `368581f` 累计 3 次改动无 ADR。
- **[high]** `src/application/chat/permission-gate.ts` 在 `5223846` 里有权限硬化改动;ADR 0002 只覆盖 P04 初版,后续 `full_auto` / `dangerous_full_access` / sandbox-gate 未入档。

**行动**:补写 **ADR 0008 — P01/P02 consolidate & permission hardening**,覆盖上述三次 commit。

### 1.5 Event envelope drift
- **[critical]** 硬红线文件 `src/domain/conversation/events.ts` **不含** `ConversationEventEnvelope`,也**不带** `schemaVersion`;它定义的是第二套联合类型 `ConversationEvent(sessionId/timestamp/type/...)`。真正的 `ConversationEventEnvelope(schemaVersion: 1)` 住在 `src/infra/protocol/events.ts:251,286,495`。**两套并存**,新 caller 随机挑一套 —— 这正是红线机制想防的漂移。
  - 行动:二选一 —— (a) 将 domain 升为权威(把 envelope 搬回 domain,infra 仅转发);或 (b) 删除 domain 版本、全部指向 `@xqoder/protocol` / `src/infra/protocol/events.ts`。任一都必须经 ADR,且硬红线触发 CLAUDE.md 的 "停下问用户" 条款 —— **此条需用户决策**。
- **[medium]** `src/features/sessions/assets-types.ts:42` + `assets-export-import.ts` 使用 `schemaVersion: 1` 于一份不同 artifact(session asset export)。字面值合法但同名不同语义 → 考虑重命名 `assetSchemaVersion` 或 README 声明双用途。

### 1.6 重复 / 竞争抽象(最高价值检查)
- **[critical]** `src/infra/**`(新:`llm/permissions/plugin-sdk/protocol/shared/storage/`) 与 `src/infrastructure/**`(legacy:`agent/deploy/llm/lsp/mcp/notifications/plugins/remote-exec/search/shell/storage/`)**并存**。7 个调用点仍 import legacy:
  - `src/cli/root-shell.ts:5`
  - `src/commands/core/chat.ts:11`
  - `src/commands/workflows/unified-entry.ts:13`
  - `src/commands/workflows/team.ts:5`
  - `src/commands/workflows/run.ts:14`
  - `src/commands/remote/serve.ts:26`
  - `src/platform/terminal/app/agent-runtime.ts:22`

  两侧都有 `llm/` 子树 → 恰是 "两个 HTTP client" 失败模式。**行动**:ADR 0009 规划 legacy → new 迁移,按 subtree 分批删除。必须在 P12 之前至少完成方向决策,否则 tool orchestration 会 fork 一份。

- **[high]** 权限表面重叠:
  - `src/domain/permissions/permission-gate.ts` (rule engine, 176 行)
  - `src/application/chat/permission-gate.ts` (turn wiring, 85 行)
  - `src/commands/system/permissions.ts` + `src/application/system/permissions.ts`(command 表层)
  - `src/application/permissions/approval-flow.ts`(flow)
  - `src/infra/permissions/classifier-provider.ts` + `policy.ts`
  - `src/shared/types/permissions.ts` + `@xqoder/foundation-shared/types/permissions`

  两层同名 `permission-gate.ts` 易 import 错 → application 侧改名 `turn-permission-gate.ts`;commands 下的两份权限面板合并。

- **[medium]** Registry 有两套:`src/core/runtime/registry.ts` 的 `NamedRegistry<T>` 与 `src/core/agent/tools/tool.ts:211` 的 `ToolRegistry` class → 让 `ToolRegistry` wrap `NamedRegistry` 或删一个。
- **[medium]** LSP 拆在 `src/core/agent/lsp-manager.ts` 与 `src/infrastructure/lsp/index.ts` → 一次性迁到 `src/infra/lsp/` 或 `src/core/lsp/`。
- **[low]** Session store 目前只 `src/infrastructure/storage/chat-session-store.ts` 活跃,但 `src/infra/storage/` 已存在空壳 → 趁未 fork 先迁移。

### 1.7 Bun 违规
无。无 `require(`、`__dirname`、`__filename`、`process.nextTick`、Node-only stream。domain 里的 `node:*` import 属于分层问题(已记),非 Bun 兼容性。

---

## 2. 安全审查(security-reviewer subagent)

风险级别:**HIGH**。1 critical SSRF + 1 高爆炸半径的 env 泄漏。

### 2.1 Secret exposure
- **[high]** `src/core/agent/mcp-stdio-client.ts:230-237` —— `env: { ...process.env, ...(this.config.env ?? {}) }` 将**全量**父进程 env(含 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GITHUB_TOKEN` / `XQODER_LLM_API_KEY` / `DASHSCOPE_API_KEY` / `AWS_*`)发给每个 MCP stdio server。stdio server 默认 `trust=trusted`(`mcp-utils.ts:186-188`),用户永远不会被询问。**缓解**:复用 `createSandboxedCommandEnv` 的 `isSensitiveEnvKey` 过滤,且要求用户按 server 显式声明透传的 env 名。
- **[high]** `src/core/agent/hook-handler-execution.ts:263-275` —— `createHookEnvironment` 同样全量透传。用户配的 command hook 也继承全部 secret。同缓解。
- **[medium]** `src/infra/shared/config.ts:140-156` —— `save()` 明文写 `apiKey` 到 `~/.xqoder/config.json`。`chmod 0o600` 被静默 `catch` 吞掉(149 行)→ chmod 失败时应拒绝明文写入并回退 env-var 提示。
- **[medium]** `src/application/chat/turn-intake/mention-expander.ts:6,14-52` —— `@foo.env` mention 匹配 `MENTION_RE`(点 + 3 char ext),`isInsideCwd` 允许项目内 `.env`,最终以 base64 附加到 prompt → 发给 LLM provider。**缓解**:reject `path.basename()` 落在 `domain/permissions/sensitive-paths.ts` 的 `SENSITIVE_READ_BASENAMES`。
- **[low]** `src/core/agent/session/sanitize.ts:25-46` —— 正则脱敏只接 `Bearer`、`sk-…`、`Authorization:` 与短关键字表。`ghp_` / `AKIA…` / JWT / `github_pat_` 透过。**缓解**:补规则,且默认关 `last_user_message` 持久化。

### 2.2 Command injection
- **[medium]** `src/core/agent/tools/command-tool.ts:205-208` —— `run_shell` / `run_command` 拼接 LLM 输入到 `sh -l` stdin,仅靠 `validateCommandSafety`(`sandbox.ts:239-255`)短正则(`rm -rf /` / `sudo` / `curl|sh`)过滤。显见绕过:`rm -r -f /`、`su -`、tab/编码分隔、`bash -c "$(echo cm0gLXJmIC8K|base64 -d)"`、`eval $VAR`。审批门是最后防线 —— 对含非 shell-builtin metachar 的命令把 `risk` 提至 `critical` 并要求超时后重新 prompt。
- **[low]** `prompt-hook-bridge.ts:127+` / `hook-handler-execution.ts:51-105` 把 hook 命令透传到 `sh -c`/`cmd /c` —— payload 走 stdin JSON,无注入面。记录以防被 "修" 成 arg-array 形式。

### 2.3 Path traversal
- **[medium]** `src/application/memory/memdir.ts:47-67` —— `scanMemoryFiles` 不 `realpathSync`。符号链接指 `/etc/passwd` / `~/.aws/credentials` 会被读取并原样注入 turn prompt via `renderMemoryAppendix`。缓解:resolve real path,拒绝逃出两个允许 root 的 case。
- **[medium]** `src/application/chat/attachments.ts:33,80-116` —— `appendEditorAttachment` / `buildMessageAttachments` 仅 `path.resolve()`,无沙箱检查。当前 caller 可信,但 API 邀请回归。**缓解**:强制 `projectRoot` 参数 + `isPathInsideRoot` 断言。

### 2.4 Prompt injection → tool call
- **[medium]** `src/core/agent/tools/command-tool.ts:272-320` —— `RunCommandTool` / `RunShellTool` 实现 `buildApprovalRequest`,但接口未强制 orchestrator 必定调用。`autoApproveTools: true`(来自 `BuildConversationTurnInputOptions`)若泄漏到非交互 TUI / HTTP 运行,LLM 可无人值守执行 shell。**缓解**:`autoApproveTools` 必须 env gate(`XQODER_ALLOW_AUTO_APPROVE=1`),非 TTY session 一律拒绝。
- **[low]** `src/application/chat/verification-gate.ts` 是 **post-tool**,不能阻止破坏性调用 —— 按 design。ADR 应显式声明以免后续 review 误读为 write-gate。

### 2.5 Unsafe deserialization / eval
无。全部 `JSON.parse` 包 try/catch,无 `eval` / `vm.runIn*` / `new Function`。

### 2.6 HTTP client hygiene
- **[critical]** `src/core/agent/tools/fetch-tool.ts:63-174` —— `fetch_url` **零** SSRF 防护:
  - 接受 `http://`(77 行)
  - 不 resolve / 过滤 hostname
  - 不拦 RFC1918 / loopback / link-local / `0.0.0.0` / cloud metadata `169.254.169.254`

  LLM 被任意页面诱导就能请求 EC2 metadata `http://169.254.169.254/latest/meta-data/iam/security-credentials/` 或 dev 机 `http://localhost:6379/`,回读 body。配合 `run_shell` 一跳外泄。审批 risk 只标 `medium`。
  **缓解**:parse URL → DNS resolve → 拒绝 loopback / link-local / private / ULA / reserved;默认仅 `https://` 放行,`http://` 需显式 opt-in;`risk: 'high'`。
- **[medium]** `src/commands/sessions/import.ts:87-98` —— `loadImportSource` 拉 `http(s)://` URL 喂回 session → replay 成 LLM context。无 SSRF 过滤 / 无 size cap / 无 content-type 检查。**缓解**:仅 `https://` + share host 白名单 + `Content-Length` 上限。

### 2.7 MCP / subprocess
§2.1 已覆盖主线。次要:`resolveMcpServerTrust` 默认 stdio=trusted,HTTP/SSE 反而走手工审批。最常见攻击面(`npx @attacker/mcp-foo`)反而无门 → 默认降为 `untrusted`,user 显式按 server 名加白。

### 2.8 Session / transcript leakage
- **[low]** `src/core/agent/session/store.ts:66-78` —— SQLite DB 创建时未 `chmod 0o600`。共享 dev 机 umask 022 下世界可读,内含工具输出(可能是 `.env`)。加 chmod。

### 2.9 安全 Checklist 结果
- 硬编码密钥: ✅ 无
- Subprocess env 脱敏: ❌ MCP stdio + command hook 未做
- 输入校验: ⚠️ 部分(command/shell 是正则白名单)
- SSRF: ❌ `fetch_url` 裸跑,session import 裸跑
- 授权每门: ✅(verification-gate 是 post-tool 设计)
- TLS bypass: ✅ 无
- 依赖审计: 未在本轮跑,建议单独 `bun audit` + Socket scan

### 2.10 安全修复优先级
1. **24 小时**:`fetch_url` SSRF 拦截(loopback / link-local / private / metadata;默认 https)
2. **1 周**:MCP stdio + command hook env 脱敏(移除 KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|SESSION)
3. **1 周**:stdio MCP 默认 `untrusted`
4. **1 月**:`@file` mention sanitizer(拦 `.env` / credentials)+ `attachments.ts` 沙箱 + session DB chmod 0o600 + chmod 失败拒写明文 key
5. **1 月**:session import URL 强化 + `autoApproveTools` 守卫

---

## 3. 错误 / 类型逃逸审查(silent-failure-hunter subagent)

### 3.1 被吞错误
- **[high]** `src/application/chat/compaction-pipeline.ts:73` —— auto-compact 失败仅 `logger.error`,无返回标志,query loop 以为成功继续跑超窗 context。
- **[high]** `src/application/chat/turn-intake/prompt-hook-bridge.ts:77` —— 抛错 hook `continue` 跳过,deny hook 抛错 → allow。
- **[high]** `src/infrastructure/agent/tui-agent-service.ts:81` —— `compactSession` 对 "无内容" 和 "抛错" 都 return null。
- **[high]** `src/core/agent/agent-tool-execution.ts:563` —— 工具参数 parse 失败返回 `{}`,下游拿空参跑。
- **[medium]** `src/core/agent/sub-agents.ts:184` —— LLM task decomposition 失败 fallback `[taskDescription]`,caller 无感知。
- **[medium]** `src/application/chat/turn-intake/submission-preprocess.ts:77` —— config load 失败静默 `undefined`。
- **[medium]** `src/infra/shared/copilot-auth.ts:53` —— 文件权限 / JSON 损坏 与 "无 Copilot token" 无法区分。

### 3.2 空 catch
- **[high]** `src/infra/shared/event-bus.ts:40,56` —— `emit` / `emitAsync` 全吞。
- **[high]** `src/infra/llm/openai/provider/index.ts:278,317,342,354` —— streaming 路径 4 个空 catch 包 onToken / onToolCall / onComplete。
- **[medium]** `src/infra/shared/custom-commands.ts:54` —— 自定义 command 加载失败静默。
- **[medium]** `src/infra/llm/openai/shim/convert-messages.ts:73` —— 参数序列化失败 return `''`。
- **[low]** `src/core/agent/session/migrations.ts:119` —— 迁移外层空 catch。

### 3.3 未处理 Promise rejection
- **[high]** `src/core/agent/agent.ts:337` —— `void this.run(...)` 无 catch,agent 启动后 run reject 就丢。
- **[medium]** `src/features/runtime/runners/node-runner.ts:139` —— `waitForPort` fire-and-forget 吞错,端口永远不 ready 时无日志。
- **[medium]** `src/interfaces/http/server.ts:319` —— LSP shutdown 吞错(teardown 阶段,可接受但建议 debug log)。
- **[low]** `src/application/chat/conversation-engine.ts:190` —— `void stream.completed.catch((): void => undefined)` 有注释说明,可接受。

### 3.4 `any` / 类型逃逸
- **[high]** `src/infra/llm/openai/provider/index.ts:446` —— `tc: any` → 换 `OpenAI.ChatCompletionMessageToolCall`。
- **[high]** `src/core/agent/agent.ts:315` —— `type as any` → 扩 `AgentEvent` 联合。
- **[high]** `src/features/runtime/runtime.ts:61,138,171,202` —— 4 处 `'config_error' as any` / `'runtime_exception' as any` → 补 `RuntimeEvent` 变体。
- **[high]** `src/core/agent/session/migrations.ts:11-13` —— `DatabaseLike` 全 `any` → 改 `unknown` + call-site narrow。
- **[high — 软红线]** `src/application/chat/conversation-engine.ts:424` —— `normalizedRequest as unknown as JsonValue` 强转 approval payload;非 serializable 字段运行时炸无编译期警告。
- **[medium]** `src/infra/llm/openai/shim/provider.ts:60,104,105` —— 3 处 `as unknown as`(P05)→ 显式 adapter。
- **[medium]** `src/infra/llm/openai/shim/codex-shim.ts:65` —— `buildClient` 返回类型不匹配,用 `as unknown as` 强转 → 修返回类型。
- **[medium]** `src/core/agent/session/store.ts:225` —— `message as any` → 给 sanitize 写类型。
- **[medium]** `src/core/agent/tools/lsp-tool-typescript-context.ts:261` —— `renameInfo as any` → type guard。
- 另有 `src/infra/llm/openai/provider/index.ts:378,415`(OpenAI content parts)、`src/core/agent/lsp-client-transport.ts:112,180`(child process)同类 `as unknown as`,统一转 adapter。

### 3.5 Top 5 先修
1. `src/core/agent/agent.ts:337` — agent run 静默失败。挂 `.catch((err) => emit('error', ..., streamId))`。
2. `src/application/chat/turn-intake/prompt-hook-bridge.ts:77` — 抛错 hook 视作 deny,不可跳过。
3. `src/infra/shared/event-bus.ts:40,56` — EventBus 加 error log(至少 `logger.error`)。
4. `src/application/chat/compaction-pipeline.ts:73` — 返回 `{ compacted: boolean; error?: ... }`,由 query loop 判是否 abort 或降级 warn。
5. `src/application/chat/conversation-engine.ts:424`(软红线)— 定义 serializable approval payload 类型,去掉 `as unknown as JsonValue`。此改动落在软红线 → 纳入新 ADR。

---

## 4. 合并行动清单(建议一个 hotfix phase `P11.1`)

按 CLAUDE.md "必停场景" 规则,以下两条需要用户先拍板才能推进:

### 必须用户决策(硬红线触发)
- **A**:如何统一 event envelope(§1.5)—— 方案 a 把 envelope 搬回 `src/domain/conversation/events.ts`,infra 侧转发;方案 b 删 domain 版本、统一指向 `src/infra/protocol/events.ts` / `@xqoder/protocol`。两者都需要 ADR。

### 可直接启动(7 条,建议 P11.1 一个 session 做完)
1. `fetch_url` SSRF 拦截
2. MCP stdio + command hook env 脱敏
3. stdio MCP 默认 `untrusted`
4. agent.ts:337 `void this.run` 挂 catch
5. prompt-hook-bridge.ts:77 throw 视作 deny
6. event-bus.ts 两个空 catch 加 error log
7. compaction-pipeline.ts:73 带错返回

### 中期(建议并入 P12 之前的 cleanup,或单独 P11.2)
- 补 ADR 0008(`5223846` consolidate + permission hardening)
- 补 ADR 0009(`src/infrastructure/` → `src/infra/` 迁移路线)
- 改名 `lsp-manager.ts` / `mcp-server-manager.ts` / `recovery-manager.ts`
- 应用层 `permission-gate.ts` 改名 `turn-permission-gate.ts`
- `@file` mention sanitizer 拦 `.env` + `attachments.ts` 要求 projectRoot
- session DB `chmod 0o600`
- `src/features/**`、`src/commands/**`、`src/plugins/**`、`src/ux/**` 归位或写 ADR 纳入 conventions

---

## 5. 基线判断

- **release:check 未在本轮跑**。本轮为只读审查,未执行 build/test。若执行 P11.1 hotfix,在 hotfix 结束时必须 `bun run release:check` + `bun run eval:golden -- --dry-run` 才能合并。
- **golden task 通过率**:本轮未比对,最新数据在 `docs/release/latest-golden-task-report.md`,由 P11 session 留下。
- **建议下一步顺序**:
  1. 用户就 §4.A(event envelope)做决策
  2. 开新 session 跑 P11.1 hotfix(7 条可直接启动项)
  3. P11.1 完成后再开 P12 session 按施工单继续

---

审查执行者:
- Agent: `architect`(a11bc33af6e8afe9a3b)
- Agent: `security-reviewer`(afce5b1ea9487755c)
- Agent: `silent-failure-hunter`(a85bdd8c37776fd4a)

主会话仅汇总,未执行任何代码改动。
