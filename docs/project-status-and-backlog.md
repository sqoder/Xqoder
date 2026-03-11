# XQoder 项目状态与执行清单

本文档基于 `docs/1.md`、`docs/xqoder-ai-daily-implementation-manual.md`、`docs/xqoder-industrial-playbook.md` 整理，用于对齐当前实现与目标，并给出可执行的下一步。

---

## 1. 文档结论摘要

| 文档 | 核心结论 |
|-----|----------|
| **1.md** | 主工作区 TUI 不再用 Ink，改用自定义 ANSI/raw-stdin 终端内核；Commander+Clack 外层，node-pty 跑 shell；新内核 6 件：screen-buffer、input-parser、viewport-model、editor-model、renderer、event-loop。 |
| **实施手册** | 42 天拆成可执行日程，Day 01 基线→Day 42 收口；每日固定时间表 + 4 个通用提示词；末尾与新 TUI 内核迁移顺序一致。 |
| **工业级手册** | 以 protocol + plugin-sdk + core-runtime 为底盘，CLI/TUI/GUI 收敛到统一运行时；P0 先补平台骨架，P1 制度与文档，P2 生态扩展。 |

---

## 2. 当前项目状态（已对齐部分）

### 2.1 新 TUI 内核（docs/1.md）

- **terminal-core** 已实现且与文档一致：
  - `screen-buffer.ts`、`input-parser.ts`、`viewport-model.ts`、`editor-model.ts`、`renderer.ts`、`event-loop.ts`
  - 另有 `runtime-bridge.ts`（协议事件→终端状态）、`app-state.ts`、`ansi-writer.ts`
- **terminal-app**：`run-terminal-app.ts` 使用 terminal-core + `TuiAgentService`，已接协议事件、审批、session 恢复、附件。
- **默认入口**：`commands/tui.tsx` 中默认走 `runTerminalApp`（新内核）；仅当 `--legacy-ink` 或 `XQODER_LEGACY_INK=1` 时使用旧 Ink TUI。
- **结论**：新 TUI 内核已落地并作为默认，旧 Ink 保留作回退。

### 2.2 平台分层（工业级手册）

- **protocol**：`AppEvent`、`CoreMessage`、事件类型齐全。
- **plugin-sdk**：Provider/Plugin/Command 契约存在。
- **core-runtime**：`RuntimeKernel`、EventBus、Registry、SessionStore 抽象、snapshot。
- **cli**：已通过 `command-plugins.ts` 做命令注册与发现（`discoverCommandRegistrations`），`program.ts` 从注册表装配命令。
- **结论**：平台雏形在，与手册描述一致。

### 2.3 构建与测试

- `pnpm build`、`pnpm test` 已通过（截至撰写时）。
- 底层三包 **protocol / plugin-sdk / core-runtime** 此前为占位测试（`node -e "process.exit(0)"`），无真实用例；已在本轮补最小测试骨架（vitest + smoke 用例）。若刚加入 vitest 依赖，需先执行 `pnpm install --no-frozen-lockfile`，再 `pnpm test`。

---

## 3. 与文档的差异与注意点

1. **仓库路径**：实施手册与工业级手册中部分路径为 `Desktop/code/Xqoder`，实际工作区为 `Desktop/Xqoder`。已在 `docs/` 内做路径统一修正（或可继续用「项目根」相对描述）。
2. **README**：README 提到 `docs/opencode-parity-master-gap.md`，若该文件不存在，需后续补或改为现有文档链接。
3. **42 天日程**：可按「当前做到哪一天」在本文档或实施手册中标注，便于接力（例如 Day 01 基线、Day 02 测试骨架等）。

---

## 4. 建议下一步（按优先级）

### P0（平台骨架，与工业级手册一致）

| 序号 | 事项 | 说明 | 状态 |
|-----|------|------|------|
| 1 | 内建能力整理为「官方插件」 | 把 TUI/CLI 共用的内建能力从散落实现收口为可注册的 plugin，减少产品壳内硬编码。 | 已收口：command-plugins 四个内建 plugin + TUI 的 xqoder-builtins |
| 2 | SessionStore 边界统一 | 明确 core-runtime 只依赖 SessionStore 抽象；SQLite/持久化实现在 agent 或 storage-*，不把 Core 绑死在具体存储。 | 已做：契约注释 + core-runtime 契约测试 + storage-sqlite 适配器契约测试 |
| 3 | 插件发现与装载 | 实现「内建 + 工作区 + 用户」插件的发现与装载入口，至少支持配置驱动的插件列表。 | 已做：配置 paths + 工作区 .xqoder/plugins.json 与 .xqoder/plugins/*.js |

### P1（制度与文档）

| 序号 | 事项 | 说明 | 状态 |
|-----|------|------|------|
| 4 | 补齐/修正文档链接 | 若存在 `opencode-parity-master-gap.md` 则链接；否则用现有 gap 描述或新建最小文档。 | 已补：新建 `docs/opencode-parity-master-gap.md` 并链回本清单与工业级手册 |
| 5 | CI 门禁 | 固化 `build / test / lint / release:check`，PR 或每日验证可复用。 | 已做：CI 使用 `pnpm release:check` 作为门禁 |
| 6 | 协议与契约测试 | 在 protocol / plugin-sdk / core-runtime 上持续补契约测试与回归用例。 | 进行中：已补 smoke/契约测试，可继续加用例 |

### P2（生态与体验）

| 序号 | 事项 | 说明 | 状态 |
|-----|------|------|------|
| 7 | Provider 拆包 | 形成 provider-openai、provider-anthropic 等标准包，Core 不直接依赖具体 SDK。 | 已做：新增 @xqoder/llm-api、@xqoder/provider-openai、@xqoder/provider-anthropic；agent 改为依赖上述包并移除对 openai/@anthropic-ai/sdk 的直接依赖。 |
| 8 | TUI 体验收尾 | 滚动条、复制、选区、拖拽等在新 terminal-core 上收口，再考虑逐步收缩或移除旧 Ink 代码。 | 进行中：terminal-core 已有滚动条渲染、滚轮滚动、viewport 选区模型与 buildViewportSelectedText；后续可接鼠标拖拽选区和 Ctrl+C 写入剪贴板。 |

---

## 5. P2 完成说明（Provider 拆包）

- **@xqoder/llm-api**：仅含 ILLMProvider、CompletionRequest、CompletionResponse、BaseLLMProvider，依赖 @xqoder/shared。
- **@xqoder/provider-openai**：依赖 llm-api、shared、openai，实现并导出 OpenAIProvider。
- **@xqoder/provider-anthropic**：依赖 llm-api、shared、@anthropic-ai/sdk，实现并导出 AnthropicProvider。
- **@xqoder/agent**：依赖 llm-api、provider-openai、provider-anthropic；createLLMProvider 及 dashscope/groq/azure 等均从上述包引用；已移除对 openai、@anthropic-ai/sdk 的直接依赖。

本地需执行一次：`pnpm install --no-frozen-lockfile`，再执行 `pnpm build` 与 `pnpm test`。

---

## 6. 今日/本周可执行动作示例

- **今日**：跑一遍 `pnpm build && pnpm test`，确认底层三包新测试通过；把「当前对应 42 天哪一天」记一笔。
- **本周**：从 P0 中选一项（例如 SessionStore 边界或插件装载入口）做最小可实现版本，并更新本文档的「当前状态」一节。

---

## 7. 验收标准（工业级手册）

达到以下即可视为进入工业级阶段：

1. 可独立新增 Provider 包并接入，不改 Core。
2. 可独立新增 Plugin 包并接入，不改 CLI 主流程。
3. CLI、TUI、GUI 使用同一套 Runtime 事件流。
4. 工具写操作有审批、回滚与审计。
5. Session 可恢复、导出、导入、分享、压缩。
6. 配置加载优先级明确且可诊断。
7. 发布前有自动化门禁。
8. 线上问题可通过日志与 Session 资产回放定位。

---

*文档生成后可根据每次迭代更新「当前项目状态」和「建议下一步」完成情况。*
