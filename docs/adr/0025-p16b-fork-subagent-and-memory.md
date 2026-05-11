# 0025 · P16b — forkSubagent + AgentMemory snapshot

- Status: Accepted
- Date: 2026-05-11
- Phase: P16b

## Context

P16a shipped the built-in subagent registry + markdown frontmatter extension.
P16b adds the pure data contracts for forking a subagent and snapshotting its
memory back to the parent. P16c will wire this into the real AgentTool and
run it against `runConversationTurn`.

## Decisions

### 1) `ForkableSessionView` — minimal read-only session surface

Instead of taking a dependency on the full `AgentSession` class, we declare
the smallest interface the memory snapshot needs:

```ts
interface ForkableSessionView {
    getMessages(): readonly LLMMessage[];
    getUsage(): AgentMemoryUsage;
    getReadFiles?(): readonly string[];
    getWrittenNotes?(): readonly AgentMemoryNote[];
}
```

`getReadFiles` and `getWrittenNotes` are optional — today's `AgentSession`
does not track either, and P16c will add them only to the child session
spawned by fork.

### 2) Deduplication + order preservation for readFiles

`snapshotSubagentMemory` dedupes readFiles but keeps first-seen order. A
subagent that read `a.ts → b.ts → a.ts` reports `[a.ts, b.ts]`. This
matters because the parent may cite these files by index, and order is a
stable hint about what was relevant first.

### 3) Composition, not mutation, for system prompts

`buildSubagentSystemPrompt` returns a string by concatenating:

```
<agent.systemPrompt>

Parent context:
<parent.baseSystemPrompt>

<extraSystem>
```

The child session does not inherit the parent's full system; it inherits
the parent's project-scoped prefix. That keeps subagent context light and
prevents subtle leaks of parent conversation state into a read-only
subagent.

### 4) `forkSubagent` injects both child factory and runner

```ts
forkSubagent(parent, spec, { createChildSession, runChild })
```

- `createChildSession` returns the session; in P16c it will be
  `parent.store.createSubagent(spec)`
- `runChild` drives the conversation; in P16c it will be a thin wrapper
  around `runConversationTurn`

This keeps the forking logic testable without any real LLM I/O.

### 5) `assertToolsAllowed` + `findFinalAssistantContent` as public helpers

Both are small utilities P16c will reuse; exposing them in the barrel keeps
the fork module cohesive and avoids reinventing pattern matching in two
places.

### 6) `renderAgentMemorySnapshot` — canonical tool_result format

Subagent results flow back to the parent LLM as a `tool_result` string.
Making that string deterministic and authoring it here (not in the
AgentTool) means tests can lock the wire format and human readers (the
parent model) see consistent structure.

## Validation

- `bun run release:check`: **1318 pass / 0 fail** (P16a 1298 → +20),
  coverage 69.77% (+0.06%).
- 20 new tests across memory.test.ts (10) + fork.test.ts (10) covering:
  finalResponse extraction, optional-method sessions, dedup+order, usage
  passthrough, render formatting, snapshot happy path, runner error
  propagation, tool whitelist patterns, assistant content scan.

## Red-line footprint

Zero. All additions under `src/core/agent/subagents/`.

## Files

Added:
- `src/core/agent/subagents/fork.ts` (~130L)
- `src/core/agent/subagents/memory.ts` (~115L)
- `test/core/agent/subagents/fork.test.ts` (10 tests)
- `test/core/agent/subagents/memory.test.ts` (10 tests)
- `docs/adr/0025-p16b-fork-subagent-and-memory.md` (this file)

Modified:
- `src/core/agent/subagents/index.ts` (barrel expansion)

## Deferred

- AgentTool wiring → P16c
- 4-way concurrency cap → P16c
- e2e driving 3 explore subagents in parallel → P16c
- `resumeAgent` (cross-process subagent resume) — out of scope for P16,
  lands with P24 session lifecycle.
