# P11.1 hotfix — 接力棒

- 日期: 2026-05-10
- 上游: `docs/release/periodic-audit-3.md`
- 用户决策: **彻底路线** = 第一层 2 条安全修复 + 方案 B 清理 event envelope 红线
- 预算: 单 session < 150k token,预估实际 ~80k

---

## 本期 DoD(按此 6 条验收)

1. `src/core/agent/tools/fetch-tool.ts` —— SSRF 拦截:解析 URL,拒绝 loopback(127/0.0.0.0)/link-local(169.254)/RFC1918(10/172.16/192.168)/ULA(fc00::/fe80::)/cloud metadata。默认只放行 `https://`,`http://` 需显式 opt-in。审批 risk 从 `medium` 提到 `high`。
2. `src/commands/sessions/import.ts:87-98` —— `loadImportSource` 限制 `https://` + `Content-Length` 上限(建议 5MB)+ content-type 校验。
3. `src/core/agent/mcp-stdio-client.ts:230-237` —— 不再透传全量 `process.env`。复用 `src/core/agent/tools/sandbox.ts` 的 `isSensitiveEnvKey`(如果存在)或新写 `filterSensitiveEnv`,移除含 `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|SESSION` 的变量。用户可在 MCP config `env` 字段显式 opt-in 具体名字。
4. `src/core/agent/hook-handler-execution.ts:263-275` —— `createHookEnvironment` 同样过滤。
5. **方案 B:清理 event envelope 硬红线**
   - `src/domain/conversation/events.ts` —— 如果真的没有其他 caller 依赖里面的 `ConversationEvent`,删掉;如果有,迁移到 `src/infra/protocol/events.ts` 或改为从 protocol re-export。
   - `src/domain/conversation/transcript-projector.ts` —— 已经 import `@xqoder/protocol`,顺手 domain 层迁走(见审查 §1.1)。
   - **先跑 `grep -r "from.*domain/conversation/events"` 确认 caller 清单,再删。**
   - 更新 `CLAUDE.md` 的红线指针:硬红线从 `src/domain/conversation/events.ts` 改为 `src/infra/protocol/events.ts`,补一行说明 envelope 的权威位置。
   - 写 `docs/adr/0008-event-envelope-authoritative-location.md`,记录:
     - 原计划 envelope 在 domain、事实落在 infra 的历史
     - 方案 A vs B 的取舍(A 改 N 个 caller,B 改红线)
     - 为什么选 B
6. `bun run release:check` + `bun run eval:golden -- --dry-run` 全绿,golden task 通过率不下降。

---

## 不做 / 搁置

- agent.ts:337 `void this.run` 挂 catch —— 留到 P11.2 或 P12 前
- prompt-hook-bridge.ts:77 抛错 hook 视作 deny —— 留到 P11.2
- event-bus.ts 空 catch 加 log —— 留到 P11.2
- compaction-pipeline.ts:73 带错返回 —— 留到 P11.2
- `src/infrastructure/` → `src/infra/` 迁移 —— 单独一期 P11.3 规划
- 文件改名(lsp-manager 等) —— 并入 P11.3
- `src/features/ commands/ plugins/ ux/` 归位 —— 并入 P11.3

---

## 实施顺序建议

1. **先做方案 B(改红线)+ ADR 0008**,因为这关系到后续所有 session 对红线的理解。
2. 再做 SSRF(fetch-tool + session import)—— 纯 bug fix,好写测试。
3. 再做 env 脱敏(MCP stdio + hook)—— 小心别破坏已有 MCP server 的 env 需求,先跑 grep 看谁在用 `config.env`。
4. `bun run release:check` + `eval:golden --dry-run`,全绿。
5. 写 `docs/release/weekly-scorecard.md` 条目(格式见 CLAUDE.md)。
6. commit,消息格式见 conventions.md。

---

## 先写测试(按 CLAUDE.md /test-driven-development)

最小测试清单:

```
test/core/tools/fetch-tool.ssrf.spec.ts
  - 拒绝 http://127.0.0.1
  - 拒绝 http://169.254.169.254/...
  - 拒绝 http://10.0.0.1
  - 拒绝 http://[::1]
  - 允许 https://example.com
  - http://example.com 未 opt-in 时拒绝

test/commands/sessions/import.spec.ts
  - http:// 被拒
  - 超过 size cap 被拒
  - 非 JSON content-type 被拒

test/core/agent/mcp-stdio-env.spec.ts
  - ANTHROPIC_API_KEY 不在 spawn env 里
  - GITHUB_TOKEN 不在 spawn env 里
  - config.env 显式声明的变量被保留
  - 非敏感变量(PATH 等)照常透传

test/core/agent/hook-env.spec.ts
  - 同上
```

---

## 启动下一 session 的话术

在新 session 里复制粘贴:

```
读 CLAUDE.md、AGENTS.md、docs/release/periodic-audit-3.md、
docs/release/in-progress-p11.1.md,按方案 B + 第一层 2 条安全修复,
先 /test-driven-development 写测试,再实施 P11.1 hotfix。
```

---

## 本 session 留下的状态

- 未执行任何代码改动
- 未执行 release:check
- 周期审查报告:`docs/release/periodic-audit-3.md`
- 下一 session 输入:本文件
- git 工作树状态:审查前 2 个未跟踪目录(`src/core/tools/`、`test/core/tools/`),与本轮无关
