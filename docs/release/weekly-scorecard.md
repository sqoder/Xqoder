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
- 本期验收产出:
  - `src/infra/llm/retry/{errors,classify,with-retry,index}.ts` — 错误分类
    + withRetry 包装器,clean-room 实现,未复制 OpenClaude 源码
  - `test/infrastructure/llm-retry.test.ts` — 26 用例,覆盖 DoD 全部 6 类
    场景(429 + retry-after、529 overload、401 OAuth、socket 瞬断、stream
    idle、prompt_too_long)
  - `src/infra/llm/{anthropic,openai/provider}/index.ts` — 在 stream() /
    complete() 外层套 withRetry,外部签名不变
  - `scripts/check-coverage.mjs` — 限定 coverage 到 `./test ./src`,避开
    openclaude/ 参考克隆(scaffolding commit 已落)
  - `docs/release/p01-verification.md` — DoD 逐条证据 + 已识别 gap 登记
- 本期 token 消耗: 未测量
- ADR: 暂无(本期不触红线)
- 下一期: **P01.1 — wrapStream + 120s idle 看门狗**
  (验收发现的 G1; 见 docs/release/p01-verification.md)
  P01.1 收官后再进 **P02 — Compaction pipeline**

---

## P01.1 (2026-05-10) — wrapStream + 120s idle 看门狗

- release:check: ✅ (644 pass / 0 fail / 2226 expect() 全绿; coverage 66.35% ≥ 36%)
- golden task pass: 0/10 → 0/10 (infra 层改动,不触发业务逻辑)
- /review 警告: 0 条 (P01.1 diff 集中在新增文件 + 两个 provider 局部改线)
- 本期验收产出:
  - `src/infra/llm/retry/stream-idle.ts` — `createIdleWatchdog` + `wrapStream`,
    timer 可注入以支持确定性测试,默认 `DEFAULT_STREAM_IDLE_MS = 120_000`,
    闭幕时 best-effort 调 `iterator.return()` 关闭底层连接
  - `src/infra/llm/retry/index.ts` — barrel 导出 watchdog/wrapStream/类型
  - `src/infra/llm/openai/provider/index.ts` — `stream()` 消费端把
    `withTimeout(collectStreamingResponse, …)` 换成 `wrapStream(streamRef)`,
    wall-clock 超时变 idle 超时,慢但活跃的流不再被误杀
  - `src/infra/llm/anthropic/index.ts` — 事件发射式 `MessageStream` 接
    `createIdleWatchdog`,`text`/`contentBlock` 事件 `tick()`,
    `Promise.race(finalMessage(), waitForIdle())`,idle 胜出时显式
    `stream.abort()` 避免连接泄漏
  - `test/infrastructure/llm-stream-idle.test.ts` — 8 用例,覆盖 watchdog
    生命周期 (fire/reset/stop/idempotent) 与 wrapStream 四条路径
    (pass-through / idle throws / iterator.return() 被调 / 源错误透传)
- 本期 token 消耗: 未测量
- ADR: 暂无(未触红线;改动局限在 retry/ 新增模块 + 两个 provider 各 10 行内局部替换)
- 下一期: **P02 — Compaction pipeline**(P01.1 已解决 p01-verification.md 的 G1,
  其余 G2-G5 留在登记簿,不 block P02)
