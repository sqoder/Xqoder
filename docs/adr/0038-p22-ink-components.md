# ADR 0038 — P22 Ink Messages / Diff / Tools / Input Components

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P22 (S6 · Ink UI components)
- **Preceding ADR:** ADR 0037 (P27 Tools complete catalog)
- **Supersedes:** —

## Context

Phase 06 built the Ink skeleton (scrollback shell). Phase 22 adds the full
component library: messages, markdown, diff, tools, input, chrome, and hooks.
These components are used by the Ink app (`app.tsx`) and can be composed into
a full interactive TUI.

## Decision

### 1. `src/platform/terminal/ink/components/messages/`

| File | Description |
|------|-------------|
| `MessageTimestamp.tsx` | Dimmed `HH:MM:SS` timestamp |
| `UserMessage.tsx` | Cyan bordered box with "You" header |
| `AssistantMessage.tsx` | Green "XQoder" header + optional ThinkingBlock + streaming cursor |
| `ThinkingBlock.tsx` | Collapsible thinking/reasoning block (Tab to expand) |
| `MessageList.tsx` | Renders last N messages (virtual scroll approximation) |

### 2. `src/platform/terminal/ink/components/markdown/`

| File | Description |
|------|-------------|
| `Markdown.tsx` | Headings (colored by level), bullets, bold/italic/inline-code, fenced code blocks |
| `HighlightedCode.tsx` | Keyword-based syntax highlighting for TS/JS/Python; line numbers |

No third-party syntax highlighter — keyword sets are hardcoded for the three
most common languages. `highlight.js` deferred to a follow-up.

### 3. `src/platform/terminal/ink/components/chrome/`

| File | Description |
|------|-------------|
| `Spinner.tsx` | Animated `◐◓◑◒` spinner with configurable label |
| `StatusBar.tsx` | Bottom bar: model · mode · tokens · cost · sessionId |

### 4. `src/platform/terminal/ink/components/diff/`

| File | Description |
|------|-------------|
| `FileDiff.tsx` | Unified diff with green `+` / red `-` lines; truncates at `maxLines` |
| `StructuredDiff.tsx` | Multi-file diff with total add/del summary |

`parseDiffLines(raw)` is exported for testing without React.

### 5. `src/platform/terminal/ink/components/tools/`

| File | Description |
|------|-------------|
| `ToolBlock.tsx` | Tool call with status icon, args preview, expandable output (Tab) |
| `ToolUseLoader.tsx` | Spinner while tool is running |

### 6. `src/platform/terminal/ink/components/input/`

| File | Description |
|------|-------------|
| `TextInput.tsx` | Single-line input with cursor, Ctrl+A/E/K/U, arrow keys |
| `PromptInput.tsx` | Prompt input with `> ` prefix, history navigation (↑↓) |

### 7. `src/platform/terminal/ink/hooks/`

| File | Description |
|------|-------------|
| `useArrowKeyHistory.ts` | History navigation state (up/down, draft save/restore) |
| `useVirtualScroll.ts` | Viewport scroll state (offset, visibleRange, isAtBottom) |
| `usePasteHandler.ts` | 50ms debounce paste detection |

### 8. `src/platform/terminal/ink/app.tsx`

Top-level `InkApp` component wiring all P22 components. Accepts `messages`,
`thinking`, `model`, `sessionId`, `cost`, `mode`, `history`, `onSubmit`.

### 9. Tests

`test/platform/ink-components.test.ts` — 18 tests covering:
- `parseDiffLines` (7 cases)
- `useVirtualScroll` math (5 cases)
- `useArrowKeyHistory` logic (6 cases)

React component rendering tests require `ink-testing-library` (not installed);
deferred to a follow-up.

## Consequences

### Positive

- Full Ink component library available for P23 (keybindings/vim) and future
  interactive TUI work.
- No new third-party deps (uses `ink` + `react` already in package.json).
- Pure-logic tests cover the most complex state machines (diff parsing,
  virtual scroll, history navigation).
- 1749 pass / 0 fail.

### Negative / accepted

- `HighlightedCode` uses keyword-based highlighting only — no semantic
  understanding. Acceptable for v1.
- `usePasteHandler` uses a 50ms debounce heuristic — may misclassify fast
  typing as paste on slow terminals. Acceptable for v1.
- React component rendering tests deferred (need `ink-testing-library`).

## Alternatives considered

1. **Use `highlight.js`** — rejected: adds a large dep; keyword-based
   highlighting is sufficient for the terminal use case.
2. **Use `react-testing-library`** — rejected: requires `ink-testing-library`
   which is not in the project; pure-logic tests cover the critical paths.

## Follow-ups

- P23: Keybindings + Vim mode.
- Later: `ink-testing-library` for full component rendering tests.
- Later: `highlight.js` for proper syntax highlighting.
- Later: Wire `InkApp` into `runTerminalApp` as an alternative to the
  scrollback shell.

## Validation

- `bun test test/platform/ink-components.test.ts` — 18 pass.
- `bun run release:check` — 1749 pass / 0 fail, coverage PASS.
