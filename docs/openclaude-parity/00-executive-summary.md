# 执行摘要 · 读之前先读这份

> 如果你只读一份文档，读这份。

## 工作原则（你刚定下来的）

> **TUI 最后做，先把整个项目的逻辑写清楚。**

因此本路线图已经按 **Logic First** 排序，详见
[`02-execution-order-logic-first.md`](./02-execution-order-logic-first.md)。
整体节奏：**S1 地基 → S2 Provider → S3 主循环 → S4 权限/工具 →
S5 协议/集成 → S6 生态 → S7 TUI**。

## 关键事实（别忽略）

- OpenClaude 源码：**2,348 文件 / 60.4 万行 TypeScript**。
- XQoder 当前 src：约 6.3 万行（是 OpenClaude 的 1/10）。
- **"完全逐行一致"不现实**。本路线图目标是：
  - **行为一致**（协议、决策树、错误语义）；
  - **主要代码 path 覆盖**；
  - **TUI 视觉接近**（不复刻 Ink fork）。
- 全部 27 期跑完估算 **4–6 人月全职**；跑到 S6 主链（不含 TUI）约 **3–4 人月**。

## 本套文档提供了什么

**30 份 Markdown**：

| 文件 | 类型 | 内容 |
|---|---|---|
| `00-executive-summary.md` | 总览 | **本文件** |
| `01-architecture-overview.md` | 总览 | **项目整体逻辑总谱**（分层、数据流、事件协议、流水线、错误模型、测试策略） |
| `02-execution-order-logic-first.md` | 总览 | 7 阶段执行顺序（TUI 最后做） |
| `README.md` | 索引 | fidelity 矩阵 + 27 期清单 |
| `conventions.md` | 规范 | 跨期命名 / feature flag / hook 契约 / 测试布局 |
| `phase-01 … phase-27` | 施工单 | 每期一个独立 PR 任务包 |
| `phase-04-addendum-llm-classifier.md` | 修订 | 对标 yoloClassifier 的 LLM 驱动版本 |

每份施工单包含：
- 任务目标 + 可量化成功判定。
- OpenClaude 对标源文件清单（随时反查真相）。
- 允许 / 禁止修改的文件。
- 模块 / 函数级施工方案（不是"优化一下"式泛泛而谈）。
- 关键代码骨架。
- 验证方案（手动 + 单元 + 边界）。
- 风险与一键回退（每期都留 `XQODER_FEATURE_*` env 开关）。

## 7 阶段 DoD 一览

| 阶段 | 核心 phase | 里程碑（不做 TUI 前可验收的用户价值） |
|---|---|---|
| **S1** 地基 | P01 + P10 | 弱网 429 / ECONNRESET 自动恢复；`features` CLI 可用 |
| **S2** Provider 核心 | P07 + P05 + P08 | 6 家 OpenAI 兼容 provider + Codex 统一路径可用 |
| **S3** 主循环 | P02 + P03 + P09 | 长对话不爆；prompt cache 命中率 ≥ 70% |
| **S4** 权限/工具 | P04 + P04-add + P11 + P12 | autopilot；并发工具；yolo 分类器 |
| **S5** 协议/集成 | P14 + P13 + P15 + P20 + P21 | 10 元 hook；MCP 全家桶；thinking 档位；OAuth |
| **S6** 生态 | P16–P19 + P24–P27 | 子 agent、插件、task/cron、resume/rewind、SDK、40+ 工具 |
| **S7** TUI 收尾 | P06 + P22 + P23 | Ink REPL（**最后做**） |

## 硬串行路径（决不能乱序）

```
P01 → P02 → P03 → P05 → P08
            └──── P09 → (P06 → P22 → P23 属 TUI, 最后)
```

其它期都可在主串行段任一稳定点并行切入。

## v2 相对 v1 勘误

| v1 说法 | v2 真相 |
|---|---|
| yolo 分类器 = 正则黑名单 | 是 **两阶段 LLM 分类器**（1603 行） |
| 只需 3–4 个 OpenAI shim 函数 | `services/api` 下 **10 个** 核心文件 |
| 压缩管线四级就够 | 真实是 **八层**（budget→snip→micro→cachedMicrocompact→apiMicrocompact→sessionMemoryCompact→autoCompact→contextCollapse） |
| Ink = 引 npm 即可 | OpenClaude **自己 fork 了 Ink**（47 文件）；XQoder 用 npm 依赖接受"行为接近"而非"视觉一致" |
| 权限 = 3 模式 | OpenClaude **7 个内部 mode**（含 feature flag 控制的 `auto`） |

## 还不确定的事（每期已各自列出）

共约 20 条 `不确定项`。统一原则：**施工前跑一次真实样本验证**，
不要靠"我觉得 SDK 是这样"。

## 如何开始

```bash
cd docs/openclaude-parity
# 读阅顺序：
# 1) 00-executive-summary.md    本文
# 2) 01-architecture-overview.md 整体逻辑总谱（重点）
# 3) 02-execution-order-logic-first.md 7 阶段执行顺序
# 4) conventions.md             跨期规范
# 5) phase-01-…                 开工
```

## 下一步

**开工 phase-01（S1 第一步）**：

- 它最小、最独立，没有 UI 依赖。
- 它给后续所有 provider / compaction / permission 工作提供错误分类底座。
- 完成验收即获得一个实打实的用户价值：弱网自动恢复。

准备好时告诉我 "开工 phase-01"，我按文档里"模块 1 → 模块 5"顺序把代码落地、
跑 `bun test` 到绿。
