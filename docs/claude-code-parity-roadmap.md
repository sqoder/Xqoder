# XQoder vs Claude Code: 2026 Gap Map and 90-Day Roadmap

## Goal

Refresh XQoder's competitor analysis against the current Claude Code surface, not the older terminal-only baseline.

This version was updated on 2026-04-17 using the current official Claude Code docs and the current XQoder codebase.

## Working Boundary

Recommended product boundary for the next 90 days:

- Keep XQoder local-first and terminal-first.
- Match Claude Code on agent execution quality, memory behavior, permissions, and session continuity before chasing a full Anthropic-style surface area.
- Treat IDE, desktop, web, and mobile as thin clients over a strong local execution core.
- Do not try to clone every Claude Code cloud feature immediately.

## Verified Claude Code Baseline

Claude Code is now broader than "a strong terminal coding agent". The current official surface includes:

- Terminal, IDE, desktop, browser/web, and mobile-connected workflows.
- Remote Control for continuing a local session from `claude.ai/code` or the Claude mobile apps while the work still runs on the developer machine.
- Claude Code on the web for remote cloud execution, session handoff, and parallel remote tasks.
- VS Code and JetBrains integrations with diff viewing, selection sharing, and diagnostics sharing.
- `CLAUDE.md`, `CLAUDE.local.md`, rules files, and auto memory.
- First-class command surfaces for permissions, MCP, memory, plugins, agents, remote control, and more.
- Custom subagents and experimental agent teams with task lists and mailboxes.
- Scheduled tasks, background monitoring, GitHub Actions automation, remote review, and remote planning features.

Representative official references:

- [Overview](https://code.claude.com/docs/en/overview)
- [Commands](https://code.claude.com/docs/en/commands)
- [Memory](https://code.claude.com/docs/en/memory)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [MCP](https://code.claude.com/docs/en/mcp)
- [IDE Integrations](https://code.claude.com/docs/en/ide-integrations)
- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Claude Code on the Web](https://code.claude.com/docs/en/claude-code-on-the-web)
- [Desktop](https://code.claude.com/docs/en/desktop)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Scheduled Tasks](https://code.claude.com/docs/en/scheduled-tasks)
- [Ultrareview](https://code.claude.com/docs/en/ultrareview)
- [Ultraplan](https://code.claude.com/docs/en/ultraplan)
- [Docs Map](https://code.claude.com/docs/en/claude_code_docs_map)

Notes from the current docs:

- The docs map says it was last updated on 2026-04-16 UTC.
- Remote Control requires Claude Code v2.1.51 or later.
- Scheduled tasks require v2.1.72 or later.
- Ultrareview requires v2.1.86 or later.
- Ultraplan requires v2.1.91 or later.

## What XQoder Already Has

The previous roadmap understated the current XQoder surface. Several earlier "gaps" are already closed:

1. `CLAUDE.md` is already the canonical project instruction file.
   - Config defaults already search `CLAUDE.md` and `CLAUDE.local.md`: `src/infra/shared/config.ts`
   - There is a real `memory` command for `show`, `path`, `init`, and `migrate`: `src/commands/system/memory.ts`

2. CLI already exposes first-class system surfaces, while the terminal shell intentionally stays small and scrollback-first.
   - `permissions`, `memory`, `hooks`, and `ide` exist as CLI commands: `src/commands/system/*`
   - The live terminal shell is centered on prompt entry and a minimal local command set via `src/interfaces/tui/index.ts` and `src/platform/terminal/app/run-terminal-app.ts`

3. Plugins, MCP, remote attach, and ACP are already in the default product lane.
   - Core, integrations, remote, and system plugin groups are enabled by default: `src/plugins/command-plugins.ts`
   - `plugin`, `mcp`, `serve`, `attach`, and `acp` are real command surfaces.

4. XQoder already has a lightweight working-memory layer.
   - Project notepad commands exist and are wired into the TUI: `src/application/system/notepad.ts`, `src/commands/system/notepad.ts`

5. The older CI/test complaints in the previous roadmap are mostly stale.
   - `package.json` now scopes tests to `./test` and `./src`
   - CI and platform workflows now install Bun and build from the current root layout

This changes the conclusion: the real Claude Code gap is no longer "missing top-level commands". It is the execution system behind those commands.

## Real Gaps Now

### P0: Execution Model Gap

Claude Code's advantage is now the productized agent loop:

- read, plan, edit, run, verify, retry
- background work
- parallel remote work
- team-style coordination
- review and planning features built on top of that execution substrate

XQoder currently has:

- built-in agent definitions: `src/core/agent/agents.ts`
- a read-only delegation tool: `src/core/agent/tools/agent-tool.ts`
- summarizer/title/task helper agents: `src/core/agent/sub-agents.ts`

But it does not yet have:

- writable worker agents with isolated execution environments
- a task graph or mailbox model
- worktree-based execution lanes
- background job orchestration
- integrated reviewer and verifier lanes
- an execution product that can grow into "team mode", "remote fix", or "autofix PR"

This is the primary gap.

### P0: Session Continuity Gap

Claude Code now separates three continuity modes clearly:

- local session plus Remote Control
- cloud session on Claude Code on the web
- handoff between local and remote surfaces

XQoder currently has solid primitives:

- local sessions
- `serve`
- `attach`
- ACP

But it does not yet have:

- remote control of a live local session from a second client
- reconnectable session brokering with durable session identities
- local-to-remote or remote-to-local handoff semantics
- background task monitoring across devices

The current `ide` command is only a status and attach-instructions surface, not a continuity system: `src/application/system/ide.ts`.

### P1: Memory Model Gap

Claude Code's memory model is now more than a single project file:

- `CLAUDE.md`
- `CLAUDE.local.md`
- rules files
- auto memory written by the system itself
- `/memory` as an inspection and control surface

XQoder has:

- canonical `CLAUDE.md`
- `CLAUDE.local.md` in default context paths
- project notepad in `.xqoder/notepad.md`

But the memory model is still split:

- `memory` is file-centric
- `notepad` is a separate side channel
- there is no system-written auto memory
- there is no provenance or lifecycle model for learned notes

XQoder should converge on one memory story instead of keeping `CLAUDE.md` and notepad as parallel concepts.

### P1: Permission And Policy Gap

Claude Code now has a much richer control plane:

- multiple permission modes
- deny-first permission rules
- managed settings
- auto mode with policy guidance
- stronger runtime interaction between permissions, hooks, MCP, and sandboxing

XQoder currently exposes:

- `allow | ask | deny` per-tool rules
- sandbox modes `project | paths | full-access`
- `disableAllHooks`

References:

- `src/infra/shared/types.ts`
- `src/infra/shared/schema.ts`
- `src/application/system/permissions.ts`
- `src/application/system/hooks.ts`

This is good foundation work, but it is still a narrower model than Claude Code's current policy surface.

### P1: IDE Surface Gap

Claude Code has real IDE products now, not just "run the CLI in a terminal":

- VS Code integration
- JetBrains integration
- diff viewing in the IDE
- selection sharing
- diagnostics sharing
- remote-control entry points from IDE surfaces

XQoder currently has:

- IDE detection
- local attach instructions
- ACP and HTTP attach primitives

But it does not yet have:

- an IDE extension
- editor selection/context sharing
- diagnostics push from editor to agent
- integrated diff review in the editor

### P2: Cloud And Automation Gap

Claude Code's newer differentiators are increasingly cloud-backed:

- Claude Code on the web
- Cowork in Desktop
- Ultraplan
- Ultrareview
- GitHub Actions automation
- scheduled tasks and routines

XQoder should not copy all of this immediately, but it does need a position.

Right now the codebase has almost none of this layer:

- no web session runtime
- no remote planner/reviewer mode
- no scheduled task subsystem
- no PR automation equivalent
- no multi-agent review product

### P2: Teaming Gap

Claude Code now distinguishes between:

- subagents for focused delegated work
- agent teams for independent collaborators with a shared task list and mailbox

XQoder currently only has the first half, and even that is read-only.

There is no equivalent of:

- teammate-to-teammate messaging
- shared task claiming
- coordinated worktree execution
- explicit leader plus worker runtime

## Recommended 90-Day Plan

## Days 1-14: Build The Execution Substrate

### Objective

Turn XQoder from "good single-session agent" into "execution runtime that can support Claude Code-like workflows".

### Scope

1. Define an execution kernel in the target architecture.
   - `src/application`: job orchestration, task graph, execution state, verifier flow
   - `src/domain`: task state model, agent role model, permission profile model
   - `src/infrastructure`: worktree manager, background process runners, durable job store
   - `src/interfaces`: CLI/TUI views over the same execution kernel

2. Replace read-only delegation with role-based worker jobs.
   - Start with local workers before any cloud work.
   - Workers should support at least:
     - explore
     - implement
     - verify

3. Add durable background job tracking.
   - Job list
   - status transitions
   - resume/cancel
   - structured evidence output

### Acceptance Criteria

- One parent task can spawn at least two isolated worker jobs.
- Workers can produce structured summaries plus verification evidence.
- The leader session can inspect running and completed jobs.
- No new reusable business logic lands in `src/services` or `src/commands`.

## Days 15-45: Unify Memory, Permissions, And Continuity

### Objective

Close the biggest user-visible gap between "local coding agent" and "real agent product".

### Scope

1. Unify memory.
   - Keep `CLAUDE.md` as canonical project memory.
   - Add `CLAUDE.local.md` and notepad provenance to one visible memory model.
   - Introduce auto-written memory entries with approval or review controls.

2. Extend permissions from a simple config editor into a control plane.
   - Add richer permission modes.
   - Add recent denials / effective policy inspection.
   - Define how hooks, MCP, and sandbox rules interact.

3. Build a Remote Control-style local session broker.
   - Continue a live session from another XQoder client surface.
   - Reconnect after interruption.
   - Support session naming and durable session identity.

### Acceptance Criteria

- `/memory` shows all active memory sources, not just one file.
- The system can write and inspect auto memory notes.
- A local XQoder session can be resumed or controlled from a second client without losing state.
- Permission state is inspectable enough to explain why a tool call was allowed, denied, or prompted.

## Days 46-90: Add Thin Surfaces And Automation

### Objective

Expose the stronger core through thin integrations instead of building a giant product shell first.

### Scope

1. IDE MVP.
   - VS Code first.
   - Send active file/selection context to the running session.
   - Show diffs and diagnostics in the editor.

2. Teaming MVP.
   - Shared task list
   - worker roles
   - mailbox
   - optional worktree isolation

3. Automation MVP.
   - scheduled local prompts
   - PR review / CI follow-up hooks
   - one reviewer lane built on top of the worker runtime

### Acceptance Criteria

- VS Code can attach to a live XQoder session and contribute editor context.
- The leader session can coordinate a small team of local workers through a shared task list.
- XQoder can schedule at least local recurring follow-up work.
- There is a documented decision on what stays local and what, if anything, moves to managed remote infrastructure later.

## Backlog Order

1. Execution kernel
2. Writable worker jobs
3. Background job tracking
4. Memory unification
5. Permission control-plane upgrade
6. Remote Control-style continuity
7. IDE MVP
8. Teaming
9. Automation
10. Any cloud-backed feature

## Explicit Non-Goals For Now

- Rebuilding the full Claude desktop app
- Matching every Anthropic cloud feature
- Mobile-native UI work before continuity exists
- Enterprise admin surfaces before the local execution model is stable

## Bottom Line

XQoder is no longer obviously behind on command surfaces. It is behind on the system that makes those surfaces feel like a coherent agent product.

The correct comparison to Claude Code in 2026 is:

- not "does XQoder have `/memory`?"
- but "can XQoder run, coordinate, verify, resume, and steer work across time and surfaces?"

That is the gap to close next.
