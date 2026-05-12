# Phase 04 · 权限模式五档 + acceptEdits + yolo 分类器

## 任务目标（必须可验证）

补齐 OpenClaude 文档 §09 的 5 档 permission mode：
`default / plan / acceptEdits / auto / bypass`。其中
- `plan / auto / bypassPermissions` 已在类型里（见 `AgentPermissionMode`），
  但缺 `acceptEdits`；
- `auto` 档要接入 yolo 分类器（仅对 Shell 命令做"安全评分"）。

### 成功判定

- `AgentPermissionMode` 新增字面量 `'acceptEdits'`，全仓枚举数组（≥ 5 处
  `['allow','ask','deny','auto','plan','default','bypassPermissions']`）同步补齐。
- 在 `acceptEdits` 下：`edit / write / patch` 类工具直接放行，shell / fetch / webSearch 仍按原策略。
- 在 `auto` 下：`shell` 调用走 `classifyShellSafety(command)`：
  - safe（例如 `ls`, `cat`, `pwd`, `git status`, `npm run build --dry-run`）→ `allow`。
  - risky（`rm -rf` / `curl ... | sh` / `git push --force` / 任何写出磁盘到项目外）→ `ask`。
  - dangerous（`sudo ...` / `shutdown` / `mkfs` / `/dev/` 重定向）→ `deny`。
- 新增 `bun test src/domain/permissions/__tests__/yolo-classifier.test.ts`
  覆盖 ≥ 18 条样本命令，全绿。

---

## 背景与上下文

- **类型源**：`src/shared/types/permissions.ts`（首要）和
  `src/infra/shared/types.ts`（重复一份，需要同步）。
- **模式落地处**：`src/domain/permissions/permission-gate.ts`
  （`resolvePermissionSettingsByPolicy` / `workspace_auto` 分支）。
- **策略落地处**：`src/domain/permissions/tool-policy.ts::resolveToolPermissionMode`。
- **已有的"能力分级"**：`ExecutionCapability = 'read_only' | 'plan' | 'workspace_write'`
  对应 `plan / read_only` 模式已实现。

---

## 问题/需求定义

### 当前现象

- 用户想"编辑自动放行、shell 仍审批"做不到，只能在 workspace_auto 下全部放开。
- Shell 命令在 `auto` 下一律走 `allow`，危险命令（`rm -rf /`）也不拦。

### 触发条件

- 长任务要求大量编辑，但敏感 shell 仍希望人审。
- Demo 场景需要 "yolo" 自动放行。

### 预期行为

- `acceptEdits`：编辑类工具 allow，非编辑类保持 default 策略。
- `auto`：shell 经分类器分档。

---

## 范围与边界

### 允许修改

- `src/shared/types/permissions.ts`
- `src/infra/shared/types.ts`
- `src/domain/permissions/tool-policy.ts`
- `src/domain/permissions/permission-gate.ts`
- 新增 `src/domain/permissions/yolo-classifier.ts`
- 新增 `src/domain/permissions/__tests__/yolo-classifier.test.ts`
- `src/application/system/permissions.ts`（CLI / 配置校验）
- `src/core/agent/markdown-agents.ts`（`.claude/agents` frontmatter 校验）
- `src/infrastructure/agent/tui-agent-runtime-support.ts`（UI 映射）
- `src/infra/shared/config-normalizers-common.ts`（配置归一）

### 禁止修改

- `ApprovalPolicy` 枚举（保持 5 个不变）。
- `permissionMode` 到 `ExecutionCapability` 的映射。
- 现有 `workspace_auto` 策略行为（只增档位，不改现档位语义）。

### 限制

- 不允许用 `any` 绕过类型；分类器返回必须是 3 值 enum。
- 分类器 **只对 shell/command** 起作用；不扩展到其他工具。
- 分类器是 **纯字符串匹配**，不启外部进程、不 net I/O。

---

## 执行步骤

### 一、行为建模

| 模式 | 对 edit/write/patch | 对 shell/command | 对 read/grep/glob | 说明 |
|---|---|---|---|---|
| `default` | ask | ask | allow | 当前行为 |
| `plan` | deny | deny | allow | 当前行为 |
| `acceptEdits` | **allow** | ask | allow | 新增 |
| `auto` | allow | **classifier → allow/ask/deny** | allow | 分类器接入 |
| `bypassPermissions` | allow | allow | allow | 当前行为 |

### 二、任务拆解

| 模块 | 职责 |
|---|---|
| `types (2 处)` | 加字面量 `'acceptEdits'` |
| `yolo-classifier.ts` | `classifyShellSafety(cmd): 'safe'\|'risky'\|'dangerous'` |
| `tool-policy.ts` | 把 `'acceptEdits'` 分支落地；`'auto'` 下对 shell 调分类器 |
| `permission-gate.ts` | 如有新策略（本期不加策略，只加 mode）则不改 |
| `markdown-agents / system/permissions / config-normalizers-common` | 同步允许值数组 |
| `tui-agent-runtime-support` | `acceptEdits → 'allow'` 的兼容降级映射 |

---

## 三、逐模块施工单

### 模块 1 · 类型同步

1. **涉及**：
   - `src/shared/types/permissions.ts`
   - `src/infra/shared/types.ts`
2. **改动方案**：

```ts
export type AgentPermissionMode =
    | 'allow' | 'ask' | 'deny'
    | 'auto' | 'plan' | 'default' | 'bypassPermissions'
    | 'acceptEdits'; // 新增
```

3. **同步点（会编译失败，必须一并改）**：
   - `src/application/system/permissions.ts::VALID_PERMISSION_MODES`
   - `src/core/agent/markdown-agents.ts::SUPPORTED_PERMISSION_MODES`
   - `src/infra/shared/config-normalizers-common.ts` 同数组
   - `src/domain/permissions/tool-policy.ts::EFFECTIVE_MODES`（若存在）
4. **不允许**：改字面量顺序（外部配置兼容性）。
5. **验收**：`bun x tsc --noEmit` 全仓过。

---

### 模块 2 · `yolo-classifier.ts`

1. **职责**：把 shell 命令字符串分三档。
2. **涉及文件**：`src/domain/permissions/yolo-classifier.ts`。
3. **改动方案**：

```ts
export type ShellSafety = 'safe' | 'risky' | 'dangerous';

const DANGEROUS_RE = [
    /\bsudo\b/,
    /\brm\s+-rf\s+\//,
    /\bmkfs\b/, /\bshutdown\b/, /\breboot\b/, /\bhalt\b/,
    />\s*\/dev\/(sd|nvme|disk)/,
    /:\(\)\s*{\s*:\|:&\s*};:/,           // fork bomb
    /\bdd\s+.*of=\/dev\//,
];

const RISKY_RE = [
    /\brm\s+-rf?\b/,
    /\bchmod\s+-R\b/, /\bchown\s+-R\b/,
    /\bcurl\b.*\|\s*sh\b/,
    /\bwget\b.*\|\s*(ba)?sh\b/,
    /\bgit\s+push\s+--force\b/, /\bgit\s+reset\s+--hard\b/,
    /\bnpm\s+publish\b/, /\bbun\s+publish\b/,
    /\bdocker\s+system\s+prune\b/,
    /\bssh\b/, /\bscp\b/,
];

const SAFE_PREFIXES = [
    'ls', 'cat', 'head', 'tail', 'pwd', 'wc', 'stat', 'file',
    'grep', 'rg', 'find -name', 'echo', 'printf',
    'git status', 'git diff', 'git log', 'git show',
    'bun run build', 'bun run lint', 'bun test', 'bun x tsc',
    'npm run build', 'npm test', 'yarn test',
];

export function classifyShellSafety(command: string): ShellSafety {
    const cmd = command.trim();
    if (DANGEROUS_RE.some((re) => re.test(cmd))) return 'dangerous';
    if (RISKY_RE.some((re) => re.test(cmd))) return 'risky';
    if (SAFE_PREFIXES.some((p) => cmd.startsWith(p))) return 'safe';
    // 默认保守：未知命令走 risky（= ask）
    return 'risky';
}
```

4. **注意**：
   - 默认未知 → `risky`（ask），不走 `safe`。这是安全保守默认。
   - 每条正则用 `\b` 边界，避免误伤 `rm-rf-the-world.ts` 这种文件名。
5. **不允许**：调 `execSync('which ...')` 之类的运行时检查。
6. **预期行为**：`classifyShellSafety('ls -la')==='safe'`；
   `classifyShellSafety('rm -rf /')==='dangerous'`。
7. **验收**：18+ 样本测试。
8. **回退**：删文件。

---

### 模块 3 · `tool-policy.ts::resolveToolPermissionMode` 扩展

1. **涉及**：`src/domain/permissions/tool-policy.ts`。
2. **现状**：
   - `bypassPermissions` 分支已存在（仍然会折回 `allow/ask`）。
   - `auto` 分支对所有工具直接走 `allow`。
3. **改动方案**：在已有 switch/if 链中插入两段：

```ts
// (a) acceptEdits
if (mode === 'acceptEdits') {
    if (isEditLikeTool(toolName)) return 'allow';
    // 非编辑类工具回退到 default 策略
    mode = resolveDefaultMode(permissions, toolName);
}

// (b) auto 下对 shell
if (mode === 'auto' && isShellLikeTool(toolName)) {
    const command = extractShellCommand(input);
    const safety = classifyShellSafety(command);
    if (safety === 'dangerous') return 'deny';
    if (safety === 'risky') return 'ask';
    return 'allow';
}
```

4. **注意**：
   - `isEditLikeTool(name)`: `name === 'write_file' || 'edit_file' || 'apply_patch'`
     （以现有工具名为准，施工前 grep 确认）。
   - `isShellLikeTool(name)`: `name === 'run_command' || 'run_shell' || 'install_package'`。
   - `extractShellCommand(input)`：从 tool input 里读
     `command / cmd / shell / args` 字段；读不到则返回空字符串 →
     `classifyShellSafety('')` 返回 `'risky'`（安全默认）。
5. **不允许**：把 `bypassPermissions` 改成 skip 分类器——保持一致：
   bypass 时所有工具均 allow。
6. **验收**：
   - 在 `auto` 模式下 `tool_use: run_shell { command: 'ls' }` → permission=allow。
   - 在 `auto` 模式下 `run_shell { command: 'rm -rf /' }` → permission=deny。
   - 在 `acceptEdits` 下 `edit_file(...)` → allow，`run_shell(ls)` → ask。
7. **回退**：把 `acceptEdits` / 分类器分支用 feature 开关包。
   `if (process.env.XQODER_PERMISSION_V2 === '0') { 旧分支 }`。

---

### 模块 4 · 配置层校验同步

- `src/application/system/permissions.ts::VALID_PERMISSION_MODES`
  加 `'acceptEdits'`，并在 CLI 帮助里更新描述。
- `src/infra/shared/config-normalizers-common.ts` 同步。
- `src/core/agent/markdown-agents.ts::SUPPORTED_PERMISSION_MODES` 同步。

---

### 模块 5 · UI 降级映射

- `src/infrastructure/agent/tui-agent-runtime-support.ts` 里
  `if (mode === 'bypassPermissions') return 'allow'` 类似的降级，
  追加：
  ```ts
  if (mode === 'acceptEdits') return 'allow';
  ```
  以保证旧 UI（仅识别 allow/ask/deny）还能工作。

---

## 四、逐文件修改建议

| 文件 | 动作 |
|---|---|
| `src/shared/types/permissions.ts` | 枚举加一值 |
| `src/infra/shared/types.ts` | 同上 |
| `src/application/system/permissions.ts` | `VALID_PERMISSION_MODES` 同步 |
| `src/core/agent/markdown-agents.ts` | 同上 |
| `src/infra/shared/config-normalizers-common.ts` | 同上 |
| `src/domain/permissions/yolo-classifier.ts` | 新建 |
| `src/domain/permissions/tool-policy.ts` | 插入 acceptEdits / auto-shell 两段分支 |
| `src/infrastructure/agent/tui-agent-runtime-support.ts` | 降级映射 |
| `src/domain/permissions/__tests__/yolo-classifier.test.ts` | 新建，≥ 18 样本 |

---

## 五、数据结构与流程

```
tool_call(name, input)
  → resolveToolPermissionMode(name, input, permissions)
      ├── mode === 'acceptEdits' && isEdit(name) → allow
      ├── mode === 'auto' && isShell(name)
      │     └── classifyShellSafety(cmd) → safe/risky/dangerous
      │                                    → allow / ask / deny
      └── 其他 → 现有分支
```

---

## 六、关键代码

见模块 2 / 3 内嵌代码块。

---

## 七、验证方案

### 手动测试

- `XQODER_PERMISSION_MODE=acceptEdits bun dist/index.js chat "把 README 的第一段改写成英文" --dir .`
  编辑工具无提示直接生效；若任务中调了 shell（比如 git add），UI 弹审批。
- `XQODER_PERMISSION_MODE=auto bun dist/index.js chat "看下项目结构" --dir .`
  `ls / cat` 之类 safe 命令直接跑；`rm -rf .git` 被拒绝。

### 边界测试

- 空 command string → risky。
- 组合命令 `ls && sudo rm -rf /` → dangerous（因子句命中 `\bsudo\b`）。
- `git push --force-with-lease` → risky（正则 `--force` 匹配）。
  **待验证**：该行为是否希望。可调整正则为 `--force(\s|$)`。
- `ls -la /etc/passwd` → safe（前缀匹配）；如需收紧，扩 regex。

### 失败判定

- `AgentPermissionMode` 加了 `acceptEdits` 后任一 switch 没 exhaustive
  （TS 抱怨）。
- `auto` 下 `rm -rf /` 仍走 allow。

---

## 风险与回退

- **最大风险**：分类器假阴性放行危险命令。
  **缓解**：默认未知 → risky；把 `dangerous` 清单从 Claude Code 的
  [alwaysDenyRules](https://docs.anthropic.com) 常用项拷齐。
- **回退**：类型里已 tolerant，删除 tool-policy.ts 两段分支即回到当前。

---

## 不确定项

- 分类器对复合 shell（pipeline、subshell）识别有限。v1 只匹配顶层字符串
  足以防范典型误操作；后续可接 AST（shell-parse）做深解析，不在本期。
