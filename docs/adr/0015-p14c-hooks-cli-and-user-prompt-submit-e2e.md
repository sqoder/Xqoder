# 0015 · P14c — `xqoder hooks` CLI + UserPromptSubmit e2e

- Status: Accepted
- Date: 2026-05-11
- Phase: P14c

## Context

P14a 建 dispatcher,P14b 挂到 runtime,现在缺一条"配置面":让用户不
手写 JSON 也能加/删/测 hook。施工单 `xqoder hooks add/remove/list/test`。

现有 `createHooksCommand` 只有 `show / path / enable / disable`。本期补
`add / remove / list(别名) / test`,并加 UserPromptSubmit deny 的 e2e。

## Decisions

### 1) 四个新子命令

| 子命令 | 实现 | 说明 |
|--------|------|------|
| `list` | 复用 `runShowHooksCommand` | 直白的 UX 别名,不改行为 |
| `add --event <e> --type <command\|http\|prompt\|agent> ...` | `runAddHookCommand` | 按 matcher 分组:同 matcher 追加到同 group;否则新起 group |
| `remove --event <e> --index <N>` | `runRemoveHookCommand` | 扁平化 index,跨 matcher group;最后一个 handler 移除后删掉整个 event key |
| `test --event <e> [--tool-name X] [--payload JSON]` | `runTestHookCommand` | 从 layered config 加载 hooks,造一个合成 payload 真正跑一次 dispatcher,报告 `blocked` / `handlers` |

### 2) `--scope` 写入规则沿用 `enable/disable`

写入时默认 `scope=project`;可选 `global`。用 `resolveConfigWriteTarget`
复用既有解析,`.xqoder/config.json` 或 `~/.xqoder/config.json` 作为目标。

### 3) `add` 支持 4 种 handler 类型

- `--type=command`:`--command <cmd>` 必填;可选 `--async` / `--shell` / `--timeout`
- `--type=http`:`--url <url>` 必填;可选 `--timeout`
- `--type=prompt`:`--prompt <text>` 必填;可选 `--model` / `--timeout`
- `--type=agent`:`--prompt <text>` 必填;可选 `--agent <name>` / `--model` / `--timeout`

内部用 `buildHandlerFromCliOptions(options)` 根据 `--type` 分派;缺字段
直接 throw,由 `runHooksCommand` 统一写 stderr 并 `process.exit(1)`。

### 4) `test` 是真正的 dispatcher 调用,不是 dry-run

目标:让用户在修改 hook 配置后**不起全会话就能验证**生效状态。实现从
`createLayeredConfigSnapshot` 取 hooks,造 payload,走真正的
`dispatchLifecycleHook` / `runToolHooks`。

- lifecycle 事件用 `buildXxxPayload` + `--payload` JSON override 填可选字段
  (如 `PreCompact` 的 `custom_instructions`、`SessionStart` 的 `source`)
- `PreToolUse` / `PostToolUse` 用 `--tool-name`(默认 `run_command`)合成;
  `--payload` 作为 `tool_input`
- `UserPromptSubmit` 目前不在 test 覆盖,因为它有独立的 `prompt-hook-bridge`
  路径,本期 e2e 已直接验证(见 §6)

### 5) 红线 / 架构分层:`runTestHookCommand` 放到 `application/integrations/`

原本想塞进 `src/application/system/hooks.ts`,但本期发现 `@xqoder/agent`
的运行时 import(用来调 `dispatchLifecycleHook` / `runToolHooks`)会把
agent 源码拉进 `tsconfig.application-system-exact-optional.json` 的严格
lint 范围。那个 config 的 include 已经传递覆盖到 src/infra 和 src/core,
一跑就爆 40+ 条预存在的 exactOptionalPropertyTypes 警告。

**处理**:参考 P13c 的 `application/integrations/mcp-auth-command.ts`
模式,把 test 实现拆到 `src/application/integrations/hooks-test.ts`,
在 `application/system/hooks.ts` 只保留接口 re-export。`src/commands/system/hooks.ts`
直接从 `application/integrations/hooks-test.js` 导入。

类型通过 `application/system/hooks.ts` 导出:`HookTestOptions` / `HookTestResult`
在系统层定义,实现层仅 import 类型 → 单向依赖,不成环。

### 6) UserPromptSubmit deny e2e

新测试 `test/application/chat/turn-intake/user-prompt-submit-deny-e2e.test.ts`
用真实 `resolvePromptSubmissionOutcome`(run-chat 三个入口点共用的底层)
验证:

- Hook 脚本读 stdin,匹配 `/forbidden` → `{decision:'deny', reason:'...'}`
- 带 `/forbidden` 的 prompt → `status: 'blocked'`,response 携带 reason
- 不匹配的 prompt → `status: 'proceed'`,prompt 不被改写

不 mock,真的写 `.sh` + `.xqoder/config.json`,跟正式运行时路径一致。

## Validation

- `bun run release:check`:**1086 pass / 0 fail**,coverage **68.85%**
  (P14b 68.80%,+0.05%),e2e smoke ✅、mcp:live-smoke 三 transport ✅、
  security hygiene ✅、size guardrail ✅
- 新测试(**10 条**,≥5 要求):
  - `test/application/system/hooks-mutations.test.ts`(9 条):
    - `runAddHookCommand`:fresh 追加 / matcher 分组 / 拒绝未知事件(3)
    - `runRemoveHookCommand`:flat 索引 + group 压缩 / 越界 / 清空 event key(3)
    - `runTestHookCommand`:SessionStart `decision=block` / PreToolUse
      `permissionDecision=deny` / 非法 JSON payload(3)
  - `test/application/chat/turn-intake/user-prompt-submit-deny-e2e.test.ts`(1 条,真 e2e)
- CLI 手测(未进 automation):
  ```
  xqoder hooks add --event UserPromptSubmit --command ./guard.sh
  xqoder hooks list
  xqoder hooks test --event SessionStart
  xqoder hooks remove --event UserPromptSubmit --index 0
  ```

## 零硬红线触碰

- `src/application/chat/verification-gate.ts` 未动
- `src/infra/protocol/events.ts` 未动
- `src/application/chat/conversation-engine.ts` 未动(P14b 已改,本期不碰)

## 不做 / 搁置

- `xqoder hooks test --event UserPromptSubmit`:UserPromptSubmit 走
  `prompt-hook-bridge`,不走通用 dispatcher;用 `add` 配置后直接发 prompt
  验证更直观。如有需求加 bridge 调用,P15 再议
- `xqoder hooks edit`(修改现有 handler):施工单未要求;`remove + add`
  已够用

## 文件清单

新增:
- `src/application/integrations/hooks-test.ts`(约 235L,dispatcher 实现)
- `test/application/system/hooks-mutations.test.ts`(9 条 add/remove/test 单测)
- `test/application/chat/turn-intake/user-prompt-submit-deny-e2e.test.ts`(1 条 e2e)
- `docs/adr/0015-p14c-hooks-cli-and-user-prompt-submit-e2e.md`(本文)

修改:
- `src/application/system/hooks.ts` — 新增 `runAddHookCommand` /
  `runRemoveHookCommand` / `HookMutationOptions` / `RemoveHookOptions` /
  `HookMutationResult` / `HookTestOptions` / `HookTestResult` 接口。不动
  现有 show/enable/disable 实现。
- `src/commands/system/hooks.ts` — `add / remove / list / test` 子命令,
  commander 参数映射 → `buildHandlerFromCliOptions`;`test` 直接 import
  `application/integrations/hooks-test.js`
