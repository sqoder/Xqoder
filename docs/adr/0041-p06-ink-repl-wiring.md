# ADR 0041 — P06: Ink REPL Wiring (renderInkApp + useConversationStream)

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P06 (S7 · TUI)
- **Preceding ADR:** ADR 0040 (P16d DelegateTaskTool rewrite)
- **Supersedes:** —

## Context

Phase 06 was deferred to S7 (TUI last). P22 and P23 built the full Ink
component library (messages, diff, tools, input, keybindings, vim, history
search). This ADR records the final wiring: connecting the Ink components to
the real `AgentConversationPort` and switching `runTerminalApp` to use the
Ink REPL by default.

## Decision

### 1. `useConversationStream` hook

`src/platform/terminal/ink/hooks/useConversationStream.ts`

Bridges `AgentConversationPort.sendMessage` to React state via `useReducer`.

State shape:
```ts
interface ConversationState {
    messages: MessageEntry[];
    thinking: boolean;
    thinkingText: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    sessionId: string | undefined;
    pendingApproval: PendingApproval | null;
    pendingQuestion: PendingQuestion | null;
    isBusy: boolean;
    error: string | null;
}
```

Event mapping from `AgentRuntimeEvent` → reducer actions:
- `message.delta` → append to streaming assistant message
- `message.completed` → finalize assistant message
- `thought` → set thinking text
- `tool.called` → add tool message
- `tool.completed` → clear thinking
- `status.changed` → set thinking flag
- `usage` → accumulate tokens/cost
- `session.started` → capture sessionId from envelope
- `error` → set error state

Approval and question callbacks use `Promise` + `useRef` to bridge async
`onToolApproval` / `onQuestion` callbacks into React state.

### 2. `ApprovalDialog` component

`src/platform/terminal/ink/components/ApprovalDialog.tsx`

Keyboard-driven approval: `y`/`a` → allow, `n`/`d`/Esc → deny.
Blocks the prompt input while visible.

### 3. `InkApp` rewritten (P06 wiring)

`src/platform/terminal/ink/app.tsx` upgraded from the P22 stub to a fully
wired component:
- Accepts `agentService: AgentConversationPort` + `settings: TuiAgentSettings`
- Uses `useConversationStream` for all state
- Shows `ApprovalDialog` when `pendingApproval` is set
- Shows `HistorySearchDialog` for `pendingQuestion`
- `/cancel` command calls `agentService.cancel()`
- `/exit` / `/quit` calls Ink's `exit()`

### 4. `renderInkApp` entry point

`src/platform/terminal/ink/index.tsx`

```ts
export async function renderInkApp(options: RenderInkAppOptions): Promise<void> {
    const { waitUntilExit } = render(<InkApp ... />, { exitOnCtrlC: true });
    await waitUntilExit();
}
```

### 5. `runTerminalApp` switch

`src/platform/terminal/app/run-terminal-app.ts` now dynamically imports
`renderInkApp` when `XQODER_TUI !== 'classic'`:

```ts
if (process.env.XQODER_TUI !== 'classic') {
    const { renderInkApp } = await import('../ink/index.js');
    await renderInkApp({ runtime, settings, initialSessionId, ... });
} else {
    await runTerminalScrollbackShell(...);
}
```

Dynamic import keeps the headless / `--prompt` path free of Ink/React load
overhead. `XQODER_TUI=classic` is the one-line rollback.

## Consequences

### Positive

- Full Ink REPL is now the default interactive terminal experience.
- Streaming assistant messages, thinking blocks, tool approval dialogs, and
  history search all work through the same component tree built in P22/P23.
- `XQODER_TUI=classic` provides instant rollback to the readline shell.
- No new dependencies.
- 1802 pass / 0 fail.

### Negative / accepted

- `useConversationStream` does not persist history across sessions — history
  is in-memory only. Deferred to a follow-up.
- `pendingQuestion` reuses `HistorySearchDialog` as a quick option picker —
  not ideal UX but functional for v1.
- React component rendering tests require `ink-testing-library` (not
  installed); deferred.

## Alternatives considered

1. **Static import of Ink** — rejected: adds Ink/React to the headless
   startup path, increasing cold-start time.
2. **Keep readline as default, Ink as opt-in** — rejected: the 施工单
   specifies Ink as the default with `XQODER_TUI=classic` as the fallback.

## Follow-ups

- Persist input history to `~/.xqoder/history.json`.
- Wire `KeybindingProvider` into `InkApp`.
- Wire vim mode into `PromptInput`.
- `ink-testing-library` for component rendering tests.

## Validation

- `bun x tsc --noEmit` — 0 errors.
- `bun run release:check` — 1802 pass / 0 fail, coverage PASS.
- Manual: `XQODER_TUI=classic bun dist/index.js tui` → readline shell.
- Manual: `bun dist/index.js tui` → Ink REPL.
