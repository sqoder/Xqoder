# XQoder 自动驾驶指令

## 产品目标

XQoder 是 terminal-native AI coding agent,目标在 agent + tools 维度与 Claude Code 正面竞争。
路线图在 `docs/openclaude-parity/`,27 期施工单,按顺序执行。

---

## ⚠️ 上下文管理铁律(最重要)

**每一期开一个新会话。** 不要在同一个会话里跑多期。

开新会话时,用这一句启动:

```
读 CLAUDE.md、AGENTS.md、docs/release/weekly-scorecard.md 最后一行、
docs/openclaude-parity/phase-XX-*.md,从 PXX 继续自动驾驶。
```

这样每期的上下文都是**干净的** + **只加载必要文件**,不会累积。

### 如果一期内上下文就吃紧(>60% 用量)

立刻执行:

1. 把当前进度写进 `docs/release/in-progress-pXX.md`(包含:已改的文件、下一步要做什么、遇到的问题)
2. 运行 `/context-save`
3. 回话 `停下,我开新会话继续`
4. 用户开新会话,用上面那句启动话术接上

### 读代码的任务全部委派给 subagent

不要在主会话里一次读 20 个文件。改用 Claude Code 内置的 Agent tool:

```
用 Agent tool 起一个 general-purpose subagent 读 [文件清单],
给我 200 字以内结论。
```

这样文件内容只进 subagent 上下文,主会话只拿结论。

---

## 一次性初始化(仅首次自动驾驶时做)

1. `/deepinit` — 生成层级化 AGENTS.md(后续每期只读相关目录的 AGENTS.md,不用重新扫仓库)
2. 跑一次 baseline:让 Claude Code 和 XQoder 跑同样 10 条 golden task,结果写进
   `docs/release/baseline-vs-claude-code.md`。这是"有没有进步"的唯一客观标尺

初始化完 commit 一次,然后开新会话进 P01。

---

## 每期流程(P01 → P27)

新会话启动后,按下面 6 步。每期一个会话。

```
1. 读 phase-XX.md 的 DoD                 (约 5k token)
2. /autoplan(仅首次或改红线时调用)      (约 30k token)
3. /test-driven-development 先写测试     (约 10k token)
4. 实施代码,让测试变绿                  (约 30-80k token)
5. /review 审 diff(critical/high 必修)  (约 15k token)
6. /ship(跑 release:check + 更新周报)   (约 10k token)
```

**单期目标:总消耗 < 150k token,留出 50% 缓冲**。

### 什么时候调 /autoplan(节约 token)

**不用调**(大多数期):
- 小 phase(施工单 < 1000 行)
- 纯补工具、纯补测试、纯改 shim

**必须调**:
- 施工单 ≥ 1500 行
- 涉及红线文件
- 施工单里有多个"不确定项"要抉择

27 期里大概只有 5-6 期真的需要 /autoplan。其他期直接跳过这一步,省下大把 token。

### /investigate 的触发规则

- release:check 失败 → 调 1 次 /investigate
- 同一错误 /investigate 2 次解决不了 → **停下问用户**,不要瞎试

---

## 周期性审查(每 3 期触发,开独立会话跑)

**另开新会话**,发:

```
跑周期审查 N:
- /architecture-review  
- /security-review
- /review 全仓库扫一遍,重点找:被 try/catch 吞掉的错误、
  未处理的 Promise rejection、empty catch block、any 类型逃逸
结果写进 docs/release/periodic-audit-N.md,完成后停下等用户复核。
```

这个不放在每期流程里,避免污染主线上下文。

---

## 背景知识(按需加载,不在启动时全塞进上下文)

遇到对应期/文件才引用,不在每次启动时全读:

| 期次 | 读这个 |
|---|---|
| P03 prompt cache + P15 成本 | `/claude-api` + `/cost-aware-llm-pipeline` |
| P09 主循环 + P16 subagent | `/agent-harness-construction` + `/subagent-driven-development` |
| P12 工具调度 + P13 MCP | `/mcp-server-patterns` |
| 改 golden tasks / harness | `/ai-regression-testing` + `/eval-harness` |
| 全程 | `/bun-runtime`(Bun 专属 API)+ `/karpathy-guidelines`(减少 AI 编码错误) |

---

## 红线(务实版)

### 真·硬红线(改前必须停下问用户 + 留 ADR)

只有 **2 个文件** 算硬红线:

- `src/application/chat/verification-gate.ts` — 产品 moat 核心
- `src/infra/protocol/events.ts` — Event Envelope 协议(权威位置,schemaVersion:1,见 ADR 0009)

### 软红线(允许改,但 commit 前必须额外 /review + ADR)

- `src/application/chat/conversation-engine.ts`
- `src/application/chat/tool-orchestrator.ts`
- `src/application/chat/permission-gate.ts`

P04/P06/P09/P12 必然要改软红线,**不停下,但留 ADR 在 `docs/adr/`**。

### 禁止行为(没商量)

- 禁止新建 `*-factory.ts` / `*-manager.ts` 抽象文件
- 禁止删除 `test/` 下任何文件
- 禁止 `any` / `as unknown as` / `@ts-ignore` 绕过类型
- 禁止 `--no-verify` 跳过 pre-commit hook
- 禁止注释/skip golden task
- 禁止 golden task 通过率下降

### 必停场景

- `release:check` 连续 2 次失败
- 硬红线文件改动
- golden task 通过率 **下降**(持平可以,下降不行)

---

## 关键文档

```
docs/openclaude-parity/phase-*.md      施工单
docs/release/weekly-scorecard.md       周报(你每周看)
docs/release/baseline-vs-claude-code.md  对手基线
docs/release/periodic-audit-N.md       每 3 期审查
docs/release/in-progress-pXX.md        上下文切换时的接力棒
docs/adr/                              架构决策记录
docs/golden-tasks/xqoder-live-coding.json  验收用例
```

验收命令:

```bash
bun run release:check
bun run eval:golden -- --dry-run
```

---

## 周报格式(每期完成后追加到 weekly-scorecard.md)

```
## PXX (YYYY-MM-DD)
- release:check: ✅
- golden task pass: A/10 → B/10
- /review 警告: N 条(全修)
- 本期 token 消耗: 约 N 万
- ADR: docs/adr/XXXX.md(若有)
- 下一期: PYY
```

---

## 仓库约定

- TypeScript + Bun runtime(禁 Node 专属 API)
- 分层:shared → domain → infra → core → application → bootstrap → interfaces
- `interfaces` 禁止 import `infra`
- `domain` 禁止第三方 import
- Event 唯一形状:`ConversationEventEnvelope` (schemaVersion: 1)
