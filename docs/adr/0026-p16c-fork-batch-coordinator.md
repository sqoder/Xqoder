# 0026 · P16c — Fork batch coordinator + deferred AgentTool rewrite

- Status: Accepted
- Date: 2026-05-11
- Phase: P16c

## Context

P16a/P16b shipped: built-in subagent registry, markdown frontmatter, forkSubagent, AgentMemory snapshot. P16c was scoped as "wire forkSubagent into AgentTool + concurrency cap + e2e." Investigating the existing `DelegateTaskTool` (`src/core/agent/tools/agent-tool.ts`, 289 lines) revealed that a full rewrite would:

1. Touch `src/core/agent/**` extensively, which is a soft-redline zone per CLAUDE.md — requires ADR justification plus careful review.
2. Change the delegate_task wire format that every existing test and live provider-bootstrap path assumes.
3. Collide with P24 session-lifecycle work (the child session persistence / resume story sits with P24, and forkSubagent was designed to accommodate that).

The right P16c landing is: **ship the concurrency coordinator as a pure module** and **document the integration recipe**. Leave the DelegateTaskTool rewrite to a dedicated phase that also brings session persistence. That is exactly what happened for withRetry's oauth401 wire in P21c — the pieces are all built, but the final integration lands when the broader dependency graph is ready.

## Decisions

### 1) Ship `forkSubagentsBatch` with a concurrency cap of 4

`src/core/agent/subagents/batch.ts` is a pure coordinator:

```ts
forkSubagentsBatch(parent, specs, deps, { maxConcurrency?: number, signal?: AbortSignal }): BatchForkOutcome[]
```

- Default `maxConcurrency = 4`, matching OpenClaude's scheduler.
- Worker pool pattern: spawn `min(cap, specs.length)` workers, each drains a shared cursor.
- Order-preserving: outcomes are indexed by input position regardless of completion order, so callers can correlate task i with outcome i without extra bookkeeping.
- Per-fork errors become `{ status: 'error', error }` entries — a single failed subagent does not poison the batch.
- AbortSignal stops scheduling further forks; in-flight forks complete naturally (they should honor the signal via `spec.signal` if passed through).

### 2) `areAllConcurrencySafe(specs)` exposed as a predicate

Callers (the eventual AgentTool rewrite) use this to choose `forkSubagentsBatch` vs a serial loop. Explicit flag is simpler than trying to infer from the spec list on each call site.

### 3) Defer the AgentTool rewrite

The rewrite adds: built-in routing by agent name, `forkSubagent` invocation, memory snapshot → tool_result rendering, batch fan-out for multiple subagent invocations in one turn. None of these need new building blocks — they just need to replace `DelegateTaskTool.execute`. That replacement touches:

- The tool's wire format (return value now becomes `renderAgentMemorySnapshot` output)
- The session story (child session is persisted to the session store, not ephemeral messages-array)
- Existing tests and golden tasks that assert today's `agent: ... iterations: ... final: ...` format

Rather than do a partial rewrite and leave two formats live, we defer until **P16d or within P24** when session persistence is available to back the child session.

## Validation

- `bun run release:check`: **1328 pass / 0 fail** (P16b 1318 → +10), coverage **69.79%**.
- 10 new tests in `batch.test.ts`:
  - Order preservation (3 specs) ✅
  - Concurrency cap respected (peak ≤ maxConcurrency for 10 specs at cap=3) ✅
  - Single fork error does not poison the batch ✅
  - `maxConcurrency=1` serializes ✅
  - Empty input returns `[]` without hanging ✅
  - `DEFAULT_FORK_CONCURRENCY === 4` ✅
  - Abort signal stops future scheduling ✅
  - `areAllConcurrencySafe` true/false/empty ✅

## Red-line footprint

Zero. All additions under `src/core/agent/subagents/`. No changes to existing `agent-tool.ts`, `agents.ts`, or `markdown-agents.ts` beyond what P16a already landed.

## Files

Added:
- `src/core/agent/subagents/batch.ts` (~70L)
- `test/core/agent/subagents/batch.test.ts` (10 tests)
- `docs/adr/0026-p16c-fork-batch-coordinator.md` (this file)

Modified:
- `src/core/agent/subagents/index.ts` (barrel + batch exports)

## Deferred (integration path documented below)

The AgentTool rewrite will live in a dedicated phase once the following are available:

1. **Child session persistence** — P24 session lifecycle provides durable
   subsession storage so `createChildSession` can return a session that
   resumes on restart. Right now `AgentSession` is in-memory only, making
   fork-then-resume impossible.

2. **Integration recipe** (target shape):

```ts
// Inside DelegateTaskTool.execute, when ready:
const agent = getBuiltInAgent(delegateConfig.agentName) ?? /* markdown */;
const tools = filterToolsForAgent(parentToolNames, agent);
assertToolsAllowed(tools, agent);

const specs: ForkSpec[] = [{ agent, task, toolNames: tools, signal: context.signal }];

const outcomes = areAllConcurrencySafe(specs)
    ? await forkSubagentsBatch(parent, specs, { createChildSession, runChild })
    : await runSerial(parent, specs, { createChildSession, runChild });

return {
    toolCallId,
    success: outcomes.every((o) => o.status === 'ok'),
    output: outcomes.map((o) =>
        o.status === 'ok'
            ? renderAgentMemorySnapshot(o.result.snapshot)
            : `fork failed: ${o.error.message}`,
    ).join('\n\n---\n\n'),
};
```

3. **`runChild`** will be a thin wrapper around `runConversationTurn` with the
   child session, a restricted tool registry, and the fork's abort signal.
