# ADR 0039 — P23 Keybindings / Vim / History Search

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P23 (S6 · Keybindings / Vim / History)
- **Preceding ADR:** ADR 0038 (P22 Ink components)
- **Supersedes:** —

## Context

Phase 22 built the Ink component library. Phase 23 adds the interactive
input layer: keybinding registry, vim modal editing, and fuzzy history search.

## Decision

### 1. `src/platform/terminal/ink/keybindings/`

| File | Description |
|------|-------------|
| `defaults.ts` | 21 default bindings (cancel, exit, history-search, scroll, vim-toggle, etc.) |
| `match.ts` | `matchKeys(input, key)` → normalized key string; `keysMatch()` for lookup |
| `load-user.ts` | Loads `~/.xqoder/keybindings.json`, merges with defaults by `id` |
| `context.tsx` | `KeybindingProvider` + `useKeybindings()` React context |

`matchKeys` normalizes Ink key events to strings like `'ctrl+c'`, `'shift+tab'`,
`'escape'`. User overrides are merged by `id` — unknown ids are appended.

### 2. `src/platform/terminal/ink/vim/`

| File | Description |
|------|-------------|
| `state.ts` | `VimState` (mode, cursor, register, pendingOperator), `createVimState()` |
| `motions.ts` | `applyMotion()`: h/j/k/l/w/b/e/0/$/gg/G |
| `operators.ts` | `applyOperator()`: d/y/c + `pasteRegister`, `deleteLine`, `yankLine` |
| `transitions.ts` | `processNormalKey()` + `processInsertKey()` state machine |

Vim state machine covers:
- **Normal mode**: motions, operators (d/y/c + motion), dd/yy, x, p/P, i/I/a/A/o/O/s/S
- **Insert mode**: character insertion, backspace, escape (→ normal), return (submit)
- **Operator pending**: d+motion, y+motion, c+motion

`XQODER_DISABLE_VIM=1` env var can be used to skip vim registration (not
enforced in this module — caller responsibility).

### 3. `src/platform/terminal/ink/components/HistorySearchDialog.tsx`

Fuzzy history search using minimum edit distance (Levenshtein, ≤60 lines).
Scoring: exact substring > prefix > edit distance. `searchHistory(query, items, limit)`
is exported for testing without React.

The dialog handles: ↑↓ navigation, Enter to select, Esc to cancel, character
input to refine query.

### 4. Tests

`test/platform/ink-p23.test.ts` — 53 tests:
- `matchKeys` (10 cases)
- `keysMatch` (2 cases)
- `DEFAULT_KEYBINDINGS` (4 cases)
- `loadUserKeybindings` (1 case)
- `applyMotion` (10 cases)
- `applyOperator` (3 cases)
- `pasteRegister` (3 cases)
- `deleteLine / yankLine` (2 cases)
- `processNormalKey` (5 cases)
- `processInsertKey` (4 cases)
- `fuzzyScore` (4 cases)
- `searchHistory` (5 cases)

## Consequences

### Positive

- Full keybinding registry with user override support.
- Vim modal editing covers the 30% most-used subset (sufficient for 80% of
  daily input scenarios per the 施工单).
- Fuzzy history search with edit distance ranking.
- No new third-party deps.
- 1802 pass / 0 fail.

### Negative / accepted

- Vim visual mode is not implemented (state type exists but no transitions).
  Deferred to a follow-up.
- `HistorySearchDialog` is a standalone component — not yet wired into
  `InkApp`. Wiring deferred to P23 follow-up or P24.
- `KeybindingProvider` is not yet used in `InkApp` — deferred.

## Alternatives considered

1. **Use `fuse.js` for fuzzy search** — rejected: adds a dep; the edit
   distance implementation is ≤60 lines and sufficient for history search.
2. **Full vim implementation** — rejected: the 施工单 explicitly scopes to
   30% most-used subset for v1.

## Follow-ups

- Wire `KeybindingProvider` into `InkApp`.
- Wire `HistorySearchDialog` into `InkApp` on `ctrl+r`.
- Implement vim visual mode.
- P24: Session lifecycle (already done as ADR 0034).

## Validation

- `bun test test/platform/ink-p23.test.ts` — 53 pass.
- `bun run release:check` — 1802 pass / 0 fail, coverage PASS.
