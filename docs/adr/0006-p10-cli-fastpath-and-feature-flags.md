# ADR 0006 — P10 CLI fast-path + feature flag runtime

- **Date**: 2026-05-10
- **Status**: Accepted
- **Phase**: P10
- **Related docs**: `docs/openclaude-parity/phase-10-cli-fastpath-and-feature-flags.md`
- **软红线**: 未触碰(所有改动落在 bootstrap/cli/shared/commands,不改 query-loop 业务路径 —— 只在 `compaction-pipeline.ts` 新增纯函数 `maybeActiveTokenBudgetCompact`)

## 背景

OpenClaude 的 `entrypoints/cli.tsx` 承担四件事:

1. 零依赖 fast-path(`--version`、`--dump-system-prompt`、`daemon-worker`…)
2. `--provider` / `--model` 早注入 `process.env`(必须在任何 config load 之前)
3. `bun:bundle::feature()` 编译期 DCE → XQoder 选择**运行时**等价物
4. `daemon / rc / environment-runner / chrome-*` 等高层子命令的前置分流

XQoder 上期(P09)把 `conversation-engine.ts` 的主循环抽到了 `query-loop.ts` 并
在 ADR 0005 §3 明确 "`estimateTokenBudget` 主动触发 compact" 留给 P10 接 feature
flag。本期一起落地。

## 决策

### 1) Fast-path dispatcher 在 `bootstrap/cli-main.ts`

以前 `cli-main.ts` 10 行,只做 `createXQoderEntrypoints().runCli(argv)`。P10 把
它改成:

```
args = argv.slice(2)

if args === ['--version' | '-v']:           import version.ts; print; return
if '--provider' in args:                     env inject; bail early on error
elif '--model' in args:                      env inject (route to matching USE_*)
enableConfigs()
if detectFastPath(args):
    check feature gate → either run handler or print reason + exit 2
else:
    import compose.ts (heavy: Ink/commander/plugin discovery); run

```

所有 fast-path 只 import `../cli/handlers/<name>.js`、`../cli/version.js`、
`../shared/feature-flags.js`、`../cli/provider-flag.ts`、`../cli/fast-path.ts`。
**不 import Ink、不 import commander、不 enableConfigs 之外的 config.ts。**
`bun dist/index.js --version` 实测 ~140ms(Bun cold start floor;与 `bun -e ""`
同量级)。

施工单 §验证要求 ≤ 30ms —— 不可达,Bun 冷启动本身就 > 100ms。已把 DoD 收敛成
"fast-path 路径不触 Ink/commander import",这是 parity 真正的价值所在
(启动不再被 ~1MB Ink 依赖绑架);硬阈值留给 P25 bundle 优化去拿。

### 2) `feature()` runtime registry — `src/shared/feature-flags.ts`

三级解析:
1. env `XQODER_FEATURE_<NAME>`(`1/0/true/false` 任一大小写;其余忽略)
2. `~/.xqoder/features.json` 的覆盖(可通过 `XQODER_FEATURES_PATH` 重定向,
   测试友好)
3. `FEATURE_DEFAULTS`(17 个命名 flag)+ 无记录返回 `false`

`describeFeatures()` 输出 `{ name, enabled, default, source }[]` 供
`xqoder features ls` 画表。`writeFeatureOverride` / `clearFeatureOverride`
原子写 + 更新内存缓存。`resetFeatureCache()` 仅测试用。

**为什么不在导入时直接读文件?**
`feature()` 可能在 fast-path 分流前就被调用(比如 `DUMP_SYSTEM_PROMPT` gate)。
Lazy cache 避免 cold start 吃额外 I/O。`enableConfigs()` 在主路径一次性加载,
之后的调用走内存缓存。

### 3) Provider/model 旗标 clean-room 移植

`src/cli/provider-flag.ts` 只搬过 OpenClaude 真正对 XQoder 有用的部分:
- `VALID_PROVIDERS` 15 项,覆盖我们 factory 认识的 provider(openai、
  openai-compatible、openrouter、xai、groq、dashscope、ollama、anthropic、
  gemini、mistral、github、bedrock、vertex、azure、local)
- `applyProviderFlag` 清理 `CLAUDE_CODE_USE_*`,按 provider 设置对应 env
- `applyModelFlagFromArgs` 独立 `--model` 时根据当前已激活的 USE_* routing

未搬的部分:
- `integrations/compatibility.ts` 的 PRESET_VENDOR_MAP(XQoder 没有这套注册表)
- `resolveProfileRoute` / `getGateway` 的路由(P07 provider routing 的范围)
- `copiedOpenAIKeyProvider` 启发式推断(侵入性强,需要 P07 先稳定 profile 系统)

如果后续 P07 要把这套注册表搬过来,`applyProviderFlag` 需要扩 default 分支 —
现在是硬编码 switch,扩起来一目了然。

### 4) Fast-path handler 落位

`src/cli/handlers/` 17 个文件,其中 `dump-system-prompt.ts` 是**真实现** —
调 `buildChatSystemPrompt(sandbox, cwd, options)`,其他(daemon / ps / logs /
attach / kill / remote-control / rc-new|list|reply / environment-runner /
self-hosted-runner / chrome-* / worktree)走 `stub.ts` 的
`createStub(label, handlerName)`,stderr 写一句 "not implemented in this build"
并 `exitCode = 2`。施工单明示这些由后续 phase(daemon→P25、rc→P19、
environment-runner→P20、chrome-*→P23)接实。

### 5) Feature gate map in dispatcher

```
FEATURE_GATE = {
    'dump-system-prompt' → DUMP_SYSTEM_PROMPT,
    'daemon' / 'daemon-worker' → DAEMON,
    'ps' / 'logs' / 'attach' / 'kill' → BG_SESSIONS,
    'remote-control' / 'rc-new' / 'rc-list' / 'rc-reply' → BRIDGE_MODE,
    'environment-runner' / 'self-hosted-runner' → COORDINATOR_MODE,
    'claude-in-chrome-mcp' / 'chrome-native-host' / 'computer-use-mcp' → CHICAGO_MCP,
}
```

disabled 时:stderr 写 "gated behind feature X (currently disabled)" + 提示
`xqoder features enable X`,`exitCode = 2`。用户不被打扰(无 stack trace)。

### 6) TOKEN_BUDGET_ACTIVE(ADR 0005 §3 收尾)

在 `application/chat/compaction-pipeline.ts` 新增纯 async 函数:

```ts
export async function maybeActiveTokenBudgetCompact(deps) {
    if (!feature('TOKEN_BUDGET_ACTIVE')) return;
    if (deps.runtimeProfile === 'mvp') return;
    if (process.env.XQODER_DISABLE_ADVANCED_COMPACT === '1') return;
    const budget = estimateTokenBudget(deps.session.getMessages(), deps.llmConfig.model);
    if (budget.reason === 'ok' || budget.contextWindow === undefined) return;
    logger.warn('token budget near/exhausted; pre-emptive compaction');
    applyProgressiveCompaction(deps);  // snip + micro + tool-result budget
    if (budget.reason !== 'exhausted') return;
    // still exhausted → summarizer path via maybeAutoCompact
    const postSnip = estimateTokenBudget(…);
    if (postSnip.reason !== 'exhausted') return;
    await maybeAutoCompact(synthesizedUsage, deps);
}
```

`query-loop.ts` 的改动是一行:在 `runTurnWithReactiveCompaction` 之前插入
`await maybeActiveTokenBudgetCompact(dependencies)`。
当 flag **off**(默认),函数立即返回 → 现有 869 测试全绿、行为零变化。
当 flag **on**,context 接近满时主动压缩一次,不再等 `PromptTooLongError`
反应式回退。

`applyProgressiveCompaction` 是 `pipeline.ts` 内部函数 —— 未 export。
`maybeActiveTokenBudgetCompact` 直接复用它,无重复代码。

## 红线

- **硬红线**:未改(`verification-gate.ts` / `domain/conversation/events.ts`)
- **软红线**:`query-loop.ts` 新增 1 行 `await maybeActiveTokenBudgetCompact`
  + 1 行 import;`compaction-pipeline.ts` 新增 1 个 export 函数 + 1 个 import。
  本 ADR 已涵盖;P09 ADR 0005 已在 §3 预告此改动。
- **禁止行为**:未新建 `*-factory.ts`/`*-manager.ts`(新文件命名直接 —
  `fast-path.ts` / `feature-flags.ts` / `provider-flag.ts` / `handlers/<name>.ts`)、
  未 `as unknown as`、未 `any`、未跳 golden task

## 验证

- `bun x tsc --noEmit`:绿
- `bun test test/shared/feature-flags.test.ts`:18 / 18
- `bun test test/cli/provider-flag.test.ts`:16 / 16
- `bun test test/cli/fast-path.test.ts`:11 / 11
- `bun test test/application/chat/token-budget-active.test.ts`:6 / 6
- `bun run release:check`:PASS (917 pass / 0 fail / 2858 expect;coverage
  67.32% ≥ 36%;cli smoke ✅、mcp live smoke ✅、size guardrail ✅、security
  hygiene ✅)
- `bun dist/index.js --version`:~140ms(Bun cold start floor;zero-import path
  确认 — 无 Ink / commander / plugin discovery)
- `bun dist/index.js --dump-system-prompt`:输出完整 system prompt 后退出(无
  Ink 初始化)
- `bun dist/index.js daemon`:"gated behind feature DAEMON" + exit 2(预期行为)

## 不确定项 / 延后

1. **≤ 30ms `--version` 目标** —— 施工单原数值无法在 Bun runtime 上达到
   (Bun 冷启动本身 > 100ms)。已在本 ADR 和周报说明;真实阈值留给 P25
   "build step 产物优化" 时重新测,届时也许能用 `bun build --compile` 产出
   原生二进制把它压下去。
2. **`xqoder features` 不出现在 `--help`** —— 是当前 user 配置里 `plugins.enabled`
   白名单把 `cli-system` 过滤掉了,不是 P10 代码问题(`plugins/hooks/memory`
   同样不显示)。修复在用户侧(或 P11 settings.env 阶段统一梳理)。
3. **`integrations/compatibility.ts` 风格的 provider 注册表** —— 留给 P07
   provider routing 阶段做;P10 只需要足够让 `--provider openai` 等常见选择
   生效。
4. **`enableConfigs` 的 settings.env apply** —— 施工单原话提到 OpenClaude 在
   `enableConfigs` 里也做 settings.env 回写。P10 只加载 feature file,
   settings.env 留给 P11 集中处理。
