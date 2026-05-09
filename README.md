# XQoder

Terminal-native AI coding assistant with CLI, session persistence, approvals, MCP bridge, and a VS Code panel.

## Quick start

### Requirements

- Node.js 22+
- Bun
- One provider API key (for live model runs)

### Install

```bash
bun install
bun run build
```

### First-time provider setup

For a fresh machine or isolated HOME, initialize the default provider once before running the first real chat task:

```bash
bun dist/index.js config init --provider dashscope --model qwen-plus
```

XQoder will read the provider credential from the matching environment variable or `~/.xqoder/credentials/<provider>.key`.

### First task in under 10 minutes

```bash
bun dist/index.js --help
bun dist/index.js chat "概述这个仓库的主要目录" --dir . --new-session
```

The `chat` command supports persisted sessions and explicit restore/new-session options.

## Common commands

```bash
bun run build
bun run lint
bun test ./test ./src
bun run eval:golden -- --dry-run
bun run eval:golden:live -- --dry-run
bun run acceptance:metrics
bun run release:check
```

## Serve mode

Start the HTTP runtime for the VS Code extension or other remote clients:

```bash
bun dist/index.js serve --dir /path/to/project --port 4096 --hostname 127.0.0.1
```

## VS Code extension

The extension lives in `apps/vscode-extension`.

Local development:

```bash
cd apps/vscode-extension
npm install
npm run build
code --extensionDevelopmentPath apps/vscode-extension
```

Before using the panel, start the runtime in the target workspace:

```bash
xqoder serve --dir /path/to/project
```

## Troubleshooting

### `code` CLI not found

Open VS Code from `/Applications/Visual Studio Code.app` or install the `code` shell command, as noted in `docs/release/phase8-vscode-signoff.md`.

### Local runtime/session state looks stale

Use:

```bash
bun run local:repair-runtime-state
```

### Need smoke checks

```bash
bun run e2e:smoke
bun run mcp:live-smoke
```

## Release and acceptance evidence

See:

- `docs/release/word-doc-100-traceability.md`
- `docs/release/acceptance-report-omc-final.md`
- `docs/release/latest-acceptance-metrics.json`
- `docs/release/dogfooding-evidence.json`
- `docs/release/dogfooding-report.md`
