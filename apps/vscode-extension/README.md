# XQoder VS Code Extension

Thin VS Code shell for the existing `xqoder serve` HTTP runtime.

Current capabilities:

- chat panel backed by `/session/:id/message/stream`
- remembers the last session id in VS Code workspace state
- shows pending approvals and questions
- opens diff-style preview documents for file-write approvals
- can attach the active editor selection to prompts

Local development:

```bash
cd apps/vscode-extension
npm install
npm run build
```

Then launch VS Code with:

```bash
code --extensionDevelopmentPath apps/vscode-extension
```

Before using the panel, start the runtime in the target workspace:

```bash
xqoder serve --dir /path/to/project
```
