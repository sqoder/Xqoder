# XQoder 开工路线图(动态状态)

> 这份文档回答一个问题:**下一步开什么期?**
> 每完成一期,在"当前位置"和"阶段进度表"里打勾,"下一期施工单"指针前移。
> 配套:`weekly-scorecard.md`(每期验收记录)、`docs/openclaude-parity/`(27 期施工单)。

**最后更新**:2026-05-10 (P10 收官)

---

## TL;DR — 现在该做什么

**下一期:P11 — 输入预处理(slash 命令 / `@file` 粘贴 / memdir / contextPreload / handlePromptSubmit hook)**

施工单:`docs/openclaude-parity/phase-11-input-preprocessing.md`

开工前 2 分钟维护:
- [ ] 本文档的"当前位置"确认为 P10 已收官
- [ ] P01 验收单 G2–G5 gap 登记(见本文末"积压票")
- [ ] 用 `enableConfigs` 承载 settings.env 回写(P10 延后项,P11 一并做)

---

## 总路线:7 个阶段,Logic First,TUI 最后

```
S1 · 地基          P01 + P10                    断网恢复 + features CLI
S2 · Provider 核心  P07 + P05 + P08              多家 provider 全可用
S3 · 主循环骨架     P02 + P03 + P09              长对话不爆 + cache + queryEngine
S4 · 权限/输入/工具 P04 + P04-addendum + P11 + P12  autopilot 底座
S5 · 协议与集成     P14 + P13 + P15 + P20 + P21  hook/MCP/telemetry/OAuth
S6 · 生态/体验      P16 + P17 + P18 + P19 +
                   P24 + P25 + P26 + P27        subagent/plugin/task/SDK/40+ 工具
S7 · TUI 收尾       P06 + P22 + P23              Ink 渲染层(最后做)
```

核心原则:**协议稳定优先于 UI** · **底层依赖硬串不能错序** · **autopilot 体验来自 S4 不是 S7**。

---

## 当前位置

| 期次 | 阶段 | 状态 | commit |
|---|---|---|---|
| P01 HTTP withRetry + 错误分级 | S1 | ✅ 完成 | `7518ee2` |
| P01.1 stream idle 看门狗 | S1 | ✅ 完成 | `ef85c10` |
| P02 四级压缩管线 | S3 | ✅ 完成 | `2af1ba3` |
| P03 Anthropic prompt cache | S3 | ✅ 完成 | `ae8d810` |
| P04 permission 五档 + yolo 基建 | S4 | ✅ 完成 | `600f900` |
| P05 OpenAI 兼容 shim | S2 | ✅ 完成 | `f23f914` |
| P08 Codex shim + compressToolHistory | S2 | ✅ 完成 | `f23f914` |
| P09 QueryEngine + query-loop 抽离 | S3 | ✅ 完成 | `6f775cd` |
| P10 CLI fastpath + feature flags | S1 | ✅ 完成 | — (当前 HEAD 提交前) |
| **P11 输入预处理** | **S4** | **⏭ 下一期** | — |

---

## 阶段进度表

| 阶段 | 需要的期 | 已完成 | 未完成 | 里程碑 |
|---|---|---|---|---|
| S1 地基 | P01, P10 | P01 (+P01.1), P10 | — | M1 弱网恢复 |
| S2 Provider 核心 | P07, P05, P08 | P05, P08 | **P07** | M2 多 provider |
| S3 主循环骨架 | P02, P03, P09 | P02, P03, P09 | — | M3 长对话 |
| S4 权限/输入/工具 | P04, P04-addendum, P11, P12 | P04(基建) | P04 真接入, P11, P12 | M4 autopilot |
| S5 协议与集成 | P14, P13, P15, P20, P21 | — | 全部 | M5 MCP 接入 |
| S6 生态/体验 | P16-P19, P24-P27 | — | 全部 | M6 headless |
| S7 TUI 收尾 | P06, P22, P23 | — | 全部 | M7 终端体验 |

---

## 推荐开工顺序(Route A · M1+M2+M3 三连击)

```
P09 ✅ ──▶ P10 ──▶ P07 ──▶【闭合 M1+M2+M3】
           ↑       ↑
           现在    补全 S2
```

**为什么这个顺序**:
1. P09 QueryEngine 是所有后续阶段的地基——越早做,S4/S5/S6 改动代价越小。
2. M1/M2/M3 一起拿到才能做"真长对话 + 多 provider + 弱网"压测,一次性验证比分三次各验一片可靠得多。
3. P07/P10 作为"运维期"补齐,不挡 S4 开工。

**完成这 3 期后**进 S4:`P04 分类器真接入 → P11 → P12`。

### 为什么不走 Route B (P09→P04→P11→P12→...)
autopilot 体验能更早看到,但 S2(P07)一直残缺,容易出现"换 provider 就回归"的漏网。**除非产品侧强需求要先看 autopilot 效果,否则 Route A 更稳**。

---

## 每一期展开

### P10 · CLI fast-path + feature flags(下一期,补 S1)
- 施工单:`phase-10-cli-fastpath-and-feature-flags.md`
- 主要产出:`bun dist/index.js --version` < 30ms;`xqoder features ls/enable/disable`;运行时 feature flag 机制
- 依赖:无硬依赖,可随时插入
- 附带任务:P09 延后的 `estimateTokenBudget` 主动触发 compact(ADR 0005 §3)随这一期接 feature flag

### P09 · QueryEngine + query-loop 抽离(✅ 已完成)
- 施工单:`phase-09-query-loop.md`
- 实际产出:6 个新模块(query-loop/query-engine/query-stop-hooks/query-config/token-budget/index barrel),conversation-engine.ts 从 1129 → 644 行(-43%);stop hook 改纯检测器;46 新测试
- ADR: `docs/adr/0005-p09-query-engine.md`(含 src/core/runtime/* 路径被架构守卫拦下的决策)
- 红线:`conversation-engine.ts` 软红线已过 /review(0 critical / 0 high)

### P08 · Codex shim + compressToolHistory(✅ 已完成)
- 施工单:`docs/openclaude-parity/phase-08-codex-shim-and-compress-tools.md`
- 实际产出:Codex 别名走 `/responses`(opt-in `XQODER_FEATURE_CODEX_SHIM=1`);
  `compressToolHistory` 纯函数(keepRecent=6);thinkTag v2(reasoning/thought +
  `onThinking` 回调);`normalizeToolArguments` schema-aware cast
- ADR: `docs/adr/0004-p08-codex-shim.md`;验收见 `weekly-scorecard.md` P08 段

### P07 · Provider 选路决策树(补 S2)
- 施工单:`phase-07-provider-routing.md`
- 主要产出:6 家 OpenAI 兼容 provider(dashscope/qwen/deepseek/groq/openrouter/xai)走同一条 shim;路由规则显式化
- 依赖:P05 shim 完成 ✅ + P08 Codex shim 完成 ✅

---

## 里程碑验收点(中途不做 TUI 的验收闸)

| ID | 前置 | 内容 | 状态 |
|---|---|---|---|
| M1 | S1 完 | `bun dist/index.js chat "hello"` 弱网仍能跑完 | ⏸ 等 P10 |
| M2 | S2 完 | 切 dashscope/qwen/groq/xai/openrouter/deepseek 同代码跑通 | ⏸ 等 P08+P07 |
| M3 | S3 完 | 30 分钟长对话 + prompt cache 命中率 ≥ 70% | ⏸ 等 P15 live 验证 |
| M4 | S4 完 | shell 命令的 ask/allow/deny 三档真生效 | ⏸ 等 P11+P12 |
| M5 | S5 完 | 真实 MCP server 接入 + 成本看板 | |
| M6 | S6 完 | `-p "foo" --output-format=ndjson` headless 跑通 | |
| M7 | S7 完 | 终端即 Claude Code 体验 | |

---

## 阶段回退开关(灰度锁)

| 阶段 | 环境变量 |
|---|---|
| S1 | `XQODER_FEATURE_HTTP_WITH_RETRY=0` |
| S2 | `XQODER_FEATURE_OPENAI_SHIM=0` |
| S3 | `XQODER_FEATURE_ADVANCED_COMPACTION=0` + `XQODER_FEATURE_PROMPT_CACHE=0` + `XQODER_FEATURE_NEW_QUERY_ENGINE=0` |
| S4 | `XQODER_FEATURE_PERMISSION_MODE_V2=0` |
| S5 | `XQODER_DISABLE_HOOKS=1` / `XQODER_MCP_DISABLE_OAUTH=1` |
| S6 | `XQODER_FEATURE_CRON_TASKS=0` / `XQODER_FEATURE_DAEMON=0` |
| S7 | `XQODER_TUI=classic` |

---

## 积压票

> 每完成一期在这里新增/关闭积压项。scorecard 记录"做了什么",这里记录"欠了什么"。

- [ ] **G1** ~~stream idle 看门狗~~ — 已由 P01.1 解决 ✅
- [ ] **G2–G5**(P01 验收单登记):待明确内容,建议 P08 开工前花 5 分钟从 `docs/release/p01-verification.md` 末尾摘出
- [ ] **P03 缓存命中率真验证**(≥ 70%):延后到 P15 `acceptance:metrics:live`,需要真实 API key
- [ ] **P04 分类器真接入 tool-orchestrator**:延后到 P12,本期只上基础设施
- [ ] **P05 图片/PDF 附件合并进 user content-parts**:延后到 P07
- [ ] **token 消耗测量**:P01-P04 都写"未测量",P15 telemetry 归一后统一补

---

## 使用约定

1. **每期开工前**:读这份文档的"当前位置",确认下一期指针。
2. **每期收官后**:
   - `weekly-scorecard.md` 追加验收记录(产出、DoD、测试、token、ADR)
   - 本文档"当前位置"表追加一行,"下一期施工单"指针前移
   - "积压票"区块增补延后事项或关闭已解决项
3. **路线调整**:如果临时从 Route A 切到 Route B,在本文"推荐开工顺序"下追加一行决策日期 + 原因,不删旧计划。
