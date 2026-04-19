# XQoder 跟进行动清单（2026-04-19）

基于 `docs/project-analysis-skillflow-2026-04-19.md`，当前建议按下面顺序继续收口：

## 已在本轮收口

1. README 已回到真实状态：
   - TUI 默认不再宣称“自动恢复最近会话”
   - 明确 `xqoder tui --continue` / `xqoder tui --session <id>`
   - Quick Start 先展示 `auth login` + `models use`
   - Workspace Layout 改为 `当前稳定目录` + `目标落点目录`
2. 缺失 API key 的用户引导已统一为同一条提示文案：
   - `auth login`
   - `config init`
   - `XQODER_LLM_API_KEY`
3. 已补最小守护测试：
   - README 的 TUI 恢复语义
   - terminal runtime 的恢复条件
   - API key 引导文案内容

## 下一轮优先动作

### P1

1. 给 `stats / auth / models / agent` 补专项测试，提升高漂移命令面的验证强度
2. 继续把 README 与真实实现逐段对齐，避免“目标架构描述”覆盖“当前实现状态”
3. 把 Windows CI 从 `build + smoke` 补到至少 `build + lint + test`

### P2

4. 收紧 coverage floor，特别是 terminal shell 和配置/会话主链
5. 把更多启动/配置错误提示统一到面向用户的新命令面
6. 继续削减 legacy 主链依赖，优先：
   - `src/platform/terminal/app/run-terminal-app.ts`
   - `src/application/config/service.ts`
   - `src/infrastructure/agent/tui-agent-service.ts`

## 一句话判断

> 当前仓库已经适合继续推进，但文档必须持续以“当前真实行为”为准，而不是提前写成“目标态已经完成”。
