# ADR 0040 — P16d: DelegateTaskTool Rewrite (forkSubagentsBatch integration)

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P16d (P24 补遗 · AgentTool rewrite)
- **Preceding ADR:** ADR 0039 (P23 keybindings/vim/history)
- **Supersedes:** ADR 0026 (P16c) integration recipe

## Context

ADR 0026 (P16c) deferred the `DelegateTaskTool` rewrite because:
1. `createChildSession` needed P24 session persistence to be defined first.
2. The old wire format (`agent:/iterations:/final:`) would break all existing tests.
3. P16a/b/c had built all the required modules but not wired them together.

P24 session lifecycle (ADR 0034) is now complete. The `parentSessionId` field
exists in `SessionInput`. All P16 modules are stable. This ADR records the
rewrite.

## Decision

### 1. `DelegateTaskTool.execute` rewritten

The old implementation ran an inline `for` loop with a direct `provider.complete`
call and returned `agent:/iterations:/toolCalls:/final:/evidence:` output.

The new implementation:
1. Calls `resolveAgentAndTools()` to get a `BuiltInAgent` + allowed tool names.
2. Creates an `InMemoryChildSession` (implements `ForkableChildSession`).
3. Builds a `ForkChildRunner` via `buildRunChild()` — same iteration logic,
   but now tracks read files and accumulates usage into the child session.
4. Calls `forkSubagentsBatch(parentContext, [spec], { createChildSession, runChild })`.
5. Calls `renderAgentMemorySnapshot(outcome.result.snapshot)` for the output.

Output format changed from:
```
agent: explore
iterations: 2
toolCalls: 1
final:
delegated answer
evidence:
read_file: ...
```
to:
```
agent: explore

delegated answer

Files read: src/foo.ts

Usage: prompt=10 completion=5 total=15
```

### 2. Markdown agent prompt priority

When a markdown agent exists for the requested name, its `prompt` overrides
the built-in agent's `systemPrompt`. Previously the built-in agent's prompt
was used even when a markdown agent was found (because the `BuiltInAgent`
object was returned as-is).

### 3. Plan agent system prompt source

The old code used `getBuiltInAgentDefinition` from `agents.ts` (which has
`"task planning agent"` in the prompt). The new code uses `getBuiltInAgent`
from `subagents/built-in.ts` (which has `"planning subagent"`). Tests updated
to assert the new text.

### 4. `InMemoryChildSession`

A new private class implementing `ForkableChildSession` + `ForkableSessionView`.
Tracks messages, usage, and read files. No persistence — child sessions are
in-memory only (P24 session store integration deferred to a future phase when
`createChildSession` returns a persistent handle).

### 5. Tests updated

`test/core/delegate-task-tool.test.ts`:
- `"task planning agent"` → `"planning subagent"` (new prompt source)
- `"safe read output"` → `"delegated final answer"` + `"Files read: .env"`
  (new memory snapshot format)

All 4 existing tests pass.

## Consequences

### Positive

- `DelegateTaskTool` now uses the P16 subagent infrastructure as designed.
- Output is a structured memory snapshot — easier for the parent LLM to parse.
- Read file tracking enables the parent to avoid re-reading files the child
  already read.
- 1802 pass / 0 fail.

### Negative / accepted

- Child sessions are still in-memory (no persistence). The `parentSessionId`
  field in `SessionInput` is not yet used. Full persistence deferred.
- The old `evidence:` section is gone — tool outputs are no longer echoed
  verbatim in the parent's context. This is intentional (reduces context
  bloat) but may require prompt adjustments for some workflows.

## Alternatives considered

1. **Keep old format, add memory snapshot as extra section** — rejected:
   would double the output size and confuse the parent LLM.
2. **Use real SessionStore for child sessions** — deferred: requires
   `createChildSession` to return a persistent handle, which needs more
   SessionStore API work.

## Follow-ups

- Wire `parentSessionId` into child session creation when SessionStore
  supports it.
- Add `getWrittenNotes()` support to `InMemoryChildSession` for agents
  that use the `todowrite` tool.

## Validation

- `bun test test/core/delegate-task-tool.test.ts` — 4 pass.
- `bun run release:check` — 1802 pass / 0 fail, coverage PASS.
