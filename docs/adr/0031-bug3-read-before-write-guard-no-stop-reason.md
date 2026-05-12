---
id: "0031"
title: "Bug 3 — read-before-write guard must not set stopReason=permission_denied"
date: 2026-05-12
status: accepted
---

## Context

`write_file`, `edit_file`, and `apply_patch` all call `validateExistingFileWasFullyRead()` before
modifying an existing file. When the guard fires it returned a `ToolResult` with
`metadata: { stopReason: 'permission_denied' }`.

`resolveToolExecutionStopReason` in `tool-orchestrator.ts` treats any `stopReason === 'permission_denied'`
as a terminal signal and halts the agent loop. The model never sees the error message and cannot
self-recover by issuing a `read_file` first.

Observed in the live golden-task session (2026-05-12): qwen-plus task 3 received the guard error,
steps=0, and the run was reported as a hard failure.

## Decision

Remove `stopReason: 'permission_denied'` from the three guard returns:

- `src/core/agent/tools/file-tools.ts` — `write_file` guard
- `src/core/agent/tools/file-tools.ts` — `edit_file` guard
- `src/core/agent/tools/patch-tool.ts` — `apply_patch` guard

`stopReason: 'permission_denied'` is reserved for **explicit user denial** (user clicks "Deny" in
the approval flow). A read-before-write guard is a **guidance error** — the model made a sequencing
mistake and should be told to fix it. Returning it as a plain failed tool result lets the model
read the error, issue `read_file`, and retry the write on the next turn.

## Consequences

- Agent loop continues after a read-before-write guard fires; the model can self-recover.
- No change to the guard logic itself — the invariant is still enforced.
- `stopReason: 'permission_denied'` semantics are now strictly "user denied approval".
- Test added: `test/core/file-tool-deep-mechanics.test.ts` — "read-before-write guard errors do not
  carry stopReason=permission_denied".
