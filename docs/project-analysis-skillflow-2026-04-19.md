# XQoder 项目分析与文档交付（按技能流执行）

- 日期：2026-04-19
- 分析对象：`/Users/wangxinglin/Desktop/ts/Xqoder-team-clean`
- 参考基线：
  - `/Users/wangxinglin/Desktop/project-review-report-2026-04-18.md`
  - `/Users/wangxinglin/Desktop/ts/Xqoder-team-clean/docs/project-review-report-2026-04-18.md`
  - `/Users/wangxinglin/Desktop/ts/Xqoder-team-clean/docs/project-audit-cleanup-2026-04-18.md`
- 执行方法：`Plan -> Deep Interview -> Ralph / Team -> Verification Loop -> AI Slop Cleaner -> Code Review -> Cancel`

---

## 0. 先说结论

当前这份 `Xqoder-team-clean` 快照，**已经明显比 2026-04-18 报告中的状态更收口**：

- `src/index.ts:14-16` 直接进入 `bootstrap/cli-main`，默认启动链已经稳定。
- `src/platform/tui` 旧目录已被清空，且有守护测试：
  - `test/platform/tui/minimal-surface.test.ts:9-24`
- README 的 TUI 命令面已与 live shell 对齐，且有守护测试：
  - `test/platform/terminal/app/readme-alignment.test.ts:20-34`
- 本地验证层面，在执行 `bun install` 之后：
  - `bun run build` ✅
  - `bun run lint` ✅
  - `bun run test` ✅（72 pass / 0 fail）
  - `bun run release:check` ✅

但这不等于项目已经完全进入“新架构完成态”或“文档完全真实态”。

**当前更准确的判断是：**

1. **产品主线已经可构建、可测试、可继续开发**
2. **4/18 的部分高风险结论已经过时，需要文档回补**
3. **仓库仍然处于“新层已建立，但旧实现仍占大头”的迁移中间态**
4. **现在最该补的是文档真实性和验证门强度，而不是再写一份泛泛而谈的旧问题清单**

---

## 1. Plan

### 1.1 本次文档目标

本次不重复 4/18 的旧审查报告，而是补一份**跟当前快照状态一致**的 follow-up 文档，回答四个问题：

1. 这个项目现在到底运行在什么主线之上？
2. 4/18 里哪些问题已经被修掉了？
3. 还剩哪些真实问题？
4. 下一步文档和工程门禁应该怎么收口？

### 1.2 本次假设

为避免误判，本次明确采用以下假设：

1. 工作区里同时有 `Xqoder` 与 `Xqoder-team-clean` 两个目录；本次分析目标选择 **`Xqoder-team-clean`**，因为：
   - 它有仓库内 `AGENTS.md`
   - `git status` 干净
   - 更适合作为当前稳定快照做文档交付
2. “完成文档需求”解释为：**新增一份最新状态文档**，而不是直接重写现有 README。
3. 构建/测试结论以 **2026-04-19 本地重新验证** 为准；首次失败仅因未安装依赖，执行 `bun install` 后复验通过。

### 1.3 本次范围

在范围内：

- CLI / TUI 真实入口链
- 架构迁移完成度
- README 与实现的一致性
- build / lint / test / release gate
- 文档应如何更新

不在范围内：

- 真实第三方 API 联调
- 长时间人工交互式 UX 回归
- 生产环境部署演练
- 大规模代码重构实施

---

## 2. Deep Interview（把该问清的先在代码里问清）

这一步没有继续向用户追问，而是优先从仓库里把关键歧义消掉。

### 2.1 我替你先问清的三个问题

#### Q1：这次到底分析哪个仓库状态？

答案：分析 `Xqoder-team-clean`，不是带大体量未收口 diff 的原始 `Xqoder`。

#### Q2：4/18 报告现在还能不能直接当结论用？

答案：**不能直接照搬。**

4/18 报告中的若干关键发现已经失效或至少需要降级，比如：

- “README TUI 命令面与 live shell 不一致”  
  现在已有守护测试：`test/platform/terminal/app/readme-alignment.test.ts:20-34`
- “`src/platform/tui` 仍残留大量旧文件”  
  现在已有守护测试：`test/platform/tui/minimal-surface.test.ts:9-24`
- “启动时会清空 scrollback”  
  当前 `src/index.ts:1-26` 已无 `console.clear()`

#### Q3：这次文档要产出什么？

答案：产出一份**新的 follow-up 文档**，用于替代“只看 4/18 老报告”的做法。

---

## 3. Ralph / Team（并行取证后的主结论）

本次把分析拆成了 3 条并行证据链：

1. **架构 / 主线入口**
2. **README / 命令面 / 文档漂移**
3. **验证门 / 风险 / 安全卫生**

以下为合并后的结论。

### 3.1 当前真实入口链

#### 默认 `xqoder`（TTY，无显式子命令）主链

`src/index.ts:14-16`  
→ `src/bootstrap/cli-main.ts`  
→ `src/bootstrap/compose.ts`  
→ `src/interfaces/cli/index.ts`  
→ `src/cli/root-shell.ts`  
→ `src/interfaces/tui/index.ts:84-112`  
→ `src/platform/terminal/app/run-terminal-app.ts:489-528`

#### 显式 `xqoder tui` 主链

`src/index.ts:14-16`  
→ `src/bootstrap/cli-main.ts`  
→ `src/bootstrap/compose.ts`  
→ `src/interfaces/cli/index.ts`  
→ `src/interfaces/tui/index.ts:114-140`  
→ `src/interfaces/tui/index.ts:84-112`  
→ `src/platform/terminal/app/run-terminal-app.ts:489-528`

#### 当前 live shell 本地命令面

`src/platform/terminal/app/run-terminal-app.ts:45-60` 定义的本地命令只有：

- `/quit`
- `/exit`
- `/new`
- `/session new`

实际处理逻辑见：`src/platform/terminal/app/run-terminal-app.ts:291-311`

### 3.2 当前项目状态不是“旧架构已清空”

README 目标层说明在：

- `README.md:68-79`

但真实代码规模仍显示：**旧体系体量大于新体系体量**。

#### 新层目录文件数（TS/TSX）

- `src/bootstrap`：3
- `src/interfaces`：12
- `src/application`：29
- `src/domain`：14
- `src/infrastructure`：14
- `src/shared`：7

合计：**79**

#### 旧层目录文件数（TS/TSX）

- `src/commands`：34
- `src/core`：58
- `src/platform`：3
- `src/infra`：35
- `src/features`：19
- `src/cli`：3
- `src/plugins`：3
- `src/ux`：1

合计：**156**

### 3.3 迁移中间态的硬证据

虽然新 landing zone 已经存在，但关键主链仍穿过旧目录：

- `src/interfaces/tui/index.ts:10` 仍直接依赖 `src/platform/terminal/app/run-terminal-app.ts`
- `src/interfaces/cli/index.ts` 仍依赖旧 `src/cli/root-shell.ts`
- `src/application/config/service.ts:19-20` 仍依赖 `src/plugins/command-plugins.ts` 与 `src/cli/version.ts`
- `src/infrastructure/agent/tui-agent-service.ts:28` 仍依赖 `src/plugins/runtime-plugin-loader.ts`
- `src/infrastructure/shell/index.ts:1` 仍为空壳 `export {}`

所以准确说法应该是：

> **新架构方向已建立，但当前仍是“新层外壳 + 旧实现主干”的中间态。**

### 3.4 仍需关注的大文件

以下文件仍是明显的后续拆分热点：

- `src/core/agent/mcp.ts` — 1329 行
- `src/core/agent/lsp.ts` — 1228 行
- `src/core/agent/tools/lsp-tools.ts` — 1207 行
- `src/interfaces/http/server-openapi.ts` — 1181 行
- `src/infra/shared/config-normalizers.ts` — 1036 行
- `src/features/sessions/assets.ts` — 798 行
- `src/infrastructure/agent/tui-agent-service.ts` — 665 行
- `src/platform/terminal/app/run-terminal-app.ts` — 528 行
- `src/application/config/service.ts` — 489 行

---

## 4. Verification Loop（实际跑过的，不是猜的）

### 4.1 执行过的命令

在 `/Users/wangxinglin/Desktop/ts/Xqoder-team-clean` 下执行：

```bash
bun install
bun run build
bun run lint
bun run test
bun run release:check
bun dist/index.js --help
```

### 4.2 结果

| 项目 | 结果 | 备注 |
| --- | --- | --- |
| Install | PASS | 首次缺 `node_modules`，补安装后恢复正常 |
| Build | PASS | `bun run build` 通过 |
| Lint | PASS | `bun run lint` 通过 |
| Tests | PASS | `72 pass / 0 fail` |
| Release Check | PASS | 包含 build/lint/slice-tsc/coverage/security |
| CLI smoke | PASS | `bun dist/index.js --help` 正常输出 |

### 4.3 release gate 的真实内容

见 `package.json:12-27`：

- `build`
- `lint`
- `lint:layers-strict`
- `lint:domain-exact-optional`
- `lint:application-system-exact-optional`
- `lint:application-permissions-sessions-exact-optional`
- `test:coverage`
- `security:tracked`

CI 也确实在跑它，见：

- `.github/workflows/ci.yml:31-57`

### 4.4 当前验证门的强弱判断

#### 优点

- 已经不是“只靠人手跑一下”
- 有 CI gate
- 有架构 guardrail test
- 有 README TUI 对齐 test
- 有 public docs portability test

#### 不足

1. **coverage gate 偏松**
   - `scripts/check-coverage.mjs:10-24`
   - repo 总体 line coverage 只要求 **25%**
   - `run-terminal-app.ts` 的单文件门槛只有 **10%**

2. **主 tsconfig 不是 repo-wide strict**
   - `tsconfig.json:2-46`
   - `strict: false`
   - `test` 被排除在类型检查之外

3. **security:tracked 扫描范围窄**
   - 它只扫白名单路径，见脚本实现与已有审查结论

4. **平台矩阵不对称**
   - macOS / Linux 有 build + lint + test + smoke  
   - Windows 只有 build + smoke  
   - 见 `.github/workflows/platform-matrix.yml:15-112`

5. **manual E2E 仍是手动触发**
   - `.github/workflows/manual-e2e.yml:1-46`

### 4.5 覆盖率结论

本地 `release:check` 输出：

- Overall line coverage：**28.66%**
- Gate：**PASS**

这说明：

> 当前 coverage gate 是“已有门”，但还不是“高强度门”。

---

## 5. AI Slop Cleaner（把旧报告里已经过时的噪音删掉）

如果继续把 4/18 的问题原样复制到今天的文档里，会制造新的“文档噪音”。这一步的工作是把**已经不成立**和**仍然成立**的结论分开。

### 5.1 已经明显收口的项

#### A. 旧 `platform/tui` 死代码岛已不再是当前主问题

- `test/platform/tui/minimal-surface.test.ts:9-24` 已要求：
  - `src/platform/tui` 下无剩余源码文件
  - 源码中无 `platform/tui` 引用

#### B. README 的 TUI 命令面已收口到 live shell

- `test/platform/terminal/app/readme-alignment.test.ts:20-34`

#### C. 启动清屏问题至少已从主入口收掉

- `src/index.ts:1-26` 当前无 `console.clear()`

### 5.2 现在真正还存在的问题

#### 1) README 的“TUI 自动恢复最近会话”表述不准确

README 写法：

- `README.md:223-226`

但真实实现只在 `--continue` / `--session` 下恢复：

- `src/cli/root-shell.ts:81-87`
- `src/interfaces/tui/index.ts:119-121`
- `src/platform/terminal/app/run-terminal-app.ts:514-517`
- `src/platform/terminal/app/agent-runtime.ts:95-106`

#### 2) README 的 Workspace Layout 已经过时

README 仍用旧目录来描述工作区：

- `README.md:321-333`

但前文 Architecture 段又要求新代码落到：

- `README.md:68-79`

这会造成两层误读：

1. 用户以为旧目录仍是推荐 landing zone
2. 读者很难看出“当前结构”和“目标结构”的区别

#### 3) auth/models 文案和真实用户引导不完全一致

README 说它们已经是一等命令面：

- `README.md:118-146`

但缺 key 时，产品提示仍引导用户走旧 `config init`：

- `src/application/chat/run-chat.ts:223-225`
- `src/application/config/service.ts:251-259`

#### 4) 项目验证门仍偏“过渡态”

不是没有 gate，而是 gate 的门槛还不够硬：

- coverage floor 低
- strict typing 不是全仓
- Windows gate 弱于 macOS/Linux
- manual E2E 非必经

---

## 6. Code Review（按严重度给出文档与工程问题）

### HIGH

#### H1. README 对 TUI 自动恢复行为表述错误

**问题**  
README 声称未手动 resume 时会自动恢复最近 project session，但生产路径没有接这条默认恢复逻辑。

**证据**

- `README.md:223-226`
- `src/cli/root-shell.ts:81-87`
- `src/interfaces/tui/index.ts:119-121`
- `src/platform/terminal/app/run-terminal-app.ts:514-517`
- `src/platform/terminal/app/agent-runtime.ts:95-106`

**影响**

- 用户对 TUI 行为形成错误预期
- 文档再次领先于真实实现

**建议**

- 要么修 README
- 要么真把“latest 自动恢复”接回默认 TUI 启动路径

### MEDIUM

#### M1. README 的 Workspace Layout 段落与 Architecture 段自相矛盾

**证据**

- 目标层：`README.md:68-79`
- 旧布局说明：`README.md:321-333`

**建议**

- 改成“双视图”：
  - Current major directories
  - Target architecture landing zones

#### M2. auth/models 已升级，但报错提示和医生命令还在旧叙事

**证据**

- `README.md:118-146`
- `src/application/chat/run-chat.ts:223-225`
- `src/application/config/service.ts:251-259`

**建议**

- 缺 key 时优先提示：
  - `xqoder auth login <provider> --api-key <key>`
  - `xqoder models use <model> ...`

#### M3. 架构迁移仍是中间态，但 README 容易让人误以为已经基本完成

**证据**

- 旧层 TS/TSX 文件数 156 > 新层 79
- `src/infrastructure/shell/index.ts:1`
- `src/application/config/service.ts:19-20`
- `src/infrastructure/agent/tui-agent-service.ts:28`

**建议**

- 在文档里明确加一段：
  - “Current stable path”
  - “Target path”
  - “Migration still in progress”

#### M4. release gate 存在，但不够硬

**证据**

- `package.json:12-27`
- `scripts/check-coverage.mjs:10-24`
- `tsconfig.json:9,45-46`
- `.github/workflows/platform-matrix.yml:85-112`

**建议**

- 提高 overall coverage floor
- 给 `stats/auth/models/agent` 加专项测试
- 把 Windows 也补上 lint/test

### LOW

#### L1. 快照环境首次验证前需要 `bun install`

这不是代码缺陷，但对“拿来就验”的审查流程有影响。建议在文档里明确写清：

```bash
bun install
bun run build
bun run release:check
```

---

## 7. 建议直接落地的文档动作

### 7.1 README 最小修订清单

1. 修正 `README.md:225`  
   把“默认自动恢复最近 session”改为：
   - 使用 `--continue` 或 `--session <id>` 恢复
   - 默认行为如果尚未实现，就不要先写进 README

2. 重写 `README.md:321-333`  
   把 Workspace Layout 改成：
   - 当前目录结构（current reality）
   - 目标架构目录（target architecture）

3. 调整 Quick Start  
   `README.md:40-52` 可保留 `config init`，但应补一条：
   - 新用户也可以用 `auth login` + `models use`

### 7.2 工程文档最小修订清单

建议在后续文档中统一使用下面这句话，避免夸大：

> XQoder 当前已经完成 terminal scrollback shell 收口、README TUI 命令面对齐、旧 `platform/tui` 清空和 release gate 落地；但整体架构迁移仍未完成，真实主链路仍穿过部分 legacy 目录。

### 7.3 下一轮工程动作

1. 修 README 的 TUI 自动恢复描述
2. 修 README 的 Workspace Layout 段
3. 统一 auth/config 错误提示
4. 给 `stats / auth / models / agent` 补专项测试
5. 把 `interfaces` / `infrastructure` 也纳入更强的 guardrail 约束

---

## 8. Cancel（收尾）

本轮技能流执行到这里可以安全收口：

- 目标仓库已分析完成
- 新文档已产出
- 无需额外清理运行态模式

**最终结论：**

> 这个项目现在值得继续在 `Xqoder-team-clean` 快照上推进，但后续文档必须改成“真实描述当前状态”，不能再继续沿用 2026-04-18 那份更偏“问题总表”的历史快照口径。
