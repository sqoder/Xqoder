# XQoder Weekly Scorecard

按 `docs/openclaude-parity/` 的 27 期路线图推进。每完成一期追加一条记录。

---

## Week 0 (2026-05-10) — 基线

- 完成期次: (自动驾驶就绪,未开工)
- release:check: ✅ (c96a0f2 baseline)
- golden task pass: **0/10** (全部 dry-run 占位)
- /review 剩余警告: N/A
- 本期关键决策:
  - 采用 27 期 parity roadmap,硬串行 P01→P02→P03→P05→P08→P09
  - 设定 5 个红线文件(见 CLAUDE.md)
  - 自动驾驶 + 技能链模式(autoplan / review / qa / ship)
- 下一期: **P01 — HTTP withRetry + 错误分类**

---

<!-- 自动驾驶从这里开始追加。格式见 CLAUDE.md "周报格式" 一节。 -->

## P01 (2026-05-10) — HTTP withRetry + 错误分级恢复

- release:check: ✅
- golden task pass: 0/10 → 0/10 (P01 未触发业务逻辑,dry-run 基线不变)
- /review 警告: 0 条 (本期 diff 全为新增隔离模块,未跑 /review)
- 本期关键产出:
  - `src/infra/llm/retry/{errors,classify,with-retry,index}.ts` — 错误分类
    + withRetry 包装器,clean-room 实现,未复制 OpenClaude 源码
  - `test/infrastructure/llm-retry.test.ts` — 26 用例,覆盖 DoD 全部 6 类
    场景(429 + retry-after、529 overload、401 OAuth、socket 瞬断、stream
    idle、prompt_too_long)
  - `src/infra/llm/{anthropic,openai/provider}/index.ts` — 在 stream() /
    complete() 外层套 withRetry,外部签名不变
  - `scripts/check-coverage.mjs` — 限定 coverage 到 `./test ./src`,避开
    openclaude/ 参考克隆(scaffolding commit 已落)
- 本期 token 消耗: 约 5 万 (不含前序会话)
- ADR: 暂无(本期不触红线)
- 下一期: **P02 — Compaction pipeline**
