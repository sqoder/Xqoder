# Phase 17 · Skills + Output Styles

## 任务目标（必须可验证）

- Skills 系统：文件扫描 + trigger 识别 + `SkillTool` 按需激活。
- Output styles：文件扫描 + 对系统 prompt 的注入。

## 对标源

- `openclaude/src/skills/bundledSkills.ts`
- `openclaude/src/skills/loadSkillsDir.ts`
- `openclaude/src/skills/mcpSkillBuilders.ts`
- `openclaude/src/utils/skills/**`
- `openclaude/src/tools/SkillTool/**`
- `openclaude/src/outputStyles/loadOutputStylesDir.ts`
- `openclaude/src/constants/outputStyles.ts`
- `openclaude/src/commands/skills/**`
- `openclaude/src/commands/output-style/**`

### 成功判定

- `~/.xqoder/skills/*.md`（frontmatter: `name / description / triggers / tools`）
  能被扫描。
- 模型看到 skill summary 列表（`Skill` 工具的 schema 描述里嵌入）。
- 模型调用 `Skill` 工具 with `{name: 'xxx'}` → 全文 prompt 被注入、
  对应 `allowedTools` 临时解锁。
- `~/.xqoder/output-styles/*.md` 同样扫描，`/output-style <name>` 切换。
- `xqoder skills ls / info <name> / install <repo>` 命令族可用。
- `xqoder output-style ls / use <name>` 命令族可用。

## 范围与边界

### 允许修改

- 新增 `src/core/skills/`:
  - `load-dir.ts`
  - `registry.ts`
  - `activator.ts`
  - `bundled/` （空目录，留 phase-18 装 plugin 时填）
- 新增 `src/core/output-styles/`:
  - `load-dir.ts`
  - `registry.ts`
  - `inject.ts`
- 扩展 `src/core/agent/tools/interaction-tools.ts::SkillTool`
  变成"查询 + 激活"模式。
- 新增 `src/commands/core/skills.ts / output-style.ts`。

### 禁止修改

- `ToolRegistry` 对外签名。

## 改动要点

### 1) SkillFile schema

```ts
interface SkillFile {
    name: string;
    description: string;
    triggers?: string[]; // 关键词
    tools?: string[]; // 激活后解锁的 tool
    filePath: string;
    body: string; // skill markdown 正文
}
```

### 2) SkillTool 动态描述

- 当用户输入经过 `turn-intake` 时，跑 `detectSkillCandidates(prompt, registry)`
  返回 top-N skills（按 trigger 匹配 + description 相似度）。
- `SkillTool.description` 动态生成：
  ```
  Activate a skill for this turn. Available:
   - brand-voice: Writing in the company tone
   - make-pdf: Generate publication-quality PDF
   - qa: Systematically QA test a web application
   ...
  Call this tool with {name: <skill>} to load the full skill body.
  ```
- 调用后：
  - 把 `body` 作为新的 system message 写入 session。
  - 临时解锁 `tools` 列表（加入白名单）。
  - 记录 `activatedSkills` 到 session metadata（下一轮仍生效）。

### 3) Output style

```ts
interface OutputStyleFile {
    name: string;
    description: string;
    systemPromptAppend?: string; // 追加到 system prompt 末端（动态层）
    responseFormat?: 'markdown' | 'plain' | 'verbose';
}
```

当 `/output-style use concise` 被触发：
- 记录到 session metadata。
- `prompt-composer` 下一轮在 "动态尾巴" 部分 append `systemPromptAppend`（不破坏
  prompt cache 前缀）。

### 4) Bundled skills

从 OpenClaude 的 `skills/bundled/*.md` 选取有通用价值的 5–10 个（gstack /
make-pdf / qa 等）作为 XQoder 初始 bundle；**不要直接拷贝** OpenClaude 的 body
文字，用 summary + 引用链接的方式写。

## 验证

- Unit：trigger 匹配 / activate 后 tool 白名单扩展 / deactivate 行为。
- e2e：`/output-style use concise` → 下一轮 prompt 里观察到附加 system。

## 风险与回退

- **风险**：skill body 过大导致 prompt 爆。
  **缓解**：单 skill ≤ 8KB；超过则 `read_file` 按需读，而不是一次注入。

## 不确定项

- OpenClaude 的 `mcpSkillBuilders.ts` 把 MCP server 自动转成 skill 列表。
  本期复刻为 `detectSkillCandidates` 的一个 source，不单独做 builder。
