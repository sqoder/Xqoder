# Phase 24 · 会话生命周期（含 transcript / snapshot / resume / rewind / arc）

## 任务目标（必须可验证）

对齐 OpenClaude 的会话持久化、跨机器 teleport、conversation arc、
rewind / --resume 能力。

## 对标源

- `openclaude/src/utils/sessionStorage.ts / sessionRestore.ts / sessionStart.ts / sessionState.ts / sessionTitle.ts / sessionUrl.ts / sessionActivity.ts / sessionStorage.test.ts / sessionStoragePortable.ts`
- `openclaude/src/utils/conversationArc.ts / .test.ts`
- `openclaude/src/utils/conversationRecovery.ts / .hooks.test.ts`
- `openclaude/src/utils/crossProjectResume.ts`
- `openclaude/src/utils/fileHistory.ts`
- `openclaude/src/utils/teleport.tsx`
- `openclaude/src/hooks/useTeleportResume.tsx`
- `openclaude/src/assistant/sessionHistory.ts`
- `openclaude/src/commands/resume/**`
- `openclaude/src/commands/rewind/**`
- `openclaude/src/commands/teleport/**`
- `openclaude/src/screens/ResumeConversation.tsx`
- `openclaude/src/components/ResumeTask.tsx`
- `openclaude/src/components/MessageSelector.tsx`

### 成功判定

- `xqoder --resume` 列出可恢复会话（最近 20）。
- resume 后能恢复：transcript + file snapshots + approval records +
  verification history + compaction summary + usage + permissionMode +
  activatedSkills。
- `/rewind` 选 message → session 回滚到该 message 之后重跑。
- Cross-project resume：另一个 cwd 下启动能找到 transcripts by `sessionId`。
- Teleport：导出 session 到 URL（签名 + branch + commit hash），
  另一机器 `xqoder teleport <url>` 恢复。

## 范围与边界

### 允许修改

- 扩展 `src/core/agent/session/store.ts / session.ts`。
- 新增 `src/core/agent/session/arc.ts`（conversation arc 分析）。
- 新增 `src/core/agent/session/recovery.ts`。
- 新增 `src/core/agent/session/teleport.ts`。
- 新增 `src/commands/sessions/resume.ts / rewind.ts / teleport.ts`。

### 禁止修改

- SQLite schema 向后兼容（只新增字段，不改旧字段）。

## 改动要点

### 1) Resume payload 扩展

sessions.sqlite 添加字段：
- `permissionMode TEXT`
- `activatedSkills JSON`
- `lastApproval JSON`
- `verificationHistory JSON`
- `lastCompactionSummary TEXT`
- `fileSnapshotPath TEXT`

持久化这些字段后，`restore` 时重新注入到 `AgentSession`。

### 2) ConversationArc

```ts
export function computeArc(messages): ConversationArc {
    // 简化版：按 topic cluster 把对话分段；每段有 title + start/end index。
    // OpenClaude 的实现用 tokenizer + sliding window；v1 用关键词启发式。
}
```

`/session arc` 命令输出 arc，让用户看到"三段工作：① 读代码 ② 改 API ③ 修测试"。

### 3) Rewind

```
/rewind
```
→ 弹出 MessageSelector → 用户选某 assistant 消息 → session 截到该 index
（保留 baseSystem），重建 toolHistory。重跑最后一条 user message 或不跑
（由命令 flag 决定）。

### 4) Teleport

```
/teleport
  → 生成 signed URL: xqoder://teleport/<sessionId>?sig=...&branch=...&commit=...
  → 上传 session tarball 到临时 bucket（本期 v1 只支持 HTTP PUT 到
    用户可自管 URL，例：S3 presigned）。
  → 另一机：xqoder teleport <url> → 下载 + 验签 + 恢复。
```

本期 v1 不做云服务；只提供 `xqoder session export --zip out.tar.gz` +
`xqoder session import in.tar.gz` 两条线下传输命令。真正的云 teleport
留给未来 Phase。

### 5) File snapshot

在每次写入 tool 调用前做一个文件 snapshot（类似 phase-12 的 autoFix
之前），写入 `~/.xqoder/sessions/<id>/snapshots/<ts>/`；`/rewind` 时
可选 restore 文件到 snapshot 状态。

## 验证

- e2e：中断对话 → `xqoder --resume` → 第二轮正常继续；approval 历史生效。
- e2e：`/rewind` 选某消息 → 后续消息清空 → 前文对话仍可见。
- e2e：export → import 另一 cwd → session 列表里看得到。

## 风险与回退

- **风险**：rewind 删除重要历史；恢复不了。
  **缓解**：rewind 永远生成 **分支** session（保留原 session，新 session
  parent=原 session），默认不覆盖。
- **回退**：DB 向后兼容，新字段为空不影响旧功能。

## 不确定项

- Conversation arc 质量取决于 topic 检测；v1 的启发式准确率低，但对 UX
  影响小（arc 是信息性展示）。
