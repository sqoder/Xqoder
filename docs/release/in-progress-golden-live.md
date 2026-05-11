# Live golden 3-task 验证 —— 接力棒

- 日期: 2026-05-12
- 上游: `docs/golden-tasks/xqoder-live-3task.json`(3 条 live coding 任务)
- 脚本: `scripts/run-golden-tasks.ts --manifest docs/golden-tasks/xqoder-live-3task.json --live`
- 目标: live pass rate ≥ 70% (`LIVE_PASS_RATE_MINIMUM = 0.7`, scripts/run-golden-tasks.ts:32)
- 本次会话结果: **pipeline 打通,pass rate 0/3,未达标**

---

## 本次 session 完成

### ✅ Pipeline 端到端验证通过

在真 LLM 下全链路跑通了:provider 路由、`XQODER_LLM_*` env 覆盖、agent loop、tool gate、approval flow、anti-repetition guard、metrics artifact。产物 `docs/release/latest-live-acceptance-metrics.json` 按 live 规则写出。

### ❌ Pass rate 未达标(0/3,门槛 3/3)

6 次 live run 尝试摘要:

| # | Provider / Model | 结果 | 真因 |
|---|---|---|---|
| 1 | dashscope / qwen-max | 3× 403 | 阿里云账号"仅使用免费额度"开关锁住了 qwen-max |
| 2 | dashscope / qwen-plus | 真跑 0/3 | 2× max_loops(15 轮不收敛)+ 1× read-before-write 崩溃 |
| 3 | gemini / 2.5-pro | 3× 429 | 免费配额太紧 |
| 4 | gemini / 2.5-flash | 1× 空响应 + 2× 429 | 同上 |
| 5 | openrouter / ring-2.6-1t:free | 3× aliyun 401 | **产品 bug**: baseUrl 残留 dashscope |
| 6 | dashscope / qwen-coder-plus | 真编码 0/3 | max_loops + evaluator 约束不够 |

---

## 发现的真 bug(**全部未修**,下一 session 处理)

### Bug 1: `~/.xqoder/config.json` 缺 openrouter/anthropic provider entry

**症状**: 设 `XQODER_LLM_PROVIDER=openrouter` + 正确 key,请求仍打到 `help.aliyun.com`(401)。

**根因**: `~/.xqoder/config.json` 只有 openai/dashscope/gemini/groq/local/openai-compatible 六个 `providers.*` entry,切到没登记的 provider 时 fallback 到顶层 `llm.baseUrl`(被锁在 dashscope URL)。

**Workaround(临时)**: 同时设 `XQODER_LLM_BASE_URL=https://openrouter.ai/api/v1`,脚本的 env 覆盖逻辑在 `src/infra/shared/config.ts:316` 支持这个变量。

**正规修法(下一期做)**:
- 在 config 的 providers 默认 template 里补 openrouter 和 anthropic entry(baseUrl/defaultModel 见 `src/infra/shared/llm.ts:22,46`)
- 或者在 `resolveConfigWithEnvOverrides` 里,当 provider override 时强制按新 provider 重算默认 baseUrl
- 加 unit test: 不带 `XQODER_LLM_BASE_URL` 切 provider,请求 URL 应该跟新 provider 匹配

### Bug 2: Agent max_loops 15 对真编码任务偏紧

**症状**: qwen-plus 和 qwen-coder-plus 在任务 1/2 上都跑满 15 轮后 `⏹ 停止：max_loops`,任务没收敛到 final answer。qwen-coder-plus 的日志显示 agent 真在 `read_file → write_file → read_file → ...` 做实事,不是乱转。

**归属**: eval harness 配置 + agent loop 预算。不是模型能力问题。

**修法**: 
- 短期: `golden-task-runner` 里把 live 模式的 max_loops 调到 25-30
- 长期: agent 主循环应该暴露一个配置项,编码任务 default 更高
- 验证: 用 qwen-coder-plus 重跑,看是否 30 轮能收敛

### Bug 3: Tool gate 报错 `read_file before modify` 后 agent 不自恢复

**症状**: qwen-plus 任务 3 收到 `Existing file must be read fully with read_file before it can be modified` 后,agent 直接把错当成终局,steps=0,`error` 字段吐给 evaluator。

**归属**: **真 agent bug**。tool gate 的拦截是正确的(保护不变量),但 agent 应该识别这类 "guidance error",自动补一次 `read_file` 再重试 `write_file`,而不是崩掉整次 run。

**修法**:
- 在 `tool-orchestrator.ts`(软红线)识别 read-before-write guard 错误,自动插入 read 再重试
- 或者把这类错误包装成 tool result 返给模型,让模型自己决定下一步
- 写 unit test 复现

### Bug 4: Evaluator 未强制 final-answer 含验收字面量

**症状**: qwen-coder-plus 任务 3 做了 6+ 次 read/write,但 response 为空 → `missingAll: [type, fix]` 失败。模型在干活但没输出总结。

**修法**: `buildGoldenTaskPrompt`(scripts/run-golden-tasks.ts:330)里已经有 `literalHint`,但 live 模式下模型在工具循环里忽视了它。考虑:
- agent 在 `max_loops` 触发前加一步 "现在给出最终答案" 强制收尾
- 或者 evaluator 允许匹配 tool history(read 了哪些文件、改了什么)作为 fallback 证据

---

## 未做(本 session 明确 skip)

- 代码 0 改动(符合 CLAUDE.md "硬红线 + 软红线需 ADR" 约束,本 session 不带 TDD 不改代码)
- 未 commit
- 未跑 `release:check`
- 未更新 `weekly-scorecard.md`(因为这不是完整一期)

---

## ⚠️ 安全遗留 —— 用户侧待办

本次会话历史里泄露了 4 把 API key,**下一 session 之前请全部 revoke**:

- DashScope: `sk-562e...` / `sk-6846...`
- Google: `AIzaSyBthK...`
- OpenRouter: `sk-or-v1-886e...`

另外:阿里云百炼控制台有个 **"仅使用免费额度"** 开关,开着会导致 qwen-max 等主力模型直接 403,哪怕账号已充值。要跑真 acceptance 需先关掉。

---

## 启动下一 session 的话术

本 session 挖出 4 个 bug 但未修。下次想修时,新 session 里发:

```
读 CLAUDE.md、docs/release/in-progress-golden-live.md,按里面 Bug 1-4 顺序,
先 /test-driven-development 写测试,再修。优先 Bug 1(config baseUrl 残留)
和 Bug 3(tool gate recovery),都是小面积 fix。
Bug 2/4 涉及 harness 配置和 prompt 策略,先开 ADR 讨论。
```

如果只是想再跑一次 live acceptance(不修 bug):

```
先去阿里云百炼控制台关闭"仅使用免费额度"开关,然后:

XQODER_LLM_PROVIDER=dashscope XQODER_LLM_MODEL=qwen-max XQODER_LLM_API_KEY=<new-key> \
  bun run scripts/run-golden-tasks.ts --manifest docs/golden-tasks/xqoder-live-3task.json --live
```

---

## 本 session 留下的状态

- 代码改动: 0
- 新文件: 本文件 + `docs/release/latest-live-acceptance-metrics.json`(被每次 live run 覆盖,最后一次是 qwen-coder-plus 的结果)
- `docs/release/latest-golden-task-report.{md,json}` 已同步更新
- git 工作树: 与 session 开始时一致(只多了未跟踪的 `docs/release/in-progress-golden-live.md` 和若干 metrics artifact)
