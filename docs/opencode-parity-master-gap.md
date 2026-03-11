# OpenCode Parity 主差距与路线

本文档与 README 中的「先对齐 OpenCode」目标对应，用于跟踪 CLI/TUI/Session/Auth/Config/Agents 及后续能力的对齐状态与缺口。

## 目标顺序（与 README 一致）

1. **第一阶段**：对齐 `CLI / TUI / Session / Auth / Config / Agents`
2. **第二阶段**：对齐 `stats / export / import / share / undo / redo`
3. **第三阶段**：补 `serve / web / attach / ACP / IDE`
4. **第四阶段**：parity 完成后，把 XQoder 自己的 workflow 能力加回默认体验

## 当前状态摘要

| 能力面           | 状态     | 说明 |
|------------------|----------|------|
| CLI 命令面       | 已具备   | chat, config, auth, models, agent, session, stats, export/import/share, rollbacks, build/fix/run/test/deploy, lsp, mcp, serve/web/attach/acp, github, plugins 等 |
| TUI              | 已具备   | 默认使用 terminal-core 新内核；可选 `--legacy-ink` 回退旧 Ink |
| Session 持久化   | 已具备   | SQLite + 摘要/恢复/导出/导入/分享 |
| Auth / Config    | 已具备   | auth login/list，config init/show/doctor，分层配置加载 |
| Agents           | 已具备   | agent list，多 agent 配置，内建 xqoder-agent 通过 plugin 注册 |
| stats/export/import/share | 已具备 | 见 CLI 命令面 |
| undo/redo        | 部分     | rollbacks 提供回滚点；编辑层 undo 视具体 TUI/编辑器而定 |
| serve / web / attach / ACP | 命令存在 | 实现深度与 OpenCode 的逐项对齐可在此文档或 backlog 中细化 |
| IDE 集成         | 待补     | attach / ACP 等为预留入口 |

## 相关文档

- **实施与优先级**：[project-status-and-backlog.md](./project-status-and-backlog.md) — 当前状态、P0/P1/P2 下一步、验收标准
- **工业级规范**：[xqoder-industrial-playbook.md](./xqoder-industrial-playbook.md) — 架构、Provider/插件/协议/发布规范
- **42 天日程**：[xqoder-ai-daily-implementation-manual.md](./xqoder-ai-daily-implementation-manual.md) — 每日可执行计划与提示词

## TUI 布局（仿 Claude Code，无右侧边栏）

- 当前为**无右侧边栏**布局：主区全宽（标题 + 对话区 + 内层滚动条 + 底部输入框 + 状态栏），与 Claude Code 一致。若需恢复侧栏，将 `renderer.ts` 中 `SIDEBAR_WIDTH` 改为非 0 并恢复 `computeLayout` 中对应计算即可。

## TUI 双滚动条设计（对齐 OpenCode，有侧栏时）

- **内层滚动条**：对话区（transcript）容器内滚动，单列细轨道（`│`/`█`），仅滚动对话历史；输入框固定在底部。快捷键：Home/End 跳到顶/底，PageUp/PageDown 整页，Shift+Up/Down 数行，鼠标滚轮同 Shift 步进。
- **外层**：保留终端原生 scrollback/滚动条，由终端 emulator 绘制，不占用字符网格。整屏输出仍可被终端滚动查看。
- **好处**：输入始终可见、符合聊天习惯；内层负责「会话内定位」、外层负责「终端历史」；与 OpenCode 的 container scroll + fixed input 一致。

## TUI 稳定性与复制（对齐 OpenCode 无乱飞、可复制）

- **对话内容不乱飞**：每帧先清屏再按行顺序输出整屏（home + clear + buffer.toLines() 逐行写），不用大量光标定位，终端滚动条滑动后也不会出现内容错位、乱码。
- **复制对话**：不占用鼠标（未开 SGR 鼠标上报），由终端原生选区完成：用鼠标拖选对话内容，再用 Cmd+C / Ctrl+Shift+C 复制，与 OpenCode 的「鼠标选区 + 快捷键复制」一致。对话区滚动请用键盘：Home/End、PageUp/PageDown、Shift+Up/Down。

## 差距与下一步

- 细化「serve / web / attach / ACP / IDE」与 OpenCode 的逐项差距（可在此文档或 backlog 中维护）。
- 将新增能力按「产品壳 vs 平台能力」归类，并更新 [project-status-and-backlog.md](./project-status-and-backlog.md) 的验收清单。
