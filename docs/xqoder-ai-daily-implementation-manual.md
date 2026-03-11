# XQoder AI 驱动实现操作文档

## 1. 文档定位

这份文档是给“1 个人 + AI 工具”使用的实施手册。

它不是纯架构说明，而是把 XQoder 当前仓库按 42 天拆成可执行日程，目标是在**全程借助 AI 编码工具**的前提下，把项目从“已有平台雏形”推进到“具备工业级骨架”。

适用对象：

1. 你自己一个人主导项目
2. 全程使用 Codex、Claude Code、Cursor、OpenCode 之类 AI 工具生成和修改代码
3. 每天能投入 6 到 7 小时
4. 愿意每天做一次验证和一次总结

这份计划默认是 **42 个工作日**。

如果你每周工作 6 天，大约 7 周完成。
如果你每周工作 7 天，大约 6 周完成。

---

## 2. 先说结论：你应该怎么用 AI 做这个项目

### 2.1 你不是让 AI “代替你做架构”

你要让 AI 做的是：

1. 帮你读代码
2. 帮你写局部实现
3. 帮你补测试
4. 帮你做回归检查
5. 帮你收口总结

你不能交给 AI 的是：

1. 产品边界判断
2. 包职责划分
3. 版本策略
4. 最终验收标准

所以你的角色不是“写代码的人”，而是：

**每天给 AI 一个边界清晰、验收明确、文件范围清楚的施工任务。**

### 2.2 AI 写代码时的 5 条铁律

每天都照这个做：

1. 一次只解决一个主要问题，不要一个 prompt 塞 5 个目标。
2. 每个 prompt 都写清楚目标、文件、约束、验收方式。
3. 让 AI 先读代码再改代码，不要上来就生成。
4. 每次实现后必须要求 AI 自检并列出风险。
5. 每天结束必须让 AI 生成“今天变更摘要 + 明天接力上下文”。

### 2.3 适合 XQoder 的 AI 工作法

这个项目已经是 monorepo，并且已经有 `protocol / plugin-sdk / core-runtime / agent / runtime / workflow / cli` 的层次。

所以最适合的 AI 工作方式是：

1. 上午做“读代码 + 设计边界 + 小范围改动”
2. 中午前做“第一次构建和测试”
3. 下午做“补测试 + 做第二轮改动 + 对齐文档”
4. 晚上收口“总结、风险、明天 prompt”

---

## 3. 每天固定时间表

下面这套时间表每天都一样，不要随意改。真正变化的是当天主题和目标文件。

### 09:00 - 09:30

启动阶段。

你要做的事：

1. 打开昨天的变更和今天的目标
2. 把今天要改的文件列出来
3. 把今天的验收条件写成 3 到 5 条
4. 把这些内容发给 AI，先让它读代码并给最小实施方案

### 09:30 - 11:30

主实现阶段。

你要做的事：

1. 让 AI 只修改当天范围内的文件
2. 每次改动控制在一个明确子问题内
3. 第一轮目标是把主链路打通，不追求完美抽象

### 11:30 - 12:00

第一次验证阶段。

至少执行：

```bash
cd /Users/wangxinglin/Desktop/Xqoder
pnpm build
```

如果当天改动了测试覆盖到的包，再执行对应测试。

### 13:30 - 15:00

补强阶段。

你要做的事：

1. 让 AI 补测试
2. 让 AI 修回归问题
3. 让 AI 把边界条件补齐

### 15:00 - 16:00

第二次验证阶段。

建议执行：

```bash
cd /Users/wangxinglin/Desktop/Xqoder
pnpm test
pnpm lint
```

如果全量太慢，至少跑受影响包的测试，但当日结束前要有一次全量验证。

### 16:00 - 17:00

文档和收口阶段。

你要做的事：

1. 更新 README 或 docs 中受影响的说明
2. 记录今天做完了什么
3. 列出还没解决的风险

### 17:00 - 17:30

交接阶段。

你要让 AI 输出：

1. 今天修改了哪些文件
2. 哪些测试通过了
3. 剩下什么风险
4. 明天最适合先做什么

---

## 4. 每天都能复用的 4 个通用提示词

下面这 4 个 prompt 你每天都能用。后面的日程里只给“当天主提示词”，这 4 个作为固定搭子。

### 4.1 开工提示词

```text
你现在是这个仓库的核心工程师。请先不要急着写代码，先阅读我指定的文件，理解当前实现，再给我一个最小可行改动方案。

今天目标：
[把今天的目标写在这里]

必须先阅读这些文件：
[把今天要看的文件写在这里]

约束：
1. 只改和今天目标直接相关的文件
2. 保持现有行为尽量不变
3. 优先最小正确改动
4. 如果需要补测试，直接补
5. 输出先给方案，再实施

请按这个顺序输出：
1. 你对当前实现的理解
2. 你建议的最小改动方案
3. 风险点
4. 然后直接开始实施
```

### 4.2 卡点提示词

```text
我在 XQoder 仓库里做这件事时卡住了：
[描述卡点]

请你先基于这些文件找根因，不要泛泛而谈：
[列文件]

请按这个顺序输出：
1. 最可能的 3 个根因
2. 你认为概率最高的根因
3. 最小验证步骤
4. 如果验证通过，应该怎么修
5. 如果验证失败，第二选择是什么
```

### 4.3 审查提示词

```text
请你以严格 code review 模式检查我今天这部分改动，重点找：
1. 行为回归
2. 分层破坏
3. 命名和职责漂移
4. 测试缺口
5. 未来会放大成架构债的问题

请不要先总结优点，先列问题，按严重级别排序。
```

### 4.4 收尾提示词

```text
请基于今天的改动，给我输出一份交接摘要。

要求：
1. 只说今天真正完成的事
2. 列出修改过的文件
3. 列出已验证的命令和结果
4. 列出剩余风险
5. 给我一个明天开工就能直接复制的提示词
```

---

## 5. 42 天总体路线图

| 阶段 | 天数 | 主题 | 结果 |
| --- | --- | --- | --- |
| 阶段 A | Day 01 - Day 07 | 基线、分层、测试骨架 | 确认当前状态和目标边界 |
| 阶段 B | Day 08 - Day 14 | 插件化装配主链路 | Runtime 能装配内建命令和能力 |
| 阶段 C | Day 15 - Day 21 | Session、审计、资产层 | 存储和回滚能力收口 |
| 阶段 D | Day 22 - Day 28 | Provider 生态拆分 | 模型和 Agent 接入标准化 |
| 阶段 E | Day 29 - Day 36 | 工具、工作流、多产品壳 | CLI/TUI/Electron 共用服务链路 |
| 阶段 F | Day 37 - Day 42 | 工业化治理 | CI、发布、迁移、观测、安全 |

---

## 6. 每天的详细实施计划

## Day 01：建立当前仓库基线

- 目标：确认当前包职责、主链路、缺口列表，生成你自己的实施 backlog。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/README.md`
  `/Users/wangxinglin/Desktop/Xqoder/package.json`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/program.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/src/runtime-kernel.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/providers.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/events.ts`
- 当天动作：
  1. 跑一次 `pnpm build`、`pnpm test`、`pnpm lint`
  2. 让 AI 生成“当前实现 vs 目标架构”的 gap 表
  3. 把缺口按 P0 / P1 / P2 排序
- 当天产出：一份你认可的 backlog 清单
- 当天验收：你能清楚回答“先做哪 7 件事”
- 当天主提示词：

```text
你现在要做的是 XQoder 仓库的第一天架构盘点。请先阅读 README、package.json、packages/cli/src/program.ts、packages/core-runtime/src/runtime-kernel.ts、packages/plugin-sdk/src/providers.ts、packages/protocol/src/events.ts。

目标：
1. 用当前代码真实状态做盘点
2. 对照“内核 + provider + plugin + protocol”目标架构
3. 给出一个 6 周内可执行的 P0/P1/P2 backlog

约束：
1. 不空谈未来大图，只基于现有代码
2. 优先指出最影响后续扩展的结构问题
3. 输出要能直接转成实施计划

请输出：
1. 当前架构摘要
2. 7 个最关键缺口
3. 优先级排序理由
4. 建议先做的第一周任务
```

## Day 02：给 protocol / plugin-sdk / core-runtime 补测试骨架

- 目标：让平台底层包不再是“只能靠人工感觉改”的状态。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/package.json`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/package.json`
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/package.json`
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/index.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/index.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/src/index.ts`
- 当天动作：
  1. 给这三个包补最小测试能力
  2. 建立 contract test 目录或最小 smoke test
  3. 确保后续改协议和插件接口时有基本保护
- 当天产出：三个底层包至少能跑最小测试
- 当天验收：修改这些包时不再只有 `tsc --noEmit`
- 当天主提示词：

```text
今天要给 XQoder 的三个底层包补测试骨架：@xqoder/protocol、@xqoder/plugin-sdk、@xqoder/core-runtime。

请先阅读它们的 package.json 和 src/index.ts，再设计一个最小可持续的测试方案。

要求：
1. 优先最小接入，不要大改 monorepo
2. 为后续协议、插件契约、runtime kernel 演进提供基本保护
3. 如果适合用 vitest，就直接接；如果已有更小方案更合适，也可以
4. 同时补 1 到 2 个最关键 smoke test

请先给方案，再直接实施，并告诉我如何验证。
```

## Day 03：补强内部协议，明确 event / message 的演进规则

- 目标：让 `AppEvent` 和 `CoreMessage` 成为真正稳定的内部协议。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/events.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/messages.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/json.ts`
- 当天动作：
  1. 审视 `sessionId`、`timestamp`、`source` 是否足够
  2. 增加必要的稳定字段，比如事件关联 id、版本注释或 metadata 约束
  3. 补针对协议结构的测试
- 当天产出：一版更适合长期演进的内部协议
- 当天验收：后面接新 Provider 时不需要临时扩字段
- 当天主提示词：

```text
今天要补强 XQoder 的内部协议层。请先阅读 packages/protocol/src/events.ts、messages.ts、json.ts，并从“未来要接更多 provider、tool、sync、审计、回放”的角度判断当前协议缺什么。

要求：
1. 不要为了未来无限扩张，先补最关键字段
2. 保持现有事件命名风格
3. 如果你新增字段，请解释为什么是现在必须加
4. 补相应测试

请输出：
1. 当前协议的短板
2. 最小补强方案
3. 直接实施
4. 验证命令
```

## Day 04：补强 PluginManifest 和扩展契约

- 目标：让插件系统未来可发现、可兼容、可声明能力。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/plugin.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/providers.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/commands.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/schemas.ts`
- 当天动作：
  1. 给 manifest 增加版本、能力、兼容性、权限声明所需字段
  2. 检查命令注册和配置扩展接口是否够用
  3. 补契约测试
- 当天产出：一版够用的插件契约
- 当天验收：以后外部插件至少知道怎么声明自己
- 当天主提示词：

```text
今天要补强 @xqoder/plugin-sdk。请从“外部插件未来要被发现、装载、兼容性校验、声明权限”这个目标出发，阅读 plugin.ts、providers.ts、commands.ts、schemas.ts。

要求：
1. 保持接口简洁
2. 不要引入过重的框架
3. 只补工业化必需字段
4. 补契约测试

请先给我最小可行 manifest 设计，再直接修改代码。
```

## Day 05：抽出命令注册抽象，给 CLI 插件化铺路

- 目标：不再让 `program.ts` 永远承担全部命令装配。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/program.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/commands.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/src/runtime-kernel.ts`
- 当天动作：
  1. 设计命令注册抽象
  2. 把命令定义和命令装配开始分开
  3. 保证现有命令行为不变
- 当天产出：CLI 已具备从注册表装配命令的起点
- 当天验收：`program.ts` 复杂度下降，命令清单不再全靠硬编码
- 当天主提示词：

```text
今天要处理 XQoder CLI 的一个核心问题：packages/cli/src/program.ts 现在是硬编码命令注册，后续插件化会越来越痛。

请先阅读 program.ts、plugin-sdk 里的 commands 契约，以及 core-runtime 里已有的注册能力。

目标：
1. 抽出命令注册抽象
2. 尽量不改命令行为
3. 为后续“内建命令也走注册”铺路

要求：
1. 先最小改动
2. 不要一次做完整插件系统
3. 补 CLI 相关测试或 smoke test
```

## Day 06：盘点并整理内建命令的装配方式

- 目标：把“哪些命令应该内建，哪些命令应该插件化”分清楚。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/program.ts`
- 当天动作：
  1. 盘点所有顶层命令
  2. 分类为核心内建命令、能力命令、可插件化命令
  3. 开始把最适合的一批命令迁移为“可注册”
- 当天产出：一份命令分类清单 + 第一批迁移结果
- 当天验收：命令面开始有“平台命令”和“扩展命令”的区别
- 当天主提示词：

```text
今天请你盘点 XQoder 当前所有 CLI 命令，并按下面三类归档：
1. 平台核心命令
2. 能力命令
3. 未来适合插件化的命令

阅读范围：
packages/cli/src/program.ts
packages/cli/src/commands/*

然后请直接开始做第一批最小迁移，让最适合插件化的一类命令开始走注册，而不是继续都堆在 program.ts 里。
```

## Day 07：第一周整合日

- 目标：不加新功能，只做整理、回归、补测试、补文档。
- 重点文件：本周改过的全部文件
- 当天动作：
  1. 全量跑 `pnpm build`、`pnpm test`、`pnpm lint`
  2. 修本周引入的回归
  3. 更新 docs 或 README
- 当天产出：第一周结束时仓库处于稳定状态
- 当天验收：你可以清楚说出“底层契约已经更稳”
- 当天主提示词：

```text
今天不做新功能。请你以“第一周整合日”的方式检查本周所有改动。

要求：
1. 先列出本周改动可能引入的 5 类风险
2. 再按优先级检查测试缺口和行为回归
3. 对文档不一致的地方直接修
4. 输出一份“本周已完成 / 未完成 / 下周先做什么”的总结
```

## Day 08：设计插件发现和装载入口

- 目标：让插件不只是能定义，还能被找到和加载。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/plugin.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/src/runtime-kernel.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/shared/src/config.ts`
- 当天动作：
  1. 设计内建插件、工作区插件、用户插件的装载入口
  2. 决定从配置还是目录扫描加载
  3. 先实现最小装载入口
- 当天产出：插件加载不再只靠手写调用
- 当天验收：Runtime 至少能装载一个配置驱动的插件清单
- 当天主提示词：

```text
今天要开始做 XQoder 的插件装载入口。目标不是完整的插件市场，而是让插件“可发现、可配置、可加载”。

请阅读 plugin-sdk、core-runtime、shared/config，并设计一个最小插件装载方案。

要求：
1. 优先支持内建插件和项目级插件
2. 先别碰网络安装
3. 结构要能向将来的用户插件扩展
4. 直接把最小链路写出来
```

## Day 09：把内建 runtime plugin 变成正式装配能力

- 目标：不让 `runtime-plugin-loader.ts` 永远只服务 TUI。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/tui/runtime-plugin-loader.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/tui/agent-service.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/src/runtime-kernel.ts`
- 当天动作：
  1. 把内建 plugin 的概念推广成产品级装配能力
  2. 减少 TUI 私有逻辑
  3. 让 CLI 和 TUI 都能复用内建装配
- 当天产出：内建插件不再只是 TUI 特供逻辑
- 当天验收：内建插件链路可被别的入口复用
- 当天主提示词：

```text
今天要把 XQoder 当前 TUI 专用的 runtime plugin loader 提升为更通用的产品装配能力。

请先阅读：
packages/cli/src/tui/runtime-plugin-loader.ts
packages/cli/src/tui/agent-service.ts
packages/core-runtime/src/runtime-kernel.ts

目标：
1. 减少 TUI 私有化装配
2. 为 CLI/TUI 共用 runtime 链路铺路
3. 保持当前行为不坏
```

## Day 10：为 RuntimeKernel 补 introspection 和 snapshot 能力

- 目标：让 runtime 能回答“现在到底装了什么”。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/src/runtime-kernel.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/src/registry.ts`
- 当天动作：
  1. 补更可读的 runtime snapshot
  2. 暴露更清晰的 introspection 接口
  3. 给调试和诊断命令铺路
- 当天产出：运行时状态可被查看和诊断
- 当天验收：你可以很快知道当前注册了哪些 provider/plugin/command
- 当天主提示词：

```text
今天要增强 XQoder 的 RuntimeKernel introspection 能力。请阅读 runtime-kernel.ts 和 registry.ts，并从“未来要做 doctor/debug/diagnostics”这个角度补强 runtime 快照能力。

要求：
1. 输出结构清晰
2. 不要暴露过多内部实现细节
3. 补最小测试
```

## Day 11：让 CLI 主入口从 runtime 装配命令

- 目标：CLI 从“手动拼命令”走向“runtime 装配命令”。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/program.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/src/runtime-kernel.ts`
- 当天动作：
  1. 让 CLI 从 runtime 拉取可注册命令
  2. 保持现有命令帮助和行为基本一致
  3. 补 CLI smoke test
- 当天产出：命令层和 runtime 更紧密
- 当天验收：新增一类命令不一定要直接改 `program.ts`
- 当天主提示词：

```text
今天要继续推进 CLI 插件化。请让 packages/cli/src/program.ts 开始从 runtime 装配命令，而不是只有手写 addCommand。

约束：
1. 不破坏现有帮助输出
2. 不一次性重写整个 CLI
3. 只做最小可工作的装配链路
4. 补 smoke test
```

## Day 12：提取 CLI/TUI 共用的应用服务层

- 目标：别让 CLI 和 TUI 长期各写一套业务逻辑。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/services/`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/tui/agent-service.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/chat.ts`
- 当天动作：
  1. 识别 CLI 和 TUI 的共享业务
  2. 抽成 service 层
  3. 让产品壳更薄
- 当天产出：至少一条主链路完成服务复用
- 当天验收：CLI/TUI 不再重复拼 session / config / agent 逻辑
- 当天主提示词：

```text
今天请从 XQoder CLI 和 TUI 的现有代码中抽出可共用的应用服务层，重点看 chat、session、config、agent 相关逻辑。

要求：
1. 先找重复逻辑
2. 抽成 service，不要直接再造大框架
3. 优先让 chat 主链路复用
4. 不能破坏现有命令行为
```

## Day 13：让插件可以扩展配置

- 目标：未来插件不仅能注册能力，还能扩展配置 schema。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/schemas.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/shared/src/config.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/shared/src/schema.ts`
- 当天动作：
  1. 设计插件配置扩展入口
  2. 把 schema 生成和 config load 对起来
  3. 确保错误信息可读
- 当天产出：插件可声明自己的配置片段
- 当天验收：后续外部插件不必改主配置类型才能落地
- 当天主提示词：

```text
今天要让 XQoder 插件能够扩展配置 schema。请阅读 plugin-sdk 的 schemas 契约，以及 shared/config.ts 和 shared/schema.ts。

目标：
1. 插件可以声明自己的配置项
2. 主配置加载器能识别并合并
3. 错误信息要足够清晰

请直接给出最小实现并补验证。
```

## Day 14：第二周整合日

- 目标：稳定插件装配主链路。
- 重点文件：本周改过的全部文件
- 当天动作：
  1. 回归命令帮助、TUI 启动、基础 chat
  2. 跑全量验证
  3. 修文档不一致
- 当天产出：插件化主链路已具备最小可工作状态
- 当天验收：你可以很明确地区分“产品壳”和“注册能力”
- 当天主提示词：

```text
今天是第二周整合日。请把本周和插件装配相关的改动做一次完整回归检查。

重点：
1. CLI 是否仍可启动和展示帮助
2. TUI 是否仍可工作
3. 基础 chat / session 是否被连带破坏
4. 插件装配链路是否已经可解释、可调试
```

## Day 15：重构 SessionStore 抽象边界

- 目标：让 `core-runtime` 真正面向抽象，而不是被具体会话实现拖住。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/src/session-store.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/session/store.ts`
- 当天动作：
  1. 对齐 `SessionStore` 抽象和实际持久化需要
  2. 把 runtime 需要的最小能力定义清楚
  3. 不在今天做大搬家，只先定义清楚边界
- 当天产出：清晰的 SessionStore 契约
- 当天验收：Core 不需要知道 SQLite 细节
- 当天主提示词：

```text
今天要处理 XQoder 一个关键边界问题：core-runtime 的 SessionStore 很轻，但 agent 里已经有 SQLiteSessionStore，职责分散。

请阅读这两个文件：
packages/core-runtime/src/session-store.ts
packages/agent/src/session/store.ts

目标：
1. 定义 runtime 真正需要的 session 抽象
2. 为后续提取 SQLite adapter 做准备
3. 保持当前功能不坏
```

## Day 16：提取 SQLite 持久化适配层

- 目标：把具体存储实现从“业务包细节”提升为“可替换的持久化层”。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/session/store.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/session/migrations.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/session/sqlite.ts`
- 当天动作：
  1. 提取 SQLite adapter 或 storage 层
  2. 保留现有迁移逻辑
  3. 保证 CLI/TUI 现有 session 行为不回归
- 当天产出：持久化边界更清晰
- 当天验收：未来可以接远程存储或同步存储
- 当天主提示词：

```text
今天要把 XQoder 的 SQLite 会话持久化从“agent 包内部细节”往“可替换存储适配层”方向重构。

请阅读 session/store.ts、migrations.ts、sqlite.ts。

要求：
1. 不破坏现有 SQLite 数据格式
2. 保留迁移逻辑
3. 尽量小步重构
4. 补关键回归测试
```

## Day 17：补审批日志和审计记录

- 目标：让高风险工具的审批不只是 UI 动作，而是可追踪资产。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/providers.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/events.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/`
- 当天动作：
  1. 明确审批请求和审批结果如何落盘或落事件流
  2. 给高风险工具补审计字段
  3. 把 session 视角和审批视角关联起来
- 当天产出：审批动作可回溯
- 当天验收：以后“谁允许了什么工具”可以查
- 当天主提示词：

```text
今天要为 XQoder 增加审批日志和审计记录能力。请从协议层、runtime 层、session 资产层一起考虑。

目标：
1. approval.requested / approval.resolved 不是只在 UI 闪一下
2. 高风险工具调用可以追踪
3. 以后能回答“哪个 session、哪个工具、谁批准了”

请基于现有代码给出最小实现。
```

## Day 18：把 rollback、tool call、approval 关联起来

- 目标：形成完整操作链。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/tools/rollback-store.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/tools/patch-tool.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/events.ts`
- 当天动作：
  1. 给工具调用、回滚点、审批记录建立关联
  2. 统一 id 或 metadata
  3. 补最关键路径测试
- 当天产出：修改文件的全链路可追踪
- 当天验收：可以从一次文件修改追到审批和 rollback
- 当天主提示词：

```text
今天要把 XQoder 的 tool call、rollback point、approval event 串起来，形成一条可追踪链路。

请重点阅读 rollback-store、patch-tool、protocol events。

要求：
1. 优先用稳定 id 或 metadata 关联
2. 不破坏现有 rollback 功能
3. 补最小验证测试
```

## Day 19：给 export / import / share 加版本意识

- 目标：让会话资产未来能演进。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/export.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/import.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/share.ts`
- 当天动作：
  1. 明确导出格式版本
  2. 对不兼容格式给出友好提示
  3. 补导入导出回归测试
- 当天产出：会话资产具备长期演进能力
- 当天验收：以后改 schema 时不至于把旧数据全打爆
- 当天主提示词：

```text
今天要给 XQoder 的 export / import / share 资产增加版本意识。请阅读对应命令实现，并从“后续协议和 session schema 会演进”的角度补强它们。

要求：
1. 导出格式要带版本
2. 导入时要能识别版本不匹配
3. 错误提示要用户可读
4. 补测试
```

## Day 20：清理 session 资产的摘要、压缩和统计链路

- 目标：让 session 不只是存下来，还能稳定被总结、压缩、统计。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/agents.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/tui/agent-service.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/stats.ts`
- 当天动作：
  1. 检查 summary / title / compaction 的配置和行为
  2. 清理 session 元数据
  3. 确保 stats 输出与 session 资产一致
- 当天产出：session 资产链路更稳
- 当天验收：长会话、压缩、统计不会互相打架
- 当天主提示词：

```text
今天要把 XQoder 的 session 资产链路再收紧一遍，重点是 title、summary、compaction、stats 之间的一致性。

请阅读 agents.ts、tui/agent-service.ts、commands/stats.ts，并从“长会话稳定性”角度找问题并修掉。
```

## Day 21：第三周整合日

- 目标：验证 session、rollback、share、stats 这条资产线。
- 重点文件：本周改过的全部文件
- 当天动作：
  1. 手工走一遍 `chat -> tool -> rollback -> session show -> export -> import -> share`
  2. 跑全量验证
  3. 补缺失文档
- 当天产出：资产层可以稳定承载后续扩展
- 当天验收：你能完整回放一次真实使用链路
- 当天主提示词：

```text
今天是第三周整合日。请把 session、approval、rollback、export/import/share、stats 这条链路视作一个整体来检查。

要求：
1. 先列最容易断裂的 5 个点
2. 再逐项给出验证步骤
3. 能修的直接修
4. 最后输出一份资产层稳定性总结
```

## Day 22：把 OpenAI Provider 从 agent 包里拆出来

- 目标：开始形成 `provider-*` 标准结构。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/llm/openai.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/llm/provider.ts`
- 当天动作：
  1. 新建 `provider-openai` 包或等价结构
  2. 保持当前行为和配置方式不变
  3. 从工厂或注册逻辑接回去
- 当天产出：第一个独立 Provider 包
- 当天验收：Provider 拆包后功能不回归
- 当天主提示词：

```text
今天要把 XQoder 的 OpenAI provider 从 agent 包里拆成独立 provider 包，目标是为后续 provider-* 标准化做第一步。

要求：
1. 保持当前配置方式和行为不变
2. 不要连带重构所有 provider
3. 先把 OpenAI 路走通
4. 补回归测试
```

## Day 23：拆出 Anthropic Provider

- 目标：验证拆包不是特例，而是可重复模式。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/llm/anthropic.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/llm/provider-factory.test.ts`
- 当天动作：
  1. 按 OpenAI 的模式拆出 Anthropic
  2. 统一 provider 包对外暴露方式
  3. 补工厂回归测试
- 当天产出：第二个独立 Provider 包
- 当天验收：拆包模式可复制
- 当天主提示词：

```text
今天要验证 provider 拆包是一个可复制模式，而不是 OpenAI 的特例。

请参照昨天拆出的 provider-openai，把 Anthropic 也按同样模式拆出来，并整理出统一的 provider 导出方式和工厂接线方式。
```

## Day 24：清理 provider factory 和 provider capability registry

- 目标：让 provider 选择不再散落在各处。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/llm/provider.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/llm/provider-factory.test.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/shared/src/provider-detect.ts`
- 当天动作：
  1. 整理 provider 工厂
  2. 定义 provider capability registry
  3. 清理 provider 检测逻辑
- 当天产出：统一的 provider 装配入口
- 当天验收：切 provider、列 provider、detect provider 更清晰
- 当天主提示词：

```text
今天要整理 XQoder 的 provider factory 和 provider capability registry。请从“未来有 provider-openai、provider-anthropic、provider-openclaw、provider-claude-team”这个角度看现在的工厂逻辑。

目标：
1. 统一 provider 装配入口
2. 减少 if/else 式分派
3. 让列能力和选择能力更清楚
```

## Day 25：实现 OpenClaw provider 桥接

- 目标：把仓库里已经存在的 OpenClaw 能力正式纳入 provider 体系。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/openclaw.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/providers.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/events.ts`
- 当天动作：
  1. 明确 OpenClaw 属于哪类 Provider
  2. 把其输出归一化成 `AppEvent`
  3. 通过 runtime 注册链路接入
- 当天产出：OpenClaw 不再只是仓库内零散能力
- 当天验收：OpenClaw 已具备平台化接入样板
- 当天主提示词：

```text
今天要把 XQoder 仓库里已有的 OpenClaw 能力正式纳入 provider 体系。

请阅读 packages/agent/src/openclaw.ts，并判断它最适合做 AgentProvider、SyncProvider 还是组合 Provider。

目标：
1. 统一对外接口
2. 把输出映射成 AppEvent
3. 通过 runtime 注册接入
```

## Day 26：给 Claude Team 预留 provider 骨架

- 目标：为未来接团队协作 Agent 提前打接口，不等真正接时再返工。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/providers.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/events.ts`
- 当天动作：
  1. 定义 Claude Team 类系统需要的最小接口
  2. 建一个 skeleton provider 包
  3. 把团队上下文、同步、身份等差异先抽象出来
- 当天产出：一个未来可填充的 provider 骨架
- 当天验收：接团队协作系统时不需要重塑协议
- 当天主提示词：

```text
今天不要求真的接入 Claude Team，但要提前把“团队式 agent 系统”需要的 provider 骨架搭出来。

要求：
1. 先定义最小契约
2. 识别和单用户 LLM provider 不同的地方
3. 用 skeleton 代码表达结构，不要假装已完成真实接入
```

## Day 27：统一 AuthProvider 和凭证解析逻辑

- 目标：把认证从命令行为升级为平台能力。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/providers.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/shared/src/config.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/auth.ts`
- 当天动作：
  1. 梳理 auth login / logout / list
  2. 对齐 `AuthProvider`
  3. 统一从 config、env、login 状态解析凭证
- 当天产出：认证能力更平台化
- 当天验收：Provider 不需要各自发明凭证读取方式
- 当天主提示词：

```text
今天要把 XQoder 的认证能力从 CLI 命令逻辑提升为平台级 AuthProvider 体系。

请阅读 shared/config.ts、commands/auth.ts、plugin-sdk/providers.ts，并整理凭证来源、默认模型、provider 登录状态的统一解析方式。
```

## Day 28：第四周整合日

- 目标：稳定 provider 体系。
- 重点文件：本周改过的全部文件
- 当天动作：
  1. 跑 OpenAI、Anthropic 基础链路
  2. 验证 provider 装配和切换
  3. 检查 OpenClaw / Claude Team skeleton 的边界
- 当天产出：provider 标准化路线跑通
- 当天验收：新增 provider 不再需要改 Core
- 当天主提示词：

```text
今天是第四周整合日。请把 provider 体系作为一个整体回归检查：
1. OpenAI 是否正常
2. Anthropic 是否正常
3. provider factory 是否清晰
4. OpenClaw 桥接是否符合统一协议
5. Claude Team skeleton 是否留好了接口
```

## Day 29：重整 ToolProvider 结构和工具元数据

- 目标：让工具系统未来可插拔、可分级、可审计。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/tools/`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/providers.ts`
- 当天动作：
  1. 给工具补风险级别和能力元数据
  2. 梳理 read-only / write / network / shell 这几类工具
  3. 为未来工具插件化做准备
- 当天产出：工具体系更清晰
- 当天验收：权限系统可以基于工具元数据工作
- 当天主提示词：

```text
今天要重整 XQoder 的工具体系。请先阅读 packages/agent/src/tools 下的主要工具实现，以及 plugin-sdk/providers.ts 中的 ToolProvider 契约。

目标：
1. 给工具补元数据
2. 支持风险分级
3. 为工具插件化铺路
4. 不破坏现有工具调用流程
```

## Day 30：统一 CLI / TUI 的工具审批体验

- 目标：不让审批逻辑分散成多套体验。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/tui/agent-service.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/providers.ts`
- 当天动作：
  1. 统一 tool approval 请求结构
  2. 统一 CLI 和 TUI 的审批决策路径
  3. 确保审批结果能进入审计
- 当天产出：审批链路统一
- 当天验收：CLI/TUI 对高风险工具给出一致语义
- 当天主提示词：

```text
今天要统一 XQoder 在 CLI 和 TUI 里的工具审批体验。

要求：
1. 审批请求结构一致
2. 审批决策结果都进入统一链路
3. 不要让 TUI 维护一套、CLI 再维护一套不同语义
4. 如果适合抽服务层，直接抽
```

## Day 31：让 workflow 全部说 AppEvent

- 目标：工作流不再自己发明一套状态表达。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/workflow/src/engine.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/workflow/src/flows/build-flow.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/workflow/src/flows/fix-flow.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/protocol/src/events.ts`
- 当天动作：
  1. 把 workflow step 生命周期映射到统一事件
  2. 让 CLI/TUI 可以消费统一事件流
  3. 保持现有 build/fix 行为
- 当天产出：workflow 与 runtime 协议对齐
- 当天验收：以后 web/gui 也能复用这些事件
- 当天主提示词：

```text
今天要让 XQoder 的 workflow 层和统一协议层对齐。请阅读 workflow engine、build-flow、fix-flow 和 protocol/events。

目标：
1. workflow 生命周期映射到 AppEvent
2. UI 不再需要单独理解 workflow 内部结构
3. 保持现有 build/fix 能力可用
```

## Day 32：清理 build / fix / run / test / deploy 的 runner 边界

- 目标：把工作流、runner、产品入口之间的职责说清楚。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/runtime/`
  `/Users/wangxinglin/Desktop/Xqoder/packages/workflow/`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/build.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/fix.ts`
- 当天动作：
  1. 确认哪些逻辑属于 runtime，哪些属于 workflow，哪些属于 CLI
  2. 清理混在命令层里的业务逻辑
  3. 给这类命令补更清晰的 service 边界
- 当天产出：执行型命令的分层更稳
- 当天验收：以后 workflow 加强不需要一直改 CLI 命令层
- 当天主提示词：

```text
今天要清理 XQoder 中 build / fix / run / test / deploy 这类执行型命令的边界。

请从 runtime、workflow、CLI 三层分别看职责，把不该待在命令层的逻辑下沉，把不该待在 workflow 的逻辑移回 runtime。
```

## Day 33：提取 CLI / TUI / Electron 共用 runtime service

- 目标：未来多产品壳共用一套主服务。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/`
  `/Users/wangxinglin/Desktop/Xqoder/packages/gui-electron/`
  `/Users/wangxinglin/Desktop/Xqoder/packages/core-runtime/`
- 当天动作：
  1. 找共用入口服务
  2. 把 CLI/TUI/Electron 都可能用到的 runtime 服务抽出来
  3. Electron 先不做重 UI，只做接线
- 当天产出：多产品壳共用主服务的基础
- 当天验收：CLI/TUI/Electron 开始围绕同一 runtime 服务链路
- 当天主提示词：

```text
今天要为 XQoder 多产品壳共用 runtime service 铺路。请阅读 CLI、TUI、Electron 当前代码，并识别三者真正共享的业务服务。

目标：
1. 抽出共用 runtime service
2. 让产品壳更薄
3. 不做大规模 UI 改造，只打通服务边界
```

## Day 34：给 serve / web / attach / acp 留标准接口

- 目标：把未来能力先接到平台，不是继续堆命令文件。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/serve.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/web.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/attach.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/acp.ts`
- 当天动作：
  1. 先抽接口，不急着补完整功能
  2. 对齐 runtime 和 plugin 能力
  3. 给未来 Web / IDE / attach 模式留统一接入点
- 当天产出：扩展入口标准化
- 当天验收：这些命令不再是零散单点
- 当天主提示词：

```text
今天不要求把 serve / web / attach / acp 全做完，而是要把它们纳入统一架构。

请阅读这些命令实现，并把它们整理为可走 runtime / plugin 装配的标准接口。

要求：
1. 接口先行
2. 保持现有命令外观尽量不变
3. 为未来 IDE / Web 壳接入做准备
```

## Day 35：补主链路 E2E 验证

- 目标：至少有一批能挡住主回归的端到端验证。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/*.test.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/*.e2e.test.ts`
- 当天动作：
  1. 选择 3 到 5 条最关键主链路
  2. 补 smoke / e2e 测试
  3. 把最容易回归的链路纳入门禁
- 当天产出：主链路有自动保护
- 当天验收：重构后不至于靠手感回归
- 当天主提示词：

```text
今天要补 XQoder 的主链路 E2E 验证。请从下面几条里选最关键的 3 到 5 条做自动化保护：
1. config -> auth -> models
2. chat -> session
3. tool call -> rollback
4. export -> import -> share
5. tui resume / share

要求：
1. 优先 smoke 和最容易回归的链路
2. 不追求一次做全
3. 能纳入 CI 最好
```

## Day 36：第五周整合日

- 目标：验证“工具 + workflow + 多入口壳”链路。
- 重点文件：本周改过的全部文件
- 当天动作：
  1. 跑 E2E
  2. 走一遍 TUI 和 CLI 主任务
  3. 整理多入口共用服务文档
- 当天产出：产品壳和平台层关系更稳
- 当天验收：你可以说明 CLI/TUI/Electron 各自只负责什么
- 当天主提示词：

```text
今天是第五周整合日。请从“产品壳是否过厚、平台层是否真正可复用”的角度审查本周改动。

请先列问题，再按优先级修。
```

## Day 37：建立 CI 和质量门禁

- 目标：把“人工感觉没问题”升级为“自动门禁”。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/package.json`
  `/Users/wangxinglin/Desktop/Xqoder/.github/`
- 当天动作：
  1. 建立 CI 流水线
  2. 固化 `build / test / lint / release:check`
  3. 让 PR 或每日验证可复用
- 当天产出：最小 CI
- 当天验收：每次重大改动都能自动验证
- 当天主提示词：

```text
今天要给 XQoder 建立最小可用的 CI 门禁。请基于当前 monorepo 和 package.json 脚本，设计一个简单但足够用的流水线。

要求：
1. 至少覆盖 build、test、lint、release:check
2. 不引入过重流程
3. 以后能扩到多平台
```

## Day 38：整理发布、版本同步和打包策略

- 目标：不让发布永远停留在“手工试试看”。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/package.json`
  `/Users/wangxinglin/Desktop/Xqoder/scripts/`
- 当天动作：
  1. 明确版本来源
  2. 整理 `version:sync`、`release:check`
  3. 给发布前 checklist 建立文档
- 当天产出：发布流程清晰
- 当天验收：你可以按步骤复现一次发布检查
- 当天主提示词：

```text
今天要整理 XQoder 的发布和版本同步策略。请阅读根 package.json 和 scripts 目录，目标是形成一个可执行、可重复的发布前检查流程。

要求：
1. 先梳理当前已有脚本
2. 明确哪些环节还缺
3. 能自动化的尽量自动化
```

## Day 39：补配置迁移和数据库迁移操作说明

- 目标：为未来 breaking change 留后路。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/shared/src/config.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/agent/src/session/migrations.ts`
- 当天动作：
  1. 梳理配置演进策略
  2. 梳理 SQLite migration 策略
  3. 给失败恢复写操作说明
- 当天产出：迁移不再靠口头约定
- 当天验收：下一次改配置 schema 或 session schema 时有标准做法
- 当天主提示词：

```text
今天要补 XQoder 的配置迁移和数据库迁移操作规范。请分别从 shared/config.ts 和 agent/session/migrations.ts 出发，整理出未来 schema 演进时应该怎么做、怎么回滚、怎么提示用户。
```

## Day 40：补可观测性和成本统计

- 目标：知道系统在用什么、花了多少、哪儿容易坏。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/shared/src/model-costs.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/shared/src/debug-logger.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/cli/src/commands/stats.ts`
- 当天动作：
  1. 增加 provider 成功率、工具失败率、成本统计所需字段
  2. 整理 stats 输出
  3. 明确 debug 日志和审计日志边界
- 当天产出：有基本观测面
- 当天验收：你可以看出哪个 provider 贵、哪个工具常失败
- 当天主提示词：

```text
今天要补 XQoder 的可观测性和成本统计能力。请从 model-costs、debug-logger、stats 命令出发，设计一套最小但有用的观测面。

要求：
1. 先做最关键指标
2. 不要一上来接大而全监控平台
3. 输出既能给开发者看，也能给产品判断成本
```

## Day 41：补安全边界和插件权限声明

- 目标：平台级项目不能只靠“默认 ask”。
- 重点文件：
  `/Users/wangxinglin/Desktop/Xqoder/packages/permissions/`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/plugin.ts`
  `/Users/wangxinglin/Desktop/Xqoder/packages/plugin-sdk/src/providers.ts`
- 当天动作：
  1. 梳理插件和工具的权限声明
  2. 对高风险能力补更明确的默认策略
  3. 审查项目外路径、shell、network 写操作边界
- 当天产出：安全边界更明确
- 当天验收：你能清楚回答“插件能申请什么权限”
- 当天主提示词：

```text
今天要给 XQoder 补强平台级安全边界，重点是插件权限声明、工具风险分级、项目外路径、shell、网络写操作。

请从 permissions 包和 plugin-sdk 的契约出发，设计一套最小但明确的安全模型，并直接做实现或骨架。
```

## Day 42：发布候选版、文档收口、下一阶段 backlog

- 目标：把这 42 天的结果收成一个可继续推进的版本。
- 重点文件：本轮所有关键改动文件 + `docs/`
- 当天动作：
  1. 跑全量验证
  2. 补 README / docs 链接
  3. 形成发布候选版说明
  4. 生成下一阶段 backlog
- 当天产出：一份可交付的阶段结果
- 当天验收：别人读文档就能接手继续做
- 当天主提示词：

```text
今天是 XQoder 这轮 42 天计划的收官日。请你把整个阶段视作一次 release candidate 收口来处理。

要求：
1. 先总结这 42 天完成了什么
2. 列出还没完成但已经明确边界的工作
3. 检查 docs 和 README 是否一致
4. 给出下一阶段前 10 个 backlog
5. 生成一份可交接摘要
```

---

## 7. 每周结束时你必须回答的 5 个问题

每周结束时，不管代码推进多少，都让 AI 和你一起回答这 5 个问题：

1. 本周最大的结构收益是什么？
2. 本周引入的最大技术债是什么？
3. 哪些地方仍然耦合在 CLI？
4. 哪些能力已经真正进入 runtime / plugin / provider 体系？
5. 下周最该先做的一件事是什么？

---

## 8. 当你完全依赖 AI 写代码时，最容易犯的 6 个错误

1. Prompt 只写“帮我重构一下”，没有文件范围和验收条件。
2. 一天做两个大主题，结果都没做深。
3. AI 改完就相信，没有立即跑验证。
4. 只让 AI 写代码，不让 AI 做 review。
5. 每天没有收尾总结，第二天要重新找上下文。
6. 没把“平台层”和“产品壳层”分开，导致代码越写越像大杂烩。

---

## 9. 最终执行建议

如果你真的打算全程用 AI 工具写这个项目，最关键的不是“提示词多花哨”，而是：

1. 每天只打一个点
2. 每天都有验收
3. 每周做一次整合
4. 所有 prompt 都围绕具体文件和具体目标
5. 每天都产出能被明天继续接上的上下文

照这份手册执行，42 天后你至少会得到三样东西：

1. 一个更像平台而不是单体 CLI 的 XQoder
2. 一套可以复用的 AI 驱动研发方法
3. 一份后面继续接 OpenClaw、Claude Team、Web、IDE 都能沿用的工程骨架



新 TUI 内核要先做的 6 个核心件
1. screen-buffer.ts
- 维护一帧终端屏幕的二维字符网格
- 负责最小 diff 输出，而不是整屏乱刷
2. input-parser.ts
- 统一解析：
  - 键盘
  - Ctrl/Alt/Shift
  - 鼠标滚轮
  - 鼠标拖拽
  - 粘贴
  - IME 最终输入文本
3. viewport-model.ts
- 只管聊天区：
  - 滚动位置
  - 自动跟底
  - 选区
  - 滚动条位置
  - copy 逻辑
4. editor-model.ts
- 只管输入区：
  - 文本
  - 光标
  - 多行
  - 粘贴
  - IME
  - 外部编辑器
  - 附件
5. renderer.ts
- 把 app-state -> screen buffer
- 不直接处理业务逻辑
6. event-loop.ts
- 把：
  - stdin 输入
  - runtime 事件
  - 定时器
  - shell 输出
    统一汇总到状态机
---
迁移顺序
第一步：
- 先做新的 terminal-core 骨架
- 不接业务，只能渲染：
  - 聊天 viewport
  - 输入框
  - 状态栏
  - 右侧栏
    第二步：
- 接 @xqoder/protocol 事件流
- 让 assistant streaming 能刷到新 viewport
  第三步：
- 接 editor-model
- 让输入、粘贴、IME 在新内核里工作
  第四步：
- 接滚动条、复制、拖拽
- 这一步才是真正解决你前面那些交互 bug
  第五步：
- 用新 terminal app 替换旧 Ink TUI 入口
---
一句话确认
你的要求我接受，而且我认同：
- 不再把 Ink 当主渲染核心
- 接下来应该直接建设新的终端内核
- 现有平台化工作继续保留，新 UI 内核挂到它上面
  如果你要，我下一步就不再修旧 tui/，  
  直接开始创建 packages/cli/src/terminal-core/ 第一版骨架。