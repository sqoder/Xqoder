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
bun test ./test
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
| Full test suite | PASS | `bun test ./test`: 404 pass, 0 fail |
| Release check | PASS | `bun run release:check` completed build, typecheck, coverage, CLI smoke, MCP live smoke, security hygiene, and size guardrail |
| Extension development host | PASS | `code` CLI was not in PATH, so the host was launched through `/Applications/Visual Studio Code.app` with `--extensionDevelopmentPath=apps/vscode-extension` and remote debugging on `127.0.0.1:9333` |
| Runtime bridge | PASS | `bun dist/index.js serve --dir /Users/wangxinglin/Desktop/xqoder-4.23/Xqoder --port 4096 --hostname 127.0.0.1`; `/provider` reported the configured provider/model. Phase 8 UI signoff was run with `gemini/gemini-2.5-flash`; follow-up release verification switched the current provider to `dashscope/qwen-plus`. |
| Approval display | PASS | Protected-path write prompt displayed `APPROVAL REQUESTED`, `write_file · risk=high`, and inline diff in the VS Code webview |
| Diff preview | PASS | The `Full Diff` action opened the preview for the denied write flow |
| Deny path | PASS | Clicking `Deny` cleared the pending approval and `.xqoder/vscode-deny-smoke.txt` was not written |
| Allow path | PASS | Clicking `Allow` resumed the stream and wrote `.xqoder/vscode-allow-smoke.txt` with `ALLOW WRITES THIS FILE`; the smoke file was removed after verification |
| Session restore | PASS | Closing and reopening the Xqoder panel restored `session_1776999569210_wdc8ea` and preserved the transcript |

## Evidence Artifacts

- `/tmp/xqoder-deny-approval-visible.png`
- `/tmp/xqoder-deny-full-diff.png`
- `/tmp/xqoder-deny-resolved.png`
- `/tmp/xqoder-allow-approval-visible.png`
- `/tmp/xqoder-allow-resolved.png`
- `/tmp/xqoder-panel-closed.png`
- `/tmp/xqoder-panel-reopened.png`

## Exit Condition

Phase 8 is product-signed for the current environment.

## Release Follow-up

The original live golden run with Gemini reached only 2/10 because the provider returned repeated 429 rate/quota errors. A follow-up live run with DashScope `qwen-plus` cleared that release blocker:

```bash
DASHSCOPE_API_KEY=<redacted> XQODER_GOLDEN_LIVE=1 XQODER_LLM_PROVIDER=dashscope XQODER_LLM_MODEL=qwen-plus bun run scripts/run-golden-tasks.ts --manifest docs/golden-tasks/xqoder-internal.sample.json --live --model qwen-plus
```

Result: 10/10 passed, required 7/10, accepted true.
