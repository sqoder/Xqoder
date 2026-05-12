# Phase 11 · 输入预处理（slash / @file / memdir / contextPreload / handlePromptSubmit）

## 任务目标（必须可验证）

把"用户按下回车"到"进入主循环"的 8 步对齐 OpenClaude
`utils/processUserInput/**` + `commands.ts` + `memdir/**` + `context.ts`
+ `utils/contextPreload.ts` + `utils/handlePromptSubmit.ts` 的行为。

### 成功判定

- 输入 `/help` → 命中本地命令，不走主循环。
- 输入 `explain this @src/index.ts` → 自动把 `src/index.ts` 内容插入消息。
- 有 `CLAUDE.md` / `~/.xqoder/CLAUDE.md` 的项目 → 自动作为 memory 层注入。
- 有相关 `memdir/<session>.md` 片段 → `findRelevantMemories` 命中后注入。
- 拖入图片 / PDF → 进入 attachments 路径，不直接 inline。
- `UserPromptSubmit` hook 可阻断或重写用户消息。
- 所有新增 12+ 工具都有单测 fixture。

## 对标源

- `openclaude/src/utils/processUserInput/**`
- `openclaude/src/commands.ts`
- `openclaude/src/context.ts`
- `openclaude/src/memdir/memdir.ts / findRelevantMemories.ts / memoryScan.ts / memoryAge.ts / teamMemPaths.ts`
- `openclaude/src/utils/contextPreload.ts`
- `openclaude/src/utils/handlePromptSubmit.ts`
- `openclaude/src/utils/promptCategory.ts`
- `openclaude/src/utils/argumentSubstitution.ts`

## 范围与边界

### 允许修改

- 扩展 `src/application/chat/turn-intake.ts`（已是入口）+ 拆分：
  - `turn-intake/slash-router.ts`
  - `turn-intake/mention-expander.ts`
  - `turn-intake/memory-loader.ts`
  - `turn-intake/attachment-resolver.ts`
  - `turn-intake/prompt-hook-bridge.ts`
- 新增 `src/core/memory/memdir.ts`（OpenClaude `memdir/memdir.ts` 对标）
- 保留现有 `application/instructions / application/memory` 作为 memory 聚合口。

### 禁止修改

- `ConversationEngine` 公共 API。
- Prompt composer 的最终拼接顺序。

## 改动要点

### 1) slash 路由

```ts
// slash-router.ts
export function routeSlashCommand(text: string): SlashCommandRoute | null {
    if (!text.startsWith('/')) return null;
    const [head, ...rest] = text.trim().split(/\s+/);
    const cmd = SLASH_COMMANDS[head];
    if (!cmd) return { kind: 'unknown', head };
    return { kind: 'known', command: cmd, args: rest.join(' ') };
}
```

`SLASH_COMMANDS` 注册表直接映射 `src/commands/**` 子命令的别名：
`/help /compact /new /resume /model /effort /think /nothink /fast /plan /review /stats /clear /export /hooks /mcp /skills /plugin /cost /doctor`.

### 2) @file 展开

```ts
// mention-expander.ts
const MENTION_RE = /@([^\s@]+\.(?:ts|tsx|js|md|py|txt|json|yml|yaml|rs|go|java|cpp|c|h))/g;
export async function expandMentions(text: string, cwd: string): Promise<{ text: string; attachments: MessageAttachment[] }> {
    const found = [...text.matchAll(MENTION_RE)];
    const attachments: MessageAttachment[] = [];
    for (const m of found) {
        const abs = path.resolve(cwd, m[1]);
        if (await fileExists(abs)) attachments.push(await loadFileAsAttachment(abs));
    }
    return { text, attachments };
}
```

### 3) memdir

```ts
// src/core/memory/memdir.ts
export async function loadMemdirContext(input: {
    cwd: string;
    sessionId: string;
    prompt: string;
}): Promise<{ memories: MemoryBlock[] }> {
    const candidates = await scanMemoryFiles(input.cwd); // <cwd>/CLAUDE.md / ~/.xqoder/CLAUDE.md / memdir/*
    const relevant = findRelevantMemories(candidates, input.prompt);
    return { memories: relevant };
}
```

对标 OpenClaude `memdir/findRelevantMemories.ts`：用 rough TF-IDF
（v1 可只按字符串包含 + age penalty）；Phase 24 再接入"pattern memory"。

### 4) UserPromptSubmit hook

```ts
// prompt-hook-bridge.ts
export async function dispatchUserPromptSubmit(input: UserPromptSubmitInput): Promise<PromptSubmitResult> {
    const payload = { prompt: input.text, attachments: input.attachments, sessionId, cwd };
    const result = await runLifecycleHook('UserPromptSubmit', payload);
    if (result?.decision === 'deny') return { blocked: true, reason: result.reason };
    if (result?.rewritten) return { text: result.rewritten };
    return { text: input.text };
}
```

## 验证

- Fixture：`/help` → 本地命令命中。
- Fixture：`@README.md` → 自动 attach。
- Fixture：含 `CLAUDE.md` 的项目 → memories 插入 prompt。
- Fixture：hook 返回 `deny` → run-chat 直接返回 blocked。

## 风险与回退

- **风险**：@file 展开可能误命中注释里的 email（`user@example.com`）。
  **缓解**：MENTION_RE 只匹配 `@path-like`（带扩展名）；邮箱不命中。
- **回退**：`XQODER_DISABLE_MENTION_EXPANSION=1` 关掉展开。

## 不确定项

- memdir 的 "team memory" 是 OpenClaude 内部能力（与 Ant 团队沟通 API 相关），
  本期不复刻；只做 user + project 两级。
