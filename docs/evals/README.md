# Evals

XQoder 的 deterministic eval 产物统一写到这个目录。

每个 eval 都输出两份文件：

- `*.json`（机器读）
- `*.md`（人工读）
- `history/*.jsonl`（按 `generatedAt` 追加的趋势快照）
- `report.md`（自动聚合的公开总览页）

当前已接入：

1. `workflow-fixtures`（`build/fix/test/deploy` fixture completion-rate 评估）
2. `real-project-results`（从 `workflow-history.jsonl` 聚合真实项目运行记录，包含 deterministic `build/fix/deploy drill` 覆盖）

## 运行命令

```bash
pnpm eval:workflow
pnpm eval:workflow --release
pnpm eval:real-projects
pnpm eval:real-projects:sync --dry-run
pnpm docs:eval:real-projects
pnpm docs:quality:reports
```

## 入口页

- 汇总入口：[`docs/quality-report.md`](/Users/wangxinglin/Desktop/code/Xqoder/docs/quality-report.md)
- Eval 总览：[`docs/evals/report.md`](/Users/wangxinglin/Desktop/code/Xqoder/docs/evals/report.md)
- 真实项目页：[`docs/evals/real-project-results.md`](/Users/wangxinglin/Desktop/code/Xqoder/docs/evals/real-project-results.md)
- 真实目标清单：[`docs/evals/real-project-targets.json`](/Users/wangxinglin/Desktop/code/Xqoder/docs/evals/real-project-targets.json)
- Targets 示例：[`docs/evals/real-project-targets.example.json`](/Users/wangxinglin/Desktop/code/Xqoder/docs/evals/real-project-targets.example.json)
- 开源目标示例：[`docs/evals/real-project-targets.opensource.example.json`](/Users/wangxinglin/Desktop/code/Xqoder/docs/evals/real-project-targets.opensource.example.json)
- 开源目标清单：[`docs/evals/real-project-targets.opensource.json`](/Users/wangxinglin/Desktop/code/Xqoder/docs/evals/real-project-targets.opensource.json)

## 门禁规则

- 本地默认允许少量波动（`strict=false`）。
- `--release` 或 CI 模式启用严格门禁（`strict=true`），失败直接退出非 0。

## 目标

这套 eval 目录用于：

- release gate 的稳定性验收
- workflow 回归追踪
- “超越 OpenCode” 的持续证据沉淀

## 趋势记录

- 每次 eval 写入 `docs/evals/history/<slug>.jsonl`
- `pnpm benchmark:pr-summary` 会同时读取 benchmark / eval 当前产物与历史快照
- 若本机存在 `~/.xqoder/data/workflow-history.jsonl`，PR summary 还会附带项目级 workflow success rate、failure buckets 和 7d/30d trend
- `pnpm docs:eval:real-projects` 会把真实项目历史聚合成 `real-project-results.{json,md}`；自动模式默认排除 `/tmp`、系统临时目录和 fixture 工程
- 真实项目报告会同时输出 target readiness inventory，把缺少 checkout、缺少命令、缺少 `.env` 这类阻塞条件结构化收口
- `pnpm eval:real-projects:sync` 会读取 target 清单里带 `repo` 的条目，并按需 clone 缺失 checkout；默认不会改动已有 checkout，传 `--update-existing` 才会刷新现有仓库
- `sync` summary 会连同 readiness 一起输出，方便在 clone 之后立即看到 target 还缺哪些本地前置条件
- 若 `checkoutRoot` 已存在但没有 `.git`，且 `projectRoot` 可用，sync 会把它视为本地源码快照并保守跳过
- `pnpm eval:real-projects` 会按 `docs/evals/real-project-targets.json` 逐个运行 `test + build drill + fix drill + deploy drill`；默认清单已经包含通过验证的外部 OpenClaw / Directus / OpenCode target
- runner 会先做 readiness preflight；缺少 checkout、缺少 `bun`、缺少 `.env` 这类已声明前置条件的 target 会被明确跳过，而不是混进 workflow 失败统计
- 对于服务型样本，如果 blocker 仅来自 `readinessChecks`，runner 会先执行 `prepareCommand`，然后重新做 readiness 检查；适合像 FastAPI 这种需要先拉起本地 Postgres 再进入测试的 target
- 对于已验证但暂不适合全场景启用的样本，可以用 `scenarios` 只开放稳定子集；当前 FastAPI backend 默认开放 `test`，OpenCode core snapshot 则通过 `OPENCODE_CHANNEL=latest` + `bun run build --single` 维持完整 `test/fix/build/deploy` 覆盖
- `build drill` 通过正式 `runBuildCommand` 流程执行，使用 deterministic no-op 生成器并跑目标项目真实测试验证
- `fix drill` 会临时写入 `.xqoder/real-project-fix-drill.json`，通过正式 `runFixCommand` 流程清理后再跑真实测试验证
- `deploy drill` 通过正式 `runDeployCommand` 流程执行，使用 deterministic 本地 deployer 跑真实 build command 并校验 outputDir，不依赖真实云账号
- 运行完成后会自动刷新真实项目报告与质量总览
- target 支持可选字段：
  - `prepareCommand`：在每个 target 场景开始前执行一次（默认启用，可用 `--no-prepare` 关闭）
  - `testCommand`：覆盖默认测试命令（用于 monorepo 子包或非标准 test script）
  - `checkoutRoot`：repo checkout 根目录；支持 `${HOME}` 这类环境变量模板
  - `projectPath`：当评测目标位于 repo 子目录时，声明相对 `checkoutRoot` 的路径
  - `ref`：可选 git branch/tag/commit，用于 `eval:real-projects:sync` clone 或更新到指定版本
  - `scenarios`：可选场景白名单，例如 `["test","fix","build"]`；用于让某些跨语言样本先跳过暂不支持的 deploy drill
  - `requiredCommands`：运行该 target 前必须存在的本地命令，例如 `["pnpm"]` 或 `["bun"]`
  - `requiredEnv`：运行该 target 前必须存在的环境变量列表
  - `requiredPaths`：相对 `projectRoot` 或绝对路径的前置文件/目录，例如 `[".env"]`
  - `readinessChecks`：可选 shell 级健康检查列表；适合声明 `localhost:5432` 这类外部依赖是否真的可达
  - 当 target 同时声明 `prepareCommand` 和 `readinessChecks` 时，只要阻塞项不是缺 checkout / 缺命令 / 缺 env / 缺路径，runner 会先执行 `prepareCommand`，再重新判断 readiness
  - `commandEnv`：可选环境变量注入；会同时作用于 `prepare/test/fix/build/deploy` 这几类 runner 命令
  - `deployBuildCommand` / `deployOutputDir`：可选 deploy drill override；适合像 OpenCode core 这种需要 `bun run build --single` 才能在本地 snapshot 上稳定完成 deploy 的样本
  - `enabled`：设为 `false` 后可临时跳过该 target
- 可通过 `node ./scripts/run-real-project-evals.mjs --targets <target-file>` 使用不同 target 清单（例如开源仓库清单）
- 可通过 `pnpm eval:real-projects:sync --targets <target-file> --include-disabled` 一次性拉取可选外部仓库，再用 `--update-existing` 刷新干净 checkout
- 可通过 `--no-reports` 只写 workflow history 不刷新文档报告，适合先做外部仓库试跑
