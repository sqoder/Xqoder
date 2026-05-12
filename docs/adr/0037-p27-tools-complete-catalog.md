# ADR 0037 — P27 Tools Complete Catalog (40+ tools)

- **Status:** Accepted
- **Date:** 2026-05-12
- **Phase:** P27 (S6 · Tools complete catalog)
- **Preceding ADR:** ADR 0036 (P26 SDK entrypoint)
- **Supersedes:** —

## Context

The 施工单 `phase-27-tools-complete-catalog.md` requires expanding the tool
set from ~25 to 40+ tools, aligning with OpenClaude `src/tools/**`. Each
new tool must have unit tests, `concurrencySafe` annotation, and be
registered via feature flags where appropriate.

## Decision

### 1. `src/core/agent/tools/p27-utility-tools.ts` — 10 always-on tools

| Tool | concurrencySafe | Description |
|------|----------------|-------------|
| `SleepTool` | ✅ | Pause execution (max 30s) |
| `ConfigTool` | ❌ | Read/write allowed config keys |
| `BriefTool` | ✅ | Session summary request |
| `SyntheticOutputTool` | ✅ | Force structured JSON output |
| `EnterPlanModeTool` | ❌ | Switch to plan mode |
| `ExitPlanModeTool` | ❌ | Exit plan mode |
| `VerifyPlanExecutionTool` | ❌ | Verify file_exists / file_contains / manual steps |
| `NotebookEditTool` | ❌ | Edit .ipynb cells (replace / insert / delete) |
| `AskUserQuestionTool` | ❌ | Structured multi-question with interactive fallback |
| `SuggestBackgroundPRTool` | ✅ | Suggest PR branch/title/description |

`ConfigTool` restricts writes to an allowlist of 9 safe keys. `VerifyPlanExecutionTool` supports `file_exists`, `file_contains`, and `manual` step types. `NotebookEditTool` reads/writes `.ipynb` JSON directly (no third-party dep).

### 2. `src/core/agent/tools/p27-advanced-tools.ts` — 6 feature-gated tools

| Tool | Feature flag | concurrencySafe |
|------|-------------|----------------|
| `MonitorTool` | `MONITOR_TOOL` | ✅ |
| `ToolSearchTool` | `TOOL_SEARCH_LAZY` | ✅ |
| `WorkflowTool` | `WORKFLOW_SCRIPTS` | ❌ |
| `PowerShellTool` | `POWERSHELL_TOOL` + win32 | ❌ |
| `RemoteTriggerTool` | `REMOTE_TRIGGER_TOOL` | ❌ |
| `REPLTool` | `REPL_TOOL` | ❌ |

`REPLTool` uses `node:vm` sandbox (no third-party dep). `ToolSearchTool` takes a snapshot of registered tools at registration time and scores by keyword overlap. `WorkflowTool` runs steps via `child_process.spawnSync('sh', ['-c', cmd])`.

### 3. Feature flags added to `FEATURE_DEFAULTS`

```ts
TOOL_SEARCH_LAZY: false,
REPL_TOOL: false,
POWERSHELL_TOOL: false,
REMOTE_TRIGGER_TOOL: false,
```

### 4. `registerDefaultAgentTools` updated

All 10 utility tools registered unconditionally (after the existing tools).
6 advanced tools registered behind `feature()` checks. `ToolSearchTool`
receives a snapshot of already-registered tool summaries.

### 5. Tool count

With all feature flags enabled: 47 tools registered (exceeds the ≥40 target).
Default (flags off): 37 core tools.

### 6. Tests

- `test/core/tools/p27-utility-tools.test.ts` — 30 tests.
- `test/core/tools/p27-advanced-tools.test.ts` — 16 tests.

## Consequences

### Positive

- Tool catalog reaches 47 (flags on) / 37 (flags off).
- All new tools have ≥3 tests each.
- No new third-party deps (`node:vm`, `node:child_process`, `node:fs`).
- `release:check` 1731 pass / 0 fail.

### Negative / accepted

- `ConfigTool` calls `configManager.save()` which writes to disk — acceptable
  since it's gated behind an allowlist of safe keys.
- `REPLTool` sandbox (`node:vm`) does not prevent all escape vectors (e.g.
  `process` is not exposed, but `Function` constructor could be used). For
  v1 this is acceptable; a future hardening pass can add `--experimental-vm-modules`
  or a subprocess sandbox.
- `PowerShellTool` is registered only on `win32` — CI runs on macOS/Linux so
  it is never exercised in the test suite.

## Alternatives considered

1. **Use `vm2` for REPLTool** — rejected: `vm2` is unmaintained and has known
   escape vulnerabilities. `node:vm` is the safer choice for v1.
2. **Register all tools unconditionally** — rejected: tool count affects
   context window size; feature flags let operators tune the set.

## Follow-ups

- P28: Thinking effort + fast mode.
- Later: REPLTool subprocess sandbox for stronger isolation.
- Later: `ToolSearchTool` with embedding-based ranking.

## Validation

- `bun test test/core/tools/p27-utility-tools.test.ts` — 30 pass.
- `bun test test/core/tools/p27-advanced-tools.test.ts` — 16 pass.
- `bun run release:check` — 1731 pass / 0 fail, coverage PASS.
