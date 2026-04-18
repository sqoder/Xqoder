# XQoder 全项目审查与清理建议

更新时间：2026-04-18

## 目标

这份文档用于总结当前 XQoder 仓库在完成 terminal shell 收口之后，仍然存在的：

- 活跃问题
- 误导性文档/测试
- 已脱离主线路径的遗留代码
- 建议删除或迁移的文件
- 建议继续拆分的超大文件

重点不是“代码风格好不好”，而是判断哪些东西还在真正服务产品，哪些已经是仓库噪音。

## 本次审查范围

审查基于当前本地代码树，重点覆盖：

- CLI / TUI 真实入口链路
- `src/platform/tui` 剩余模块
- 文档与测试是否仍描述真实能力
- `src/services`、`src/bootstrap`、`src/commands` 等目录中的包装层/兼容层
- TypeScript 工程约束
- 大文件与神文件

## 审查方法

本次结论来自以下几类证据：

1. 真实入口链路核查  
   从 `src/index.ts` 出发，确认 live CLI/TUI 走向：
   - `src/index.ts`
   - `src/bootstrap/cli-main.ts`
   - `src/interfaces/cli/index.ts`
   - `src/interfaces/tui/index.ts`
   - `src/platform/terminal/app/run-terminal-app.ts`

2. 静态依赖可达性扫描  
   用本地 import 图从 `src/index.ts` 向下追踪，识别不可达文件。

3. 全仓关键字扫描  
   检查 `fullscreen`、`mouse capture`、`/mouse`、`Ctrl+G`、`terminal-core` 等残留。

4. 本地验证结果  
   已有验证结果：
   - `bun run build` 通过
   - `bun run test` 通过，`43 pass / 0 fail`
   - `bun run xqoder -- tui --prompt '只回复 FRESH_OK'` 输出为追加式 scrollback shell

## 执行摘要

当前仓库的主要问题已经不是某几个函数写得差，而是：

1. **产品主线已经切换到 terminal shell，但仓库里还残留着一整套旧 TUI 岛。**
2. **README、测试、辅助命令仍在描述/验证一部分已经不在 live 主线上的能力。**
3. **有少量活跃 bug 仍然破坏外层 scrollback 的目标。**
4. **工程约束过松，导致这些漂浮模块难以及时暴露。**

结论很直接：

- 现在应该继续做的是“删”和“收口”，不是继续叠新功能。
- 在恢复任何新 UI 能力之前，先把旧全屏 TUI 残留彻底清掉。

---

## P0 问题

### 1. 主入口仍会清空外层终端 scrollback

**证据**

- `src/index.ts:14-16`
- `src/commands/integrations/lsp-ui.tsx:48-50`

当前行为：

- `src/index.ts` 在 `xqoder` 或 `xqoder tui` 启动时执行 `console.clear()`
- `lsp ui` 启动时也执行 `console.clear()`

这与当前目标直接冲突：  
你已经明确要求 **完全依赖外层终端 scrollback**，而不是内置全屏层。

**影响**

- 会直接清掉用户上方历史输出
- 在 iTerm2 / Terminal.app 中体验与预期相反
- 即使没有全屏 alternate screen，也仍然破坏“外层滚动历史”能力

**解决方案**

方案 A，推荐：

- 彻底移除 `src/index.ts` 中的 `console.clear()`
- 彻底移除 `src/commands/integrations/lsp-ui.tsx` 中的 `console.clear()`

方案 B，退而求其次：

- 只在显式 `--clear` 或内部开发调试标志下清屏

**验证**

手动验证：

```bash
echo before-1
echo before-2
bun run xqoder -- tui
```

进入后退出，确认：

- 终端上方仍能看到 `before-1` / `before-2`
- 没有启动即清屏

---

### 2. Live TUI 能力与 README/测试已经脱节

**证据**

- 真实 live shell：`src/interfaces/tui/index.ts:93-111`
- live shell 本地命令仅见：`src/platform/terminal/app/run-terminal-app.ts:281-299`
- README 仍声明 `/sessions`、`/resume`、`/share`：`README.md:223-236`
- 测试仍围绕旧解析器：`test/system-commands.test.ts:39`, `test/system-commands.test.ts:254-322`
- 旧解析器仍保留整套 slash surface：`src/platform/tui/commands.ts:121-170`, `src/platform/tui/commands.ts:427-485`

当前现实是：

- 正式入口只走 terminal shell
- live shell 当前真实支持的本地指令很少：
  - `/quit`
  - `/exit`
  - `/new`
  - `/session new`

但 README 和测试还在传达更强的旧 TUI 命令面。

**影响**

- 用户理解会错
- 测试通过不代表真实 CLI/TUI 行为正确
- 后续开发者容易围绕旧模块继续加能力，形成第二套系统

**解决方案**

必须二选一：

方案 A，推荐：

- 把 README 改成只描述 **terminal shell 当前真实支持** 的能力
- 删除或重写依赖 `src/platform/tui/commands.ts` 的“假主线测试”
- 为 `run-terminal-app.ts` 建立真实的终端命令行为测试

方案 B：

- 如果你确定 `/sessions`、`/resume`、`/share` 等应当继续保留
- 那么把 `src/platform/tui/commands.ts` 真正接回 live shell，而不是只留在死代码岛里

当前项目状态更适合方案 A。

**验证**

建议新增 3 类测试：

1. shell 本地命令测试
   - `/new`
   - `/exit`
   - 普通消息输入

2. README 对齐检查
   - 文档中列出的命令必须可在 live shell 使用

3. 行为烟测

```bash
bun run xqoder -- tui --prompt "只回复 TEST_OK"
```

确认输出是 terminal shell 追加式内容，而不是依赖旧 TUI slash registry。

---

## P1 问题

### 3. `src/platform/tui` 仍残留一整块不可达旧系统

**证据**

静态 import 可达性扫描结果：

- 从 `src/index.ts` 出发，识别到 **95 个不可达文件**
- 其中 **44 个位于 `src/platform/tui`**

代表性不可达文件包括：

- `src/platform/tui/context/TuiServiceProvider.tsx`
- `src/platform/tui/context/TuiStore.tsx`
- `src/platform/tui/commands.ts`
- `src/platform/tui/commands/processor.ts`
- `src/platform/tui/layout.tsx`
- `src/platform/tui/logs-page.tsx`
- `src/platform/tui/message-viewport.tsx`
- `src/platform/tui/components/kimi/*`
- `src/platform/tui/components/shell/DialogManager.tsx`
- `src/platform/tui/theme.ts`
- `src/platform/tui/sidebar.tsx`

其中还可以看到明显的遗留标记：

- `src/platform/tui/layout.tsx` 中保留 `Legacy SplitLayout` / `Legacy PageManager`
- `src/platform/tui/context/TuiStore.tsx` 中保留 `Legacy Adapter`
- `src/platform/tui/components/image.ts` 还保留完整的旧终端图片渲染器

**影响**

- 仓库复杂度虚高
- 新人会误判这是正式产品能力
- 测试和文档容易继续绑定旧模块
- 每次改终端主线时都容易漏掉旧壳层残留

**解决方案**

建议按“整块删除”处理，而不是继续逐个修饰。

建议处理顺序：

1. 先确认 `src/platform/tui/input/ime-text-input.tsx` 是否仍被 `lsp-ui` 使用  
   当前答案：**是**

2. 再把 `src/platform/tui` 分为两类：

- **保留**
  - 仍被 live 主线或 `lsp-ui` 使用的最小集合
- **删除**
  - 旧 shell / 旧 context / 旧 dialog / 旧 layout / 旧 kimi UI / 旧 state 管理

3. 删除后重跑静态可达性扫描，直到 `src/platform/tui` 只剩最小活跃子集

**验证**

建议用以下标准验收：

- 从 `src/index.ts` 出发，`src/platform/tui` 中不可达文件数显著下降
- `bun run build` 通过
- `bun run test` 通过
- `bun run xqoder -- tui --prompt '只回复 FRESH_OK'` 继续正常

---

### 4. 旧包装层/兼容层太多，挂在 `src/` 里制造噪音

**证据**

当前这类文件很多只是转发或兼容壳：

- `src/services/chat-service.ts`
- `src/services/config-service.ts`
- `src/services/session-resolve.ts`
- `src/commands/core/tui.tsx`
- `src/bootstrap/tui-main.ts`
- `src/bootstrap/index.ts`
- `src/interfaces/index.ts`

例子：

- `src/services/chat-service.ts:1` 只是 `export * from '../application/chat/index.js'`
- `src/commands/core/tui.tsx:1-6` 只是转发到 `interfaces/tui`
- `src/bootstrap/tui-main.ts:8-10` 只是 `createXQoderEntrypoints().runTui(options)`

另一个明显不该留在 `src/` 的文件是：

- `src/commands/workflows/fix.e2e-utils.ts`

它本质上是 E2E 辅助工具，应该属于 `test/` 或单独的 `scripts/`。

**影响**

- 目录层次膨胀
- 很难分辨“正式 API”与“历史兼容壳”
- 提高误用概率

**解决方案**

建议分三类处理：

1. **直接删除**
   - 没有消费者的兼容转发文件

2. **迁移到 test/**
   - `fix.e2e-utils.ts` 这类测试工具

3. **保留但标注为 compatibility shim**
   - 如果确实还有外部调用者，先保留并在文件头明确说明淘汰计划

**验证**

- 搜索这些 shim 文件时，确认仍有明确调用方；否则删除
- 删除/迁移后 `build`、`test` 不回归

---

### 5. TypeScript 约束过松，隐藏真实问题

**证据**

- `tsconfig.json:9` `strict: false`
- `tsconfig.json:10` `noImplicitAny: false`

**影响**

- 死代码和接口漂移更难发现
- “误传了一个对象但编过了”这类问题会长期存在
- 与当前“收口、删旧系统”的目标相反

**解决方案**

不要一次性全开严格模式，否则会炸很大。

建议分阶段：

第一阶段：

- 保持 `strict: false`
- 先打开：
  - `noImplicitAny`
  - `noUnusedLocals`
  - `noUnusedParameters`

第二阶段：

- 为核心目录单独加 stricter tsconfig
  - `src/interfaces`
  - `src/platform/terminal`
  - `src/application/system`

第三阶段：

- 再逐步推进到更广范围

**验证**

- 每次启用一个新规则后跑：

```bash
bun run lint
bun run build
bun run test
```

- 新规则优先覆盖当前 live 主线目录

---

## P2 问题

### 6. 部分大文件已经是神文件，应拆但不应现在盲删

**证据**

当前超大文件：

- `src/interfaces/http/server.ts` 2588 行
- `src/core/agent/lsp.ts` 1763 行
- `src/core/agent/mcp.ts` 1618 行
- `src/infra/shared/config.ts` 1567 行
- `src/platform/tui/components/dialog.tsx` 1298 行
- `src/platform/tui/layout.tsx` 975 行
- `src/platform/tui/commands.ts` 745 行
- `src/platform/tui/commands/processor.ts` 736 行

其中有两类：

1. **应拆分但仍是活代码**
   - `interfaces/http/server.ts`
   - `core/agent/lsp.ts`
   - `core/agent/mcp.ts`
   - `infra/shared/config.ts`

2. **大而且已偏离主线**
   - `platform/tui/layout.tsx`
   - `platform/tui/commands.ts`
   - `platform/tui/commands/processor.ts`
   - `platform/tui/components/dialog.tsx`

**影响**

- 活代码部分：维护成本高，改动风险大
- 旧 TUI 部分：已经不在主线，却继续制造认知负担

**解决方案**

- 活代码神文件：做“拆”
- 旧 TUI 神文件：做“删”

建议不要混为一谈。

---

## 建议删除 / 迁移清单

### A. 优先删除候选

以下文件/模块建议优先进入删除列表：

- `src/platform/tui/context/TuiServiceProvider.tsx`
- `src/platform/tui/context/TuiStore.tsx`
- `src/platform/tui/commands.ts`
- `src/platform/tui/commands/processor.ts`
- `src/platform/tui/layout.tsx`
- `src/platform/tui/logs-page.tsx`
- `src/platform/tui/message-viewport.tsx`
- `src/platform/tui/sidebar.tsx`
- `src/platform/tui/theme.ts`
- `src/platform/tui/timeline.ts`
- `src/platform/tui/use-dimensions.ts`
- `src/platform/tui/components/kimi/*`
- `src/platform/tui/components/shell/DialogManager.tsx`
- `src/platform/tui/components/session-transcript.ts`
- `src/platform/tui/components/image.ts`
- `src/platform/tui/safe-runtime.ts`
- `src/platform/tui/safe-tty.ts`

前提：确认这些文件不再被 live shell 或 `lsp-ui` 使用。

### B. 迁移到 `test/` 的候选

- `src/commands/workflows/fix.e2e-utils.ts`
- `src/commands/__fixtures__/fix/*`（如确属测试资产，也应重新检查放置位置）

### C. 删除或合并的兼容壳候选

- `src/services/chat-service.ts`
- `src/services/config-service.ts`
- `src/services/session-resolve.ts`
- `src/commands/core/tui.tsx`
- `src/bootstrap/tui-main.ts`
- `src/bootstrap/index.ts`
- `src/interfaces/index.ts`

---

## 建议修改清单

### 必改

1. `src/index.ts`
   - 去掉 `console.clear()`

2. `src/commands/integrations/lsp-ui.tsx`
   - 去掉 `console.clear()`

3. `README.md`
   - 只描述 live terminal shell 当前真实支持的命令

4. `test/system-commands.test.ts`
   - 不要再把旧 `parseTuiCommand` 当成 live TUI 真相

### 需要决策后再改

1. `src/platform/tui/commands.ts`
   - 要么接回 live shell
   - 要么彻底删除

2. `src/platform/tui/layout.tsx`
   - 如果旧 TUI 不回归，直接删除

3. `src/platform/tui/components/dialog.tsx`
   - 如果对话框壳层没有 live 使用场景，直接删除

---

## 推荐执行顺序

### 第 1 阶段：修活 bug + 修假描述

目标：让产品对外叙述先和真实行为一致。

执行：

- 删除 `console.clear()`
- 改 README
- 改 live shell 测试
- 标记旧 TUI 解析测试为非主线，或删除

验收：

- scrollback 不被清空
- README 与实际功能一致

### 第 2 阶段：删除旧 TUI 岛

目标：仓库里不再保留第二套终端产品。

执行：

- 批量删除 `src/platform/tui` 中不可达旧模块
- 保留仍被 `lsp-ui` 用到的最小输入组件集合

验收：

- `src/platform/tui` 文件数显著下降
- 静态可达性扫描中的不可达文件数显著下降

### 第 3 阶段：清理兼容壳

目标：目录结构更接近真实产品边界。

执行：

- 删除 `src/services/*` 这类单纯转发层
- 删除 `bootstrap` / `commands/core` 中无消费者包装层
- 把 E2E 工具迁到 `test/`

验收：

- 目录结构更清晰
- 不再有一堆“看起来像主线，其实不是”的入口壳

### 第 4 阶段：再拆活代码神文件

目标：减少未来维护成本。

执行：

- 拆 `interfaces/http/server.ts`
- 拆 `infra/shared/config.ts`
- 拆 `core/agent/lsp.ts`
- 拆 `core/agent/mcp.ts`

这一步不是当前最急，但应该排进后续 roadmap。

---

## 建议的验证清单

每一轮清理后都跑：

```bash
bun run lint
bun run build
bun run test
```

再补 3 个手动验证：

### 1. scrollback 验证

```bash
echo before-1
echo before-2
bun run xqoder -- tui
```

退出后确认：

- 上方输出还在
- 没有被清屏

### 2. shell 追加式输出验证

```bash
bun run xqoder -- tui --prompt "只回复 TEST_OK"
```

确认输出是：

- `You`
- `[thinking]`
- `XQoder`
- `> `

而不是整屏重绘。

### 3. 依赖可达性验证

建议保留一份本地脚本，从 `src/index.ts` 出发扫描不可达文件，作为清理回归工具。

目标：

- `src/platform/tui` 中只剩明确仍被使用的最小集合

---

## 最终结论

XQoder 当前最需要的不是再加一层新 agent 玩法，而是先把仓库现实与产品现实对齐。

简化成一句话：

> **先删掉旧系统，再谈新系统。**

当前建议优先级：

1. 去掉清屏
2. 修 README / 测试假描述
3. 批量删除旧 `platform/tui` 岛
4. 清理兼容壳
5. 最后再拆活代码神文件

