# 合规与授权规范（必读 · 长期生效）

> 本文档落实 XQoder 复刻 OpenClaude / Claude Code 过程中的合规边界。
> 所有 phase-0X 施工单均受本文件约束；如出现冲突，以本文件为准。

## 上下文

- 本仓参考 OpenClaude（`/Users/wangxinglin/Desktop/Xqoder/openclaude/` 本地目录）来
  理解 Claude Code 的行为。
- OpenClaude `LICENSE` 自己声明：代码衍生自 Anthropic PBC 的专有 Claude Code，
  **未获得 Anthropic 授权分发**。
- 因此 XQoder 采用 **clean-room reimplementation（净室重写）** 路线：
  **只借鉴行为，不复制代码字符**。

## 硬规则（7 条）

### 规则 A · 只读参考 · 绝不复制

读 OpenClaude 源码来 **理解** 行为、接口、数据流；代码实现 **一律重新编写**。
禁止整段 copy-paste（包括被折叠的单函数、工具描述、prompt 文本、错误消息）。

### 规则 B · `openclaude/` 目录必须被 gitignore

- `/.gitignore` 已加入 `openclaude/`（已落盘）。
- 任何 PR 中如果 `git diff` 出现 `openclaude/` 路径 → **拒绝合并**。
- 本地可以保留它做参考；它不得进入 git 历史或 release 产物。

### 规则 C · 文件头标注 clean-room 来源

所有 **对标 OpenClaude 原有文件** 的 XQoder 新文件，首行注释必须声明：

```ts
// Clean-room reimplementation of retry policy inspired by
// Claude Code / OpenClaude's services/api/withRetry.ts behavior.
// No original source code copied.
```

放在 `.ts / .tsx / .test.ts` 开头。允许翻译为中文但含义等价。

### 规则 D · Prompt / 文案 / 错误消息一律自写

禁止复制 OpenClaude / Claude Code 中：
- built-in agent 的 system prompt 原文；
- 工具 description 中的长段文本；
- 错误消息 / UI 提示 / slash 命令说明；
- skill / output-style 的 markdown 正文。

保留相同 **行为**，文字 **自己重新构思并撰写**。施工时我（Kiro）默认按此
原则产出——但对你来说是硬约束：任何 review 中发现文案接近 OpenClaude 原文的
≥ 30 字连续字符 → 必须改写。

### 规则 E · LICENSE 与 NOTICE

- `/LICENSE` 改为 **MIT 或 Apache-2.0**（你选一个并写死；不要 "see LICENSE"
  这种模糊表达）。
- 首页 `README.md` 顶部加一段：
  > XQoder is an original terminal-native AI coding assistant by the XQoder
  > authors. It is a clean-room implementation of behaviors documented in
  > OpenClaude and Claude Code, with no source code copied from those
  > projects. XQoder is not affiliated with or endorsed by Anthropic PBC.
- 如果最终代码中出现了第三方 npm 依赖（ink / react / openai SDK 等），
  保留它们自身的 license 在 `NOTICE.md`。

### 规则 F · 商标与命名

- 产品名：**XQoder**（不变）。
- 禁止在品牌 / 文档 / CLI 输出中使用：
  `Claude`, `Claude Code`, `Anthropic`, `OpenClaude`（作为产品名 / slogan）。
- 允许的表述：
  - "OpenAI-compatible terminal coding agent"
  - "terminal-native AI coding assistant with multi-provider support"
  - "inspired by the Claude Code workflow"（在讨论设计来源时，不做品牌）
- CLI 帮助文本、banner、错误消息 **不得出现** Claude / Anthropic 字样。

### 规则 G · Provider API 使用

- 你 **可以** 通过 API key / OAuth 正常调用 Anthropic / OpenAI / 各国产厂商的
  API——这是各厂商服务条款允许的消费者使用方式。
- **不可** 将 XQoder 包装为伪装 Claude Code 的代理服务对外收费（这会踩 Anthropic
  的 ToS）。
- **不可** 在不获得 Anthropic 授权的情况下提供"Anthropic backed"之类的误导表述。

## Review Checklist（每个 PR 都要过）

- [ ] 没有复制粘贴自 `openclaude/` 的代码。
- [ ] 新文件有 clean-room 头部注释。
- [ ] prompt / 文案 / 错误消息是原创或翻译后改写。
- [ ] 不包含 `Claude / Anthropic / OpenClaude` 作为 XQoder 自身品牌。
- [ ] `git diff` 中没有 `openclaude/` 路径。
- [ ] 引入的第三方包均在 `NOTICE.md` 中列名与 license。

## 工作流

1. 读 OpenClaude 源文件 = **仅做行为分析**，可做笔记。
2. 实现 XQoder 对应文件 = **按施工单描述、用自己的话/代码重写**。
3. 施工单中引用 OpenClaude 源路径 = **仅作行为参考**，不作文本移植。
4. 每期 PR 带 review checklist 勾选项。

## 违反规则的后果与处置

- **发现直接拷贝代码** → 立刻回滚该段实现，用 clean-room 方式重写。
- **PR review 被拒** → 按 Checklist 逐项修改后重新提交。
- **已合并代码发现违规** → `git revert` 对应 commit + 重写，不允许"小修补救"。

## FAQ

**Q: 我参考 OpenClaude 的数据结构设计（字段名、类型）算不算抄？**
A: 不算。数据结构 / API shape / 协议 schema 本身不受版权保护。你可以保留
 `ToolCall { id, name, arguments }` 这样的字段设计；但你**不能**复制
 OpenClaude 对该结构的实现代码。

**Q: OpenClaude 的错误消息"Duplicate tool call batch detected"我能用吗？**
A: 超过 30 字连续字符就改写。可以改成
 `"Repeated tool invocation with identical arguments"` 之类等效表达。

**Q: 我需要跑 OpenClaude 的测试 fixture 吗？**
A: 不要直接拷 `openclaude/tests/*.json`。你自己写 fixture（内容自定义），
 覆盖同样的行为场景即可。

**Q: Ink / React / OpenAI SDK 的代码我能直接用吗？**
A: 它们是第三方 npm 依赖，遵守其自身 license（MIT / Apache-2.0）即可。
 在 `NOTICE.md` 列名、不修改它们的版权声明就合规。

**Q: 我的文档 phase-0X 里有时会出现 `openclaude/src/...` 路径——这不是证据？**
A: 不是。施工单只是说 **"去这个文件看它怎么做的，然后自己写一个"**，
 属于行为分析，不是代码移植。审计文件时只看 `src/` 下的 XQoder 实现
 有没有违规字符，不看施工文档。

---

**最后**：本规则以"保守且可执行"为前提。如有拿不准的具体情况，
走保守路线——重写一版永远比"可能被告"安全。
