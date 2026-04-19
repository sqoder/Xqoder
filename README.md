# XQoder

XQoder is a terminal-native AI coding agent.

As of **2026-03-08**, the product direction is **OpenCode parity first**:

1. Align `CLI / TUI / Session / Auth / Config / Agents`
2. Align `stats / export / import / share / undo / redo`
3. Add `serve / web / attach / ACP / IDE`
4. Bring XQoder's workflow features back to the default experience after parity is complete

## Current Capabilities

The following foundations are already in place and will continue to be reused:

- `chat`: persistent project conversations with automatic session resume
- `session`: inspect stored sessions, summaries, and history
- `stats / export / import / share`: manage local session assets
- `rollbacks`: inspect and restore local rollback points
- `mcp`: connect external MCP servers
- `lsp`: connect built-in and external language servers

These workflow commands remain available, but they are currently treated as secondary capabilities until OpenCode parity is complete:

- `build`
- `fix`
- `run`
- `test`
- `deploy`

## Requirements

- Node.js 22+
- Bun 1.3+

Node 22+ is required because XQoder persists chat sessions in SQLite.

## Quick Start

```bash
bun install
bun run build

bun run xqoder -- auth login openai --api-key <your-key>
bun run xqoder -- models use gpt-4.1 --provider openai
bun run xqoder -- auth list
bun run xqoder -- models list
bun run xqoder -- agent list
bun run xqoder -- chat "Take a first look at this project"
bun run xqoder -- session list
bun run xqoder -- stats
bun run xqoder -- share list
```

If you prefer writing a config file in one step, `config init` still works:

```bash
bun run xqoder -- config init --provider openai --api-key <your-key>
```

If you want to expose the local repository as a global CLI entrypoint:

```bash
bun link --global
xqoder chat "Continue the previous session"
```

## Architecture

The repository is being migrated toward a strong-boundary modular monolith so future features have a stable landing zone.

- High-level target: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Migration plan: [docs/architecture-migration-roadmap.md](./docs/architecture-migration-roadmap.md)

New code should converge on:

- `src/bootstrap`
- `src/interfaces`
- `src/application`
- `src/domain`
- `src/infrastructure`
- `src/shared`

Current stable execution still crosses several legacy directories during migration, especially `src/cli`, `src/core`, `src/platform`, `src/infra`, and `src/plugins`. Treat them as compatibility surfaces. Do not add new reusable logic to `src/commands`, `src/core`, `src/platform`, `src/infra`, or `src/services`; land it in the target layers instead.

The repo keeps this direction honest with guardrail tests for layer imports, terminal-shell command drift, public-doc portability, a strict TypeScript pass for `domain/shared`, an `exactOptionalPropertyTypes` pass for `domain`, and tracked-files-only secret hygiene checks.

## Config System

XQoder no longer reads only a single `llm` config. It resolves product config in this order:

1. `~/.xqoder/config.json`
2. `XDG_CONFIG_HOME/xqoder/config.json`
3. `.xqoder/config.json` or `.xqoder.json` found by walking upward from the current project
4. An explicit path provided through `XQODER_CONFIG=<path>`

The current schema supports:

- `providers`
- `defaultAgent`
- `smallModel`
- `agents`
- `instructions`
- `commands`
- `permissions`

Inspect the effective config and its source:

```bash
bun run xqoder -- config show
bun run xqoder -- config doctor
```

Initialize a default global config:

```bash
bun run xqoder -- config init \
  --provider openai \
  --model gpt-4.1 \
  --small-model gpt-4.1-mini \
  --default-agent general \
  --instruction "reply in English"
```

## Auth And Models

`auth` and `models` are now first-class command surfaces. Users do not need to edit provider or model settings manually through `config init`.

Authentication commands:

- `xqoder auth login <provider> --api-key <key>`
- `xqoder auth logout <provider>`
- `xqoder auth list`

Model commands:

- `xqoder models list`
- `xqoder models list --all`
- `xqoder models use <model>`
- `xqoder models use <model> --provider <provider> --agent <name>`
- `xqoder models use <model> --provider <provider> --small`

Examples:

```bash
bun run xqoder -- auth login openai --api-key <openai-key>
bun run xqoder -- auth login anthropic --api-key <anthropic-key> --default-model claude-sonnet-4
bun run xqoder -- auth list

bun run xqoder -- models list
bun run xqoder -- models use claude-sonnet-4 --provider anthropic
bun run xqoder -- models use gpt-4.1-mini --provider openai --small
```

## Agents

Agents are now a first-class product concept rather than an internal helper.

Built-in agents:

- `general`
- `coder`
- `plan`
- `explore`
- `summary`
- `title`
- `compaction`

Supported CLI commands:

- `xqoder agent list`
- `xqoder agent show <name>`
- `xqoder agent use <name>`
- `xqoder agent set <name> ...`
- `xqoder agent enable <name>` / `disable <name>`
- `xqoder agent remove <name>`

Examples:

```bash
bun run xqoder -- agent list
bun run xqoder -- agent set reviewer \
  --mode subagent \
  --provider anthropic \
  --model claude-sonnet-4 \
  --instruction "focus on bugs"
bun run xqoder -- agent use coder
bun run xqoder -- chat --agent coder "Inspect the main execution path of this repository"
bun run xqoder -- explain --agent explore src/index.ts
```

## Chat Sessions

`xqoder chat` persists project conversations in `~/.xqoder/data/sessions.sqlite`.

- Default behavior: automatically resume the most recent session for the current project
- `--new-session`: force creation of a new session
- `--session <id>`: resume a specific session
- `xqoder session list`: list recent persisted sessions for the current project
- `xqoder session show [sessionId]`: inspect session summary, transcript, command history, and file history
- `xqoder stats`: summarize project-level or global session usage
- `xqoder export [sessionId] --out <file>`: export a session as JSON or Markdown
- `xqoder import <file>`: import a previously exported JSON session back into SQLite
- `xqoder share create [sessionId]`: create a local share asset
- `xqoder share list`: list local share assets
- `xqoder share show <id>`: inspect a local share asset and its output path
- `xqoder share remove <id> --yes`: remove a local share asset
- `xqoder rollbacks list`: inspect recent rollback points for the current project
- `xqoder rollbacks show <id>`: inspect the file snapshots stored in a rollback point
- `xqoder rollbacks restore <id>`: restore a rollback point with confirmation
- `xqoder rollbacks restore <id> --yes`: restore without confirmation

Examples:

```bash
bun run xqoder -- chat "Analyze the directory layout"
bun run xqoder -- chat "Continue and inspect the build path as well"
bun run xqoder -- chat --new-session "Review this repository from scratch"
bun run xqoder -- session list
bun run xqoder -- stats --all
bun run xqoder -- export --format markdown --out /tmp/demo-session.md
bun run xqoder -- import /tmp/demo-session.json --dir .
bun run xqoder -- share create --format markdown
```

Local share assets are stored in `~/.xqoder/data/shares`. At this stage, `share` is still local asset management rather than remote URL sharing.

## TUI Shell

`xqoder tui` is now a persistent conversation shell rather than a static command list.

- By default, `xqoder tui` opens the shell without restoring a prior conversation
- `xqoder tui --continue`: restore the most recent session for the current project
- `xqoder tui --session <id>`: restore a specific session
- Type a prompt directly to continue the current shell session after startup
- `/new`: start a new chat session in the current shell
- `/session new`: same as `/new`
- `/exit`: leave the shell
- `/quit`: same as `/exit`
- Use CLI commands such as `xqoder session list`, `xqoder session show`, `xqoder share list`, and `xqoder share show` for session/share inspection outside the shell

Mouse wheel scrolling now stays with your outer terminal scrollback (`Terminal.app`, `iTerm2`, etc.); XQoder does not switch into an internal mouse-capture mode.

This is still incremental parity work: execution-heavy commands such as `chat / build / fix / run / test / deploy` still use the existing runner path, while the terminal shell itself stays intentionally small and scrollback-first.

## Tool Safety

The current tooling layer includes:

- `preview_diff`: generate a unified diff preview before writing files
- `apply_patch`: edit existing files precisely through patches
- `tool approval`: require confirmation for higher-risk tools in TTY mode
- `list_files` / `glob_files` / `grep_content`: file tree, glob, and content search helpers
- streaming `run_command`: forward stdout and stderr to the CLI while a command is running
- `rollback point`: `write_file` and `apply_patch` automatically create rollback points

Rollback snapshots live under `~/.xqoder/data/rollbacks`.

```bash
bun run xqoder -- session show
bun run xqoder -- rollbacks list
bun run xqoder -- rollbacks restore <rollback-id> --yes
```

## LSP Context

XQoder currently supports two layers of LSP context:

- built-in TypeScript and JavaScript analysis
- external multi-language language servers over `stdio` or `tcp`

Built-in tools include:

- `lsp_workspace_symbols`
- `lsp_file_diagnostics`
- `lsp_definition`
- `lsp_references`
- `lsp_hover`
- `lsp_completion`
- `lsp_rename_symbol`

These tools are automatically exposed to the agent, so `chat / build / fix / explain` can use them directly for TS/JS projects.

Register an external LSP server:

```bash
bun run xqoder -- lsp add pyright \
  --command pyright-langserver \
  --arg --stdio \
  --extension .py \
  --language-id python

bun run xqoder -- lsp doctor pyright
bun run xqoder -- chat "Check diagnostics and go-to-definition in this Python project"
bun run xqoder -- lsp ui --file src/index.ts
```

Current boundaries:

- `stdio` and `tcp` transports are supported
- HTTP transport is not implemented yet
- `workspace/applyEdit` is supported for text edits only
- the standalone `lsp ui` exists, but richer resolve and history views are still pending

## MCP Bridge

XQoder can connect to external MCP servers over `stdio` and expose remote tools, resources, and prompts to the agent.

- `xqoder mcp add <name> --command <cmd>`
- `xqoder mcp list`
- `xqoder mcp show <name>`
- `xqoder mcp doctor [name]`
- `xqoder mcp enable <name>` / `disable <name>`
- `xqoder mcp remove <name>`

Example:

```bash
bun run xqoder -- mcp add filesystem --command node --arg ./servers/filesystem.mjs
bun run xqoder -- mcp doctor filesystem
bun run xqoder -- chat "Use MCP tools to inspect an external knowledge source"
```

Current boundaries:

- only official `stdio` transport is supported
- `initialize`, `tools/list`, `tools/call`, prompt APIs, and resource APIs are already handled
- reverse `roots/list` requests are handled
- HTTP transport and richer interactive resource/prompt UI are still pending

## Workspace Layout

```text
Current stable directories
src/cli           CLI bootstrap and root shell
src/commands      user-facing command definitions
src/core          agent engine, runtime kernel, workflow engine
src/features      runtime and deploy feature modules
src/infra         shared utilities, protocols, plugin SDK, storage
src/platform      terminal runtime and server adapters
src/plugins       workspace plugin discovery and loading
src/services      application services for chat, config, and session resolution
src/ux            UX helpers such as tool approval

Target landing zones for new code
src/bootstrap
src/interfaces
src/application
src/domain
src/infrastructure
src/shared
```

## Common Commands

```bash
bun run build
bun run test
bun run test:coverage
bun run lint
bun run local:repair-runtime-state

bun run xqoder -- tui
bun run xqoder -- chat "Explain this project"
bun run xqoder -- session list
bun run xqoder -- session show
bun run xqoder -- stats
bun run xqoder -- share create
bun run xqoder -- rollbacks list
bun run xqoder -- lsp list
bun run xqoder -- mcp list
bun run xqoder -- auth list
bun run xqoder -- models list
bun run xqoder -- agent list
bun run xqoder -- build "A Vite and React blog system"
bun run xqoder -- fix
bun run xqoder -- run
bun run xqoder -- test
bun run xqoder -- deploy
bun run xqoder -- config doctor
```

## Release Discipline

The root `package.json` version is the current source of truth.

- `bun run build`: build the CLI bundle
- `bun run test`: run the Bun test suite
- `bun run test:coverage`: run the test suite with the current coverage gate
- `bun run lint`: run `tsc --noEmit`
- `bun run local:repair-runtime-state`: rewrite stale local `.omx/state` paths to the current repo root
- `bun link --global`: expose the local repository as a machine-wide `xqoder` executable

## Roadmap

XQoder is intentionally prioritizing **OpenCode parity first** rather than expanding its original workflow-first direction.

Current execution order:

1. Align `CLI / TUI / Session / Auth / Config / Agents`
2. Align `stats / export / import / share / undo / redo`
3. Add `serve / web / attach / ACP / IDE`
4. Move `build / fix / run / test / deploy` back to the front as differentiated capabilities once parity is complete
