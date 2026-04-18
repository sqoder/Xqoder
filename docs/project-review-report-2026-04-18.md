# XQoder 项目正式审查报告

- 审查日期：2026-04-18
- 审查对象：`XQoder` 项目根目录工作树
- 审查方式：静态代码审查 + 本地验证 + TTY 烟测 + 仓库状态核查
- 审查结论：**项目当前可构建、可测试、可基本运行，但仍存在明显的安全风险、文档与真实行为脱节、旧 TUI 残留、迁移中间态过重、工程约束偏松等问题。**

> 状态回补（2026-04-18 晚些时候）：该报告是一次审查快照，不等于当前主线的最新状态。随后已完成的收口包括：
> - README 的 `TUI Shell` 段落已收敛到 live shell 当前真实支持的本地命令；
> - `src/index.ts` 默认清屏逻辑已移除；
> - 仓库已补入 terminal shell 命令对齐测试。
>
> 因此，阅读本报告时应将已修复项视为历史发现，把“架构 guardrail、遗留目录约束、验证门加强”视为后续重点。

---

## 1. 执行摘要

本次审查确认：

- 当前主线代码 **可以正常 build / lint / test**
- `xqoder tui` 的最小 TTY 对话链路 **可工作**
- 但项目的主要问题已经不再是“能不能跑”，而是：
  1. **本地敏感信息泄露风险仍然存在**
  2. **README、测试、live TUI 的真实能力不一致**
  3. **旧 TUI 体系仍然以大量残留代码形式存在**
  4. **架构迁移仍处于新旧并存的中间态**
  5. **TypeScript 与测试质量门偏松，无法有效阻止回归**

综合判断：**当前阶段最应该做的是继续“收口”和“删”，而不是继续叠加新功能。**

---

## 2. 本次审查范围

本次重点覆盖以下方面：

- CLI / TUI 实际入口与运行链路
- 当前文档与真实行为是否一致
- 旧 TUI 代码是否仍为 live 主线的一部分
- 架构迁移完成度与中间态噪音
- 仓库当前验证状态
- 本地敏感信息与工程卫生

未覆盖内容：

- 全量业务逻辑逐文件审阅
- 外部真实 API 联调
- 长时间交互式人工 UX 体验测试
- 生产级性能基准测试

---

## 3. 审查方法与已执行验证

### 3.1 已执行命令

在项目根目录下执行：

```bash
bun run build
bun run lint
bun run test
bun run xqoder -- tui --prompt '只回复 FRESH_OK'
```

并补充执行：

- 仓库状态检查：`git status`、`git diff --stat`
- 安全扫描：敏感信息与 `console.log` grep
- 文件规模扫描：大文件统计、源码/测试文件数量统计
- TTY 交互烟测：在 live `xqoder tui` 中输入 `/sessions`

### 3.2 已验证结果

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| Build | PASS | `bun run build` 通过 |
| Types / Lint | PASS | `bun run lint` 通过 |
| Tests | PASS | `43 pass / 0 fail` |
| TTY 最小对话烟测 | PASS | `只回复 FRESH_OK` 成功返回 `FRESH_OK` |
| live TUI 本地命令一致性 | FAIL | `/sessions` 未按 README 所述作为本地命令处理 |

### 3.3 审查限制

以下结论基于代码证据与本地会话验证得出：

- 关于“清屏破坏外层 scrollback”的问题，已通过代码证据确认
- 关于 `/sessions` 等命令未接入 live shell，已通过真实 TTY 交互确认
- 关于终端滚动体验是否在所有终端模拟器下完全一致，本次未做全量人工交互回归

---

## 4. 当前项目状态概览

### 4.1 工程规模

- `src/` 文件数：约 **297**
- `test/` 文件数：**9**
- `src + test` 中 `.ts/.tsx` 文件数：约 **287**

### 4.2 代码结构现状

当前顶层源码目录同时存在：

- `src/application`
- `src/domain`
- `src/infrastructure`
- `src/shared`
- 以及旧体系目录：
  - `src/commands`
  - `src/core`
  - `src/platform`
  - `src/infra`
  - `src/services`

说明：

- 新架构方向已经建立
- 但旧目录并未真正失效
- 项目仍处于明显的迁移中间态

---

## 5. 重点问题清单

## P0：高优先级问题

### P0-1 本地敏感信息泄露风险

#### 现象

在本地工作区中发现真实样式的 API Key 与敏感上下文出现在：

- `.env`
- `.omx/logs/*.jsonl`

#### 证据

- `./.env`
- `./.omx/logs/turns-2026-04-17.jsonl`
- `./.gitignore:3-10`

#### 影响

- 即使这些文件当前未被 git 跟踪，本地明文密钥仍然构成真实风险
- 一旦发生误传、同步、打包、截图、备份扩散，风险会被放大

#### 判断

- **这是安全问题，不是文档问题**
- 当前 `.gitignore` 对 `.env` 与 `.omx/` 的忽略是正确的
- 但忽略规则并不能替代密钥轮换与本地日志清理

#### 建议

1. 立即轮换当前暴露的 key
2. 清理 `.omx/logs/` 中包含敏感值的日志
3. 审查是否还有其他导出文件、截图、缓存中包含同类信息

---

### P0-2 README / 测试 / live TUI 真实行为不一致

#### 现象

README 中宣称 `xqoder tui` 支持：

- `/sessions`
- `/resume`
- `/share`

但 live terminal shell 当前真实处理的本地命令只有：

- `/quit`
- `/exit`
- `/new`
- `/session new`

#### 证据

- README 声明：
  - `README.md:223-236`
- live shell 实现：
  - `src/platform/terminal/app/run-terminal-app.ts:281-299`
- 旧 TUI 命令解析器：
  - `src/platform/tui/commands.ts:121-190`
- 对旧解析器的测试：
  - `test/system-commands.test.ts:39`
  - `test/system-commands.test.ts:250-340`

#### 额外验证

在真实 TTY 烟测中输入 `/sessions` 后，结果不是触发本地 session 列表逻辑，而是被当作普通对话内容继续发送，说明：

- README 与真实产品行为不一致
- 测试通过不代表 live shell 真的支持这些命令

#### 影响

- 用户会被 README 误导
- 开发者会误以为旧 TUI slash surface 仍是正式能力
- 项目会长期处于“看起来有、实际上没有”的状态

#### 建议

必须二选一：

1. **收口方案（推荐）**  
   README 与测试只描述当前 live shell 真实能力
2. **回接方案**  
   把 `/sessions`、`/resume`、`/share` 真正接回 live shell

当前项目状态更适合 **收口方案**。

---

### P0-3 主入口仍会清屏，破坏外层 scrollback 目标

#### 现象

项目当前仍在 TTY 启动时执行 `console.clear()`。

#### 证据

- `src/index.ts:14-15`
- `src/index.ts:32-35`
- `src/commands/integrations/lsp-ui.tsx:48-50`

#### 影响

- 会清掉用户已有终端历史输出
- 与“完全依赖外层终端 scrollback”的产品目标直接冲突
- 即使没有 alternate screen，也会破坏上层终端体验

#### 建议

1. 删除主入口默认清屏逻辑
2. 删除 `lsp ui` 中的默认清屏逻辑
3. 如确有需要，改为显式 `--clear` 选项，而不是默认行为

---

## P1：中高优先级问题

### P1-1 旧 TUI 体系残留过大，且部分只剩“测试在用”

#### 现象

`src/platform/tui` 下仍残留大量旧系统文件，包括：

- layout
- commands
- commands processor
- context store
- 旧组件层

其中多处还保留了明显的旧体系注释：

- `Legacy SplitLayout`
- `Legacy PageManager`
- `Legacy Adapter`

#### 证据

- `src/platform/tui/layout.tsx`
- `src/platform/tui/commands.ts`
- `src/platform/tui/commands/processor.ts`
- `src/platform/tui/context/TuiStore.tsx`
- `src/platform/tui/editor/editor-layout.ts`

#### 实际状态判断

- `parseTuiCommand` / `processTuiCommand` 并未形成 live 主线的一部分
- 当前几乎只剩测试在引用 `parseTuiCommand`

#### 影响

- 仓库复杂度被抬高
- 新人容易误判这是正式产品能力
- 后续迁移与收口成本被持续放大

#### 建议

按“保留最小活跃集合 + 整块删除不可达旧壳层”的方式处理，而不是继续修修补补。

---

### P1-2 架构迁移停在新旧并存的中间态

#### 现象

README 与项目 memory 明确要求新代码收敛到：

- `src/bootstrap`
- `src/interfaces`
- `src/application`
- `src/domain`
- `src/infrastructure`
- `src/shared`

但当前实际仍保留大量旧别名与旧目录：

- `src/commands`
- `src/core`
- `src/platform`
- `src/infra`
- `src/services`

#### 证据

- `README.md:61-77`
- `tsconfig.json:21-40`
- `src/services/*.ts`

#### 影响

- 新架构是“目标”，旧架构仍是“现实”
- 开发者依然可能继续向旧目录写逻辑
- 迁移收益会被长期稀释

#### 建议

1. 为旧目录建立明确的“只兼容、不新增”规则
2. 逐步收紧 tsconfig alias 与目录入口
3. 将 re-export 包装层尽量下沉或删除

---

### P1-3 当前仓库变更面过大，审查与回归风险极高

#### 现象

当前工作区存在大规模重构/清理痕迹。

#### 证据

- `git diff --shortstat`（排除 `.pnpm-store`）：
  - 约 `433 files changed`
  - `341 insertions`
  - `80831 deletions`
- `git status`（排除 `.pnpm-store`）：
  - 仍有约 `748` 条路径变化

#### 影响

- review 难度极高
- 功能修复、架构迁移、仓库清理混在同一变更面中
- 回滚与定位回归成本上升

#### 建议

后续工作必须拆成更小的提交/PR：

1. 安全修复
2. 文档收口
3. 旧 TUI 删除
4. 大文件拆分
5. 类型收紧

---

## P2：中优先级问题

### P2-1 大文件与 God Object 仍然明显

#### 代表文件

- `src/interfaces/http/server.ts`：2588 行
- `src/core/agent/lsp.ts`：1763 行
- `src/core/agent/mcp.ts`：1618 行
- `src/platform/tui/layout.tsx`：975 行
- `src/platform/tui/commands.ts`：745 行
- `src/platform/tui/commands/processor.ts`：736 行

#### 影响

- 难测
- 难 review
- 容易积累隐藏耦合
- 迁移成本持续升高

#### 建议

优先拆分：

1. HTTP server：路由 / 流 / 会话 / 问题交互 / 静态资源
2. LSP：连接管理 / 文档同步 / 请求编解码 / 结果格式化
3. MCP：握手 / 工具发现 / 工具调用 / 进程管理

---

### P2-2 包装层与空壳 scaffold 偏多

#### 现象

当前存在多处只做 re-export 的兼容层，例如：

- `src/services/chat-service.ts`
- `src/services/config-service.ts`
- `src/services/session-resolve.ts`

同时也存在较多空壳 index：

- `src/application/*/index.ts`
- `src/domain/*/index.ts`
- `src/infrastructure/*/index.ts`

#### 影响

- 增加跳转成本
- 容易制造“结构已经很完整”的假象
- 实际维护价值有限

#### 建议

- 保留真正必要的稳定入口
- 删除没有消费者或仅增加认知负担的空壳层

---

### P2-3 类型约束偏松

#### 证据

- `tsconfig.json:9-10`
  - `strict: false`
  - `noImplicitAny: false`

额外扫描发现：

- 当前 `src/test` 中仍有约 **23** 处 `any` 用法

#### 影响

- 迁移期间问题更难被编译期发现
- 包装层、旧接口、临时桥接逻辑更容易失控

#### 建议

采用分阶段收紧：

1. 新目录先启用更严格规则
2. 对 `application / domain / infrastructure` 优先消灭 `any`
3. 最后再推动全仓 strict 收紧

---

### P2-4 测试覆盖面不足，缺少 coverage gate

#### 现象

当前测试结果虽然全绿，但总测试文件数量很少。

#### 证据

- 测试文件数：`9`
- `package.json:12-20` 中没有 coverage 检查
- `release:check` 仅包括：
  - build
  - test
  - lint

#### 影响

- “测试通过”不代表关键路径被真正保护
- 大规模迁移时容易出现漏测区域

#### 建议

增加至少三类保护：

1. terminal app 行为测试
2. 文档与 live 行为一致性检查
3. 覆盖率门槛（建议 80%+，至少先对关键模块建立门槛）

---

### P2-5 文档与运行状态混入个人绝对路径

#### 证据

- `README.md:65-66`
- `.omx/state/session.json:5`
- `.omx/state/current-task-baseline.json:6`

#### 问题

- README 中出现本机绝对路径
- `.omx` 状态仍指向旧位置 `/Users/wangxinglin/Documents/Xqoder`

#### 影响

- 文档不可移植
- 本地运行状态可能与当前仓库真实路径漂移

#### 建议

1. README 中统一改为相对路径或通用路径
2. 对 `.omx` 的路径漂移做一次状态重置或迁移校正

---

## 6. 结构与维护性观察

### 6.1 当前更像“迁移中的产品”，不是“已经完成收口的产品”

优点：

- 新架构方向明确
- 核心 build / lint / test 仍能保持通过
- terminal shell 主链路已经具备基本可用性

问题：

- 旧 TUI 体系尚未真正退出历史舞台
- 文档、测试、live 行为未统一
- 大量中间兼容层仍在制造噪音

### 6.2 当前最适合的工作方向

不是继续铺新功能，而是：

1. **安全收口**
2. **文档收口**
3. **入口收口**
4. **旧系统删除**
5. **质量门收紧**

---

## 7. 建议执行顺序

### 第一阶段：立即处理

1. 轮换并清理本地敏感信息
2. 删除默认清屏逻辑
3. 将 README 改为只描述当前 live shell 真实能力
4. 明确 `/sessions`、`/resume`、`/share` 的命运：
   - 要么回接
   - 要么移除文档与测试背书

### 第二阶段：结构收口

5. 切分 `src/platform/tui` 的“保留集合”和“删除集合”
6. 删除只剩测试在用的旧 TUI parser / processor 岛
7. 清理不必要的 re-export 包装层

### 第三阶段：工程强化

8. 拆分大文件
9. 收紧 TypeScript 规则
10. 增加 coverage / security gate

---

## 8. 建议验收标准

完成上述收口后，建议至少满足以下验收条件：

### 行为一致性

- README 中列出的 TUI 命令全部可在 live shell 中实际使用
- 不再出现 README 声称支持、实际未接入的命令

### 安全性

- 工作区内无明文真实 key
- `.omx` 日志不再保存敏感值

### 终端体验

- 默认启动不清屏
- 外层终端 scrollback 不被破坏

### 结构完整性

- `src/platform/tui` 仅保留 live 主线仍在使用的最小集合
- `src/services` 等兼容层显著收缩

### 工程质量

- 关键路径存在真实行为测试
- 增加 coverage 或至少关键模块测试门
- 新架构目录优先启用更严格类型约束

---

## 9. 最终结论

XQoder 当前**不是一个坏项目**，相反，它已经具备了清晰的新架构方向、可工作的 terminal 主链路，以及基本健康的构建与测试状态。

但它现在最大的敌人不是功能缺失，而是：

- 安全清理不彻底
- 文档与真实行为脱节
- 旧 TUI 幻影持续存在
- 架构迁移没有完全收口
- 工程门槛不足以阻止中间态继续扩大

因此，本阶段最合理的决策不是“继续叠新功能”，而是：

> **先把项目从迁移中间态拉回到一个收口、可解释、可维护、可验证的状态。**

在这一步完成前，继续扩展功能只会持续放大维护成本。
