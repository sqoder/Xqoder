# OpenCode Parity Status (Canonical)

This is the single status table for parity progress. Other parity docs should link here for current state.

## Current Snapshot

| Area | Status | Notes |
|------|--------|-------|
| Product surface defaults | ✅ Done | core-shell default, integrations/remote/workflows/extras opt-in |
| TUI stack | ✅ Done | terminal-core only; attach follows same stack |
| `run_command` shell behavior | ✅ Done | persistent shell path in place |
| Tool parity (`skill/todo/question`) | ✅ Done | `skill`, `todowrite`, `todoread`, `question` all available |
| Web search tool parity | ✅ Done | `websearch` available (DuckDuckGo HTML backend) |
| Question interaction (local + attach) | ✅ Done | local dialog + remote roundtrip (`question.requested` resolve API) |
| Stream reliability (attach) | ✅ Done | `seq/cursor/streamId`, reconnect resume, timeout, cancel |
| Parity automated checks | ✅ Done | `pnpm parity:test` gate available |
| Session behavior parity | 🟡 In progress | import/export 兼容已增强；新增 auto-compact env parity（`OPENCODE_DISABLE_AUTOCOMPACT`）；ACP `session/load` 支持 compact summary 回放 |
| Runtime permission policy plane | 🟡 In progress | `ask` without callback now denies; serve/ACP no longer force-allow approvals |
| ACP parity | ✅ Done | 增补 `permissions/get|set`、`mcp/list`、`slash/list` 与 capability 声明 |
| Serve API parity depth | 🟡 In progress | 已提供 OpenAPI `/doc.openapi.json` 与 `/doc` JSON 协商；补齐 health/project/config/provider/find/file/session/message/question 的 schema/response 文档，并为 session/stream 与 share/file/find 路由统一错误响应引用（400/401/404/409/500/503）与示例 payload；文档已声明 BasicAuth security、关键端点 operationId、tags 分组与最小请求示例，并细化 `/doc`(HTML/JSON) 与 `/event`(SSE) 的 200 content type，便于 SDK 生成与联调；`/find/symbol` 支持 LSP 优先 + 扫描兜底 + 相关性排序 + cursor 分页；NDJSON stream 记录已 schema 化 |
| Release rollout readiness | ✅ Done | 新增 RC/Beta/Stable 发布与 10%->30%->100% 灰度 gate 脚本（含回滚阈值与 7 天稳定窗） |
| Auth storage hardening | ✅ Done | default auth login stores provider keys in credential files (config plaintext opt-in only) |

## Fast Links

- Execution checklist: `docs/opencode-parity-execution-checklist.md`
- Acceptance tests checklist: `docs/parity-acceptance-checklist.md`
- Gap closure plan: `docs/parity-gap-closure-plan.md`
- Tools parity details: `docs/opencode-tools-parity.md`
- Session parity details: `docs/opencode-session-parity.md`
- Serve/attach parity details: `docs/opencode-serve-acp-parity.md`
