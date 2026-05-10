# ADR 0007 — P11 Input Preprocessing (slash / @file / memdir / UserPromptSubmit)

- **Date**: 2026-05-10
- **Status**: Accepted
- **Phase**: P11
- **Related docs**: `docs/openclaude-parity/phase-11-input-preprocessing.md`
- **软红线**: 未触碰(`conversation-engine.ts` / `tool-orchestrator.ts` / `permission-gate.ts` 均无改动)

## 背景

OpenClaude 的 `utils/processUserInput/**` + `commands.ts` + `memdir/**` + `context.ts`
+ `utils/contextPreload.ts` + `utils/handlePromptSubmit.ts` 把"用户按下回车"
到"进入主循环"拆成 8 步。XQoder 只有 slash 路由(P10)和基础 attachment 构造,
缺 `@file` 自动展开、memdir 注入、UserPromptSubmit hook 这三块。

本期同时收尾 ADR 0006 §不确定项 #4(`enableConfigs` 做 settings.env 回写)。

## 决策

### 1) 子模块落位:`src/application/chat/turn-intake/`

P10 把 `turn-intake.ts` 已经做成应用层入口。P11 在 **同一目录** 下新增 5 个
子模块,不新开抽象目录、不新建 `*-factory` / `*-manager`:

- `slash-router.ts` — 复用已存在的 `command-router.ts`(P09/P10 的实现),
  只加一条 `/help`(+`/?` 别名)route,并标成 `isDirectChatCommandRoute`。
  `direct-command.ts` 的 switch 新增 `case 'help'` 返回静态帮助文本。
- `mention-expander.ts` — `expandMentions(text, cwd)`:`@path.ext` 正则匹配
  到 `MessageAttachment[]`。去重、硬上限 5、支持 `XQODER_DISABLE_MENTION_EXPANSION=1`
  全关。**邮件不中**(regex 要求路径带扩展名且前缀不是其他字母 — `user@example.com`
  里的 `@example.com` 因为前一个字符是字母而落空)。
- `memory-loader.ts` — `renderMemoryAppendix(memories)` 把 memdir 结果格式化成
  prompt appendix。
- `attachment-resolver.ts` — `resolveTurnAttachments({prompt, cwd, userProvided})`
  把 mention 结果与编辑器手动附件合并去重,供 `buildConversationTurnInput` 调用。
- `prompt-hook-bridge.ts` — `dispatchUserPromptSubmit(...)`:专属
  UserPromptSubmit hook 执行器,仅支持 `type: 'command'`(最小面;
  `http`/`prompt`/`agent` 可后续 phase 扩)。超时 fallback、JSON 解析失败、
  非 decision=deny/block 的所有情况 — 一律 fail-open 放行。
- `submission-preprocess.ts` — `resolvePromptSubmissionOutcome(...)`:在
  `run-chat.ts` 三个入口(`runChat` / `runChatHeadless` / `runChatMessageStream`)
  的最前端调用,返回 `{status:'proceed', prompt}` 或 `{status:'blocked', response, sessionId}`,
  包裹掉 Hook 触发的阻断和改写细节。

### 2) memdir 在 `application/memory/`,不是 `core/memory/`

施工单原话是 `src/core/memory/memdir.ts`。但 `test/architecture-guardrails.test.ts`
禁止 `application/` 直接 `import '../../core/...'`(relative;可以用 `@xqoder/...`
包别名 — 但 core/memory 目前没开包)。落到 **`src/application/memory/memdir.ts`** 符合
分层规则、复用 P09 之前就空挂的 `src/application/memory/index.ts` aggregator。
行为一致,所以这次偏差只在物理位置 —— 后续若真要下沉到 core/ 的独立包,P16 subagent
那期一起处理。

### 3) memdir 算法:字符串 token 交集 + age penalty(v1)

- 候选源:`<cwd>/CLAUDE.md`, `xqoder.md`, `.claude/CLAUDE.md`, `.xqoder/CLAUDE.md`,
  `<cwd>/memdir/*.md`, `~/.xqoder/CLAUDE.md`, `~/.xqoder/memdir/*.md`
- 过滤:空文件 / 非 `.md` / 非文件 — 全部 skip
- 打分:提示词与文件内容在 **同一个小写 token 集合** 里的重合 token 数
- 截断:`MAX_RULE_FILE_CHARS = 4000` 每文件,`MAX_RELEVANT_MEMORIES = 3` 每 turn
- STOPWORDS 去 the/and/for/help/check/...;阈值 `MIN_TOKEN_OVERLAP = 1` —
  至少一个非-stopword token 重合才算 relevant

P11 不做 TF-IDF / 向量检索,施工单里"rough TF-IDF"留给 P24 "pattern memory"。
当前 v1 对日常项目(单库,CLAUDE.md 100-500 词,prompt 10-30 词)够用。

### 4) Hook event 类型扩展

`src/infra/shared/types.ts`:

```ts
export const SUPPORTED_HOOK_EVENTS = [
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'UserPromptSubmit',  // ← 新增
] as const;
```

Hook config 解析器 `config-normalizers-hooks.ts` 自动接受新事件(只要在 SUPPORTED
里)。现有 `runToolHooks` 不走 UserPromptSubmit —— UserPromptSubmit 有独立的 payload
形状(`prompt`, `attachment_count`)和独立的 output schema(`rewritten`, `decision:'deny'`),
放在 `prompt-hook-bridge.ts` 专跑。

### 5) `applyUserPromptSubmitHook` 仅读 config,不持有 llmConfig

UserPromptSubmit 只在 hooks 存在时才调用(最快 fast-path 是 `hooks?.UserPromptSubmit?.length === 0 → 直接 return`)。不读 LLM config、不启动 provider;
`type: 'command'` 的 shell hook 是唯一路径。未来需要 prompt/agent 类型再补。

### 6) run-chat 三个入口的接入方式

在每个入口首行插入 `resolvePromptSubmissionOutcome(...)`,`blocked` → 返回合成响应
(CLI 走 `writeBlockedPromptResponse` 写 stdout,headless/stream 直接 return)。
**不改主循环、不改 turn-intake**。接入代码有多处重复 shape —— 为了通过 file-size
guardrail(`run-chat.ts` 必须 ≤ 1000 行)做了轻度收紧:多字段的
`buildConversationTurnInput({...})` 仍保持可读多行,但 `resolvePromptSubmissionOutcome`
调用压成一行能容纳的 shape。`run-chat.ts` 最终 997 行(P10 时 987 → +10)。

### 7) ADR 0006 §不确定项 #4 收尾:`enableConfigs` settings.env 回写

- 新文件 `src/shared/settings-env.ts`:`loadSettingsEnvFromFile` + `applySettingsEnv`
- `XQoderConfig` 新增 optional `env?: Record<string, string>`
- `enableConfigs()` 在 feature-flags 加载完后调 `applySettingsEnv(loadSettingsEnvFromFile(homeDir))`
- **合并规则**:`process.env` 里已有的 key **不覆盖**(CLI / shell env 优先)
- 支持 `XQODER_SETTINGS_PATH` 重定向路径(测试友好)

## 红线

- **硬红线**:未改
- **软红线**:`turn-intake.ts` 有新增(mention expansion / memdir appendix) —
  改动仅扩展 `buildConversationTurnInput` / `prepareChatExecution` 的出参形状,
  不改 API shape。`run-chat.ts` 三处入口加前置 outcome 判断,不动主循环。
- **禁止行为**:未新建 `*-factory.ts` / `*-manager.ts`;文件名直接
  `mention-expander.ts` / `memory-loader.ts` / `attachment-resolver.ts` /
  `prompt-hook-bridge.ts` / `submission-preprocess.ts` / `slash-router.ts`(薄再导出)

## 验证

- `bun x tsc --noEmit`:绿
- `bun test test/application/chat/turn-intake/`:17/17
- `bun test test/application/memory/memdir.test.ts`:6/6
- `bun test test/shared/settings-env.test.ts`:5/5
- `bun test test/application/chat/`:200/200(含 P11 新增)
- `bun run release:check`:**PASS** (948 test pass / 0 fail / 2906 expect;
  coverage PASS;cli smoke PASS;mcp live smoke PASS;security hygiene PASS;
  file-size guardrail PASS — run-chat.ts 997 行 ≤ 1000)

## 不确定项 / 延后

1. **真正的 TF-IDF memory ranking** —— v1 token 交集足够应付常见项目,P24
   "pattern memory" 那期接入 TF-IDF / embedding。
2. **UserPromptSubmit hook 的 http/prompt/agent 类型** —— 当前只跑
   `type:'command'`。其他 3 种 handler 类型要到 P13(MCP)/P16(subagent)
   那期做完 `executeHookHandler` 的通用化再接。
3. **memdir 的 team memory** —— 施工单已说不复刻,OpenClaude 那边是内部
   协议,XQoder 从头跑 user + project 两级。
4. **`contextPreload`** —— 施工单里 OpenClaude 有个独立的 `contextPreload.ts`
   做"目录树 + git 状态"注入。XQoder 的 `prompt-composer` 现在已经做
   `buildAutoProjectContext`,行为等价 —— 不另开新文件,直接走现有路径。
