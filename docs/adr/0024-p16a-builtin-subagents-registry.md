# 0024 · P16a — Built-in subagent registry + markdown-agent frontmatter extension

- Status: Accepted
- Date: 2026-05-11
- Phase: P16a

## Context

P16 ships the AgentTool upgrade: five built-in subagents, markdown
agents, forkSubagent, and AgentMemory. P16 splits a/b/c:

- **P16a (this phase)**: pure registry + markdown frontmatter parser
  extension. Zero AgentTool / session wiring.
- P16b: forkSubagent + AgentMemory snapshot module.
- P16c: wire forkSubagent into AgentTool + concurrency cap + e2e.

## Decisions

### 1) Built-in agents as a frozen registry

`BUILT_IN_AGENTS` is `Object.freeze(...)`. Five entries:

| name               | tools                                                        | concurrencySafe |
|--------------------|--------------------------------------------------------------|-----------------|
| explore            | read_file, grep_content, glob_files, list_files, lsp_*       | true            |
| plan               | read_file, grep_content, glob_files, list_files              | true            |
| general-purpose    | *                                                             | false           |
| verification       | read_file, run_shell                                         | false           |
| claude-code-guide  | read_file, grep_content, lsp_*                               | true            |

`concurrencySafe` is the signal for P16c: read-only subagents can fan
out up to the 4-way cap, while write/shell agents serialize.

### 2) Tool pattern support: exact + trailing `*`

`filterToolsForAgent(pool, agent)` keeps the intersection. `['*']`
means everything. Single-glob trailing star (`lsp_*`) matches prefix.
No regex / fnmatch — keeps matching deterministic and fast in the
hot path.

### 3) System prompts authored here

We do not copy OpenClaude prompts. Prompts are short, role-scoped,
and make the subagent boundaries explicit (e.g. verification: do not
fix failures).

### 4) Markdown agent frontmatter extension

Added fields:
- `provider` (free-form string)
- `model` (already existed; untouched)
- `baseUrl` (+ `base_url` snake_case alias)
- `color` (free-form string)

Unknown / empty fields stay `undefined`. No schema validation beyond
type + trim — the markdown agent loader (P16c) enforces when
instantiating.

## Validation

- `bun run release:check`: **1298 pass / 0 fail**, coverage 69.71%.
  (One unrelated test timed out on the first run under parallel
  load, passed cleanly on immediate rerun — flaky, not introduced
  here.)
- 15 new tests: 9 for built-in registry matching + concurrency
  properties, 3 for frontmatter extension, 3 for alias / missing-field
  behavior.

## Red-line footprint

Soft-redline touch: `src/core/agent/markdown-agents.ts` gained three
new optional fields (provider / baseUrl / color). Additive.

## Files

Added:
- `src/core/agent/subagents/built-in.ts` (~150L)
- `src/core/agent/subagents/index.ts` (barrel)
- `test/core/agent/subagents/built-in.test.ts` (9 tests)
- `test/core/agent/markdown-agents-extension.test.ts` (3 tests)
- `docs/adr/0024-p16a-builtin-subagents-registry.md` (this file)

Modified:
- `src/core/agent/markdown-agents.ts` (+ provider / baseUrl / color)

## Deferred

- **forkSubagent** — P16b
- **AgentMemory + snapshot** — P16b
- **AgentTool integration + concurrency cap** — P16c
