# Phase 8 VS Code Signoff

Date: 2026-04-24

## Scope

This signoff covers only the Phase 8 IDE surface:

- Open the Xqoder VS Code chat panel.
- Send a prompt through a running `xqoder serve` runtime.
- Display `approval.requested` events in the panel.
- Allow and deny pending approvals from the panel.
- Open a diff preview for file-write approvals.
- Restore the previous session after the panel is reopened.

## Automated Preflight

Run from the repository root:

```bash
bun x tsc -p apps/vscode-extension/tsconfig.json --noEmit
bun test ./test test/smoke-lane-worker-c.test.ts test/system-ide.test.ts
```

Required result: both commands pass.

## Manual Signoff Procedure

1. Build the extension:

   ```bash
   bun x tsc -p apps/vscode-extension/tsconfig.json
   ```

2. Start the runtime against a disposable fixture workspace:

   ```bash
   bun dist/index.js serve --dir /path/to/fixture-workspace
   ```

3. Launch VS Code extension development host:

   ```bash
   code --extensionDevelopmentPath apps/vscode-extension /path/to/fixture-workspace
   ```

4. In the extension development host, run `XQoder: Open Chat Panel`.
5. Send a prompt that triggers a file write approval.
6. Verify the panel shows the pending approval with summary and preview.
7. Click `Preview` and confirm a diff document opens beside the panel.
8. Click `Allow` and confirm the stream continues.
9. Trigger a second approval, click `Deny`, and confirm the denial is shown without applying the write.
10. Close and reopen the chat panel, then confirm the last session is restored.

## Current Environment Result

| Check | Status | Evidence |
| --- | --- | --- |
| Extension typecheck | PASS | `bun x tsc -p apps/vscode-extension/tsconfig.json --noEmit` exited 0 |
| IDE smoke tests | PASS | Covered by `bun test ./test test/features/golden-task-runner.test.ts test/core/mcp-tools.test.ts test/domain-permissions.test.ts`: 404 pass, 0 fail |
| Extension development host | Blocked | `code` CLI was not found in PATH during preflight |
| Manual allow/deny and diff preview | Blocked | Requires extension development host |
| Manual session restore | Blocked | Requires extension development host |

## Exit Condition

Phase 8 can be marked product-signed only when the automated preflight passes and the manual signoff procedure above records `PASS` for approval display, diff preview, allow/deny, and session restore.
