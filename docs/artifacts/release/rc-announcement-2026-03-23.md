# XQoder RC 发布公告（v0.1.0-rc.202603230340）

发布日期：2026-03-23（Asia/Shanghai）  
发布通道：RC  
Git Tag：`v0.1.0-rc.202603230340`  
Tag Commit：`25d1e27231826891f6d45bdda907b8f544930b8e`

## 本次发布包含

- Phase 4 Gate 正式收口，路线图第 12 周发布门禁已回填完成。
- 三平台矩阵验证通过（macOS Stable / Linux Beta / Windows Preview Node CLI）。
- RC 版本分支准备与合并完成（PR [#5](https://github.com/sqoder/Xqoder/pull/5)）。
- 发布状态文档同步完成（PR [#6](https://github.com/sqoder/Xqoder/pull/6)）。

## 安装与升级

### 1) 全新安装（按 RC Tag）

```bash
git clone https://github.com/sqoder/Xqoder.git
cd Xqoder
git checkout v0.1.0-rc.202603230340

pnpm install --frozen-lockfile
pnpm build
pnpm xqoder -- --help
```

初始化模型配置（示例）：

```bash
pnpm xqoder -- config init --provider openai --api-key <your-key>
pnpm xqoder -- chat "先看看这个项目"
```

### 2) 已有仓库升级到 RC

```bash
git fetch origin --prune --tags
git checkout v0.1.0-rc.202603230340
pnpm install --frozen-lockfile
pnpm build
```

### 3) 可选：注册全局命令

```bash
pnpm link --global
xqoder --help
```

## 验证证据（关键运行）

- PR `#5` CI：run `23420474138`（success）
- PR `#5` Platform Matrix：run `23420474134`（success）
- 主干合并后 CI：run `23420551339`（success）
- 主干合并后 Platform Matrix：run `23420551345`（success）

## 已知说明

- Windows 当前为 **Node CLI Preview** 路径；Rust client 仍以 Unix 平台为主。
- RC 版本用于发布候选验证，不等同于 stable/GA。

## 下一步建议

- 按 `docs/release-rollout-runbook.md` 执行 RC -> Beta -> Stable 分阶段放量。
- 同步外部发布说明（团队公告、安装指引、变更摘要）。
