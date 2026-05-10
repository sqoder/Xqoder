# ADR-0002 · P04 Permission modes — acceptEdits + auto-mode shell classifier

**Status:** Accepted
**Date:** 2026-05-10
**Phase:** P04 (execution-order S4 / permissions + autopilot底座)

---

## Context

Phase 04 施工单要求补齐 OpenClaude §09 的五档 permission mode,特别是
`acceptEdits`(编辑自动放行、shell 仍审批),并把 `auto` 模式下 shell 调用
接入一个"安全评分"分类器 —— v1 施工单写的是纯正则,v1 补遗(附录)把它
改成 "规则 + 两阶段 LLM" 两层。

当前 tool-policy 的核心 API `resolveToolPermissionMode` 和
`resolveToolPermissionDecision` 都是 **同步** 的,被 3 处调用:

- `src/core/agent/agent.ts:596`
- `src/core/agent/agent-tool-execution.ts:182`
- `src/infrastructure/agent/tui-agent-runtime-support.ts:34`

把整条签名改 async 会把异步污染扩散到 agent 主循环;而 P04 只是
`permissions` 这一切片,不该绑架到主循环的时序重构。

---

## Decision

**本期 P04 只落规则层 + 可选 LLM 层的基础设施,不改
`resolveToolPermissionDecision` 的 sync 签名。**

具体分工:

1. **规则分类器(同步)** 直接嵌入 `resolveAutoModeDecision` 的 shell 分支,
   外加一个早 deny 的 carve-out:
   - `dangerous → deny`(regex 匹配 sudo / rm -rf / / curl | sh / git push
     --force 等一等),
   - `safe → allow`(regex 匹配 ls / cat / git status / bun test 等),
   - `unknown → ask`(保守默认;复合命令 `&&` / `;` / `|` / `$()` / backtick
     会把 safe 降级为 unknown 以防 `git status && rm -rf /`)。
   - 早 deny carve-out 解决了 auto + dangerous 被 `requiresDangerousCommandApproval`
     强制拉回 'ask' 的顺序问题(DoD 要求 auto + `rm -rf /` 是 deny)。

2. **LLM 两阶段分类器(异步)** 作为独立模块 `decideShellPolicy` 留给 P12
   (工具调度层)接入:
   - feature flag 默认 **OFF**(没有 `XQODER_FEATURE_PERMISSION_YOLO_CLASSIFIER`
     环境变量也不会跑);
   - stage1=Haiku、stage2=Sonnet 由 `classifier-provider.ts` 工厂构造,
     走独立 provider 实例,不复用主对话缓存;
   - 任何解析/超时/unavailable → `deny`(保守);
   - 按 session 记录 deny 次数,≥ 3 次后降级为 `ask`(denial-tracking),
     防止分类器在长 session 里静悄悄把一切都 deny 掉。
   - 本期用 mock provider 单测覆盖 stage1 safe / stage1 unparsed / stage2
     confirm deny / stage2 flip / stage1 throw / stage2 throw / timeout 等 6
     条 code path,一共 13 条 test。

3. **`acceptEdits`** 作为平行分支,落在 `resolveToolPermissionDecision` 的
   主 switch 里:
   - 编辑类工具(`write_file` / `edit_file` / `apply_patch` /
     `restore_rollback_point` / `lsp_rename_symbol`) → `allow`;
   - 读类工具 → `allow`(读 + 写一起放行,符合"让 agent 自由读写代码"的
     用户意图);
   - 其他(shell / fetch / websearch / MCP) → `ask`。
   - **仍保留** 结构化结构化守则(sensitive config / 项目外路径 / protected
     path)优先于 `acceptEdits` 生效 —— 即使开启 acceptEdits,写
     `/etc/hosts` 仍然被拉回 ask。

---

## Consequences

### 正面

- 不改 `resolveToolPermissionDecision` 的同步签名,`agent.ts` /
  `agent-tool-execution.ts` / `tui-agent-runtime-support.ts` 三处调用点零
  改动。
- `auto` 模式实现了施工单 DoD 的最核心要求:dangerous → deny、safe → allow、
  `rm -rf /` / `sudo` / `curl | sh` 全链路被 deny。
- LLM 层作为一整套 "feature flag 下线默认 off" 的独立模块上了线,P12 能直接
  `await decideShellPolicy(...)` 在异步的 tool-orchestrator 里接入。
- 把新加的代码从 tool-policy.ts 拆到 `permission-mode-helpers.ts`,让
  tool-policy 在 size guardrail 下只新增 < 10 行(HEAD 1246 → 1243,实际
  **减少** 3 行)。

### 负面

- 本期 `auto` 模式 **只用规则** 做决策,对未在白名单上的命令(比如
  `terraform apply` / `kubectl delete`)一律 `ask`。这是保守默认,也是
  施工单附录的建议。等 P12 把 `decideShellPolicy` 接到 `tool-orchestrator`
  后,"unknown + flag on" 才会升级到 LLM 判断。

- 两层分类器之间的 flag 默认值 **不对称**:规则层永远开,LLM 层永远默认关。
  这是故意的 —— 规则层是确定性的,LLM 层要真 API key + 网络 + 延迟。

- `resolveRemoteToolPermissionMode` 里 `bypassPermissions` 和 `acceptEdits`
  都会被 remote surface 降级为 `'allow'`。这是老 runtime 只认
  allow/ask/deny 的三态兼容妥协,upstream 的 `resolveToolPermissionDecision`
  已经按 per-tool 语义决了策,降级后不会丢信息。

---

## 红线对照

本期修改了 **软红线** 文件:

- `src/domain/permissions/tool-policy.ts` — 加 `acceptEdits` 分支 + 早
  deny carve-out + shell 分类器接线点。按 CLAUDE.md 软红线规则,允许改,
  留 ADR(本文)。

**未触硬红线** (`verification-gate.ts` / `events.ts` 均未动)。

---

## 后续

- P12(工具调度):把 `decideShellPolicy` 和 `denial-tracking` 接到
  tool-orchestrator 的异步审批前置 hook 上,解锁 LLM 层在 autopilot 中真
  生效。
- 真实 LLM API 命中率/准确率评测留到 P15 `acceptance:metrics:live` 阶段采集。
