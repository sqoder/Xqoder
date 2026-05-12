# Phase 10 · CLI fast-path + feature flag 运行时

## 任务目标（必须可验证）

复刻 OpenClaude `entrypoints/cli.tsx` 的 fast-path 分流逻辑和 `bun:bundle::feature()`
的 **运行时** 等价物（XQoder 不做编译期 DCE）。

### 成功判定

- `bun dist/index.js --version` 在 ≤ 30ms 返回版本号（不加载 Ink、不 enableConfigs）。
- `bun dist/index.js --dump-system-prompt` 输出最终 system prompt 后退出（需 feature DUMP_SYSTEM_PROMPT=1）。
- `xqoder features ls` 输出当前所有 flag 状态表。
- `xqoder features enable PROMPT_CACHE` 写入 `~/.xqoder/features.json`。
- 下列 fast-path 子命令框架存在（每个子命令独立 PR 接入）：
  `daemon / --daemon-worker / ps / logs / attach / kill / remote-control / rc /
  new / list / reply / environment-runner / self-hosted-runner /
  --claude-in-chrome-mcp / --chrome-native-host / --computer-use-mcp /
  --worktree + --tmux / --provider / --model`

## 对标源

- `openclaude/src/entrypoints/cli.tsx`（主入口）
- `openclaude/src/utils/providerFlag.ts`
- `openclaude/src/utils/providerValidation.ts`
- `openclaude/src/utils/providerProfile.ts`
- `openclaude/src/utils/cliArgs.ts`
- `openclaude/src/utils/startupProfiler.ts`
- `openclaude/src/utils/buildConfig.ts`

## 范围与边界

### 允许修改

- `src/bootstrap/cli-main.ts` 大改：成为 fast-path 分流器。
- 新增 `src/shared/feature-flags.ts`（见 conventions.md）。
- 新增 `src/cli/handlers/`（每个 fast-path 一个 handler 文件）。
- 新增 `src/commands/features.ts`（子命令：`xqoder features`）。
- 修改 `src/cli/program.ts`：挂接 `xqoder features` 与 `xqoder daemon` 等。

### 禁止修改

- 现有 `xqoder chat / config / serve` 子命令行为不变。

## 改动要点

### 1) cli-main 骨架

```ts
// src/bootstrap/cli-main.ts
export async function cliMain(): Promise<void> {
    const args = process.argv.slice(2);

    // Fast-path --version：零 import 之外
    if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
        const { VERSION } = await import('../cli/version.js');
        console.log(`${VERSION} (Xqoder)`);
        return;
    }

    // --provider / --model 早注入 env
    if (args.includes('--provider')) {
        const { applyProviderFlagFromArgs } = await import('../utils/providerFlag.js');
        const err = applyProviderFlagFromArgs(args);
        if (err) { console.error(err); process.exit(1); }
    }

    // enableConfigs
    const { enableConfigs } = await import('../shared/feature-flags.js');
    enableConfigs();

    // --dump-system-prompt
    if (feature('DUMP_SYSTEM_PROMPT') && args[0] === '--dump-system-prompt') {
        const { dumpSystemPrompt } = await import('../cli/handlers/dump-system-prompt.js');
        await dumpSystemPrompt(args);
        return;
    }

    // daemon / remote-control / environment-runner / self-hosted-runner / chrome-*
    const fastHandler = detectFastPath(args);
    if (fastHandler) {
        const mod = await import(`../cli/handlers/${fastHandler}.js`);
        await mod.run(args);
        return;
    }

    // 默认：进主程序
    const { runMain } = await import('./compose.js');
    return runMain(args);
}
```

### 2) `feature()` 运行时

```ts
// src/shared/feature-flags.ts
export const FEATURE_DEFAULTS: Record<string, boolean> = {
    HTTP_WITH_RETRY: true,
    ADVANCED_COMPACTION: true,
    PROMPT_CACHE: true,
    PERMISSION_MODE_V2: true,
    PERMISSION_YOLO_CLASSIFIER: false,
    OPENAI_SHIM: true,
    CODEX_SHIM: false,
    INK_REPL: true,
    DUMP_SYSTEM_PROMPT: true,
    COORDINATOR_MODE: false,
    CRON_TASKS: false,
    BRIDGE_MODE: false,
    DAEMON: false,
    BG_SESSIONS: false,
    WORKFLOW_SCRIPTS: false,
    MONITOR_TOOL: false,
    CHICAGO_MCP: false,
};

let cache: Record<string, boolean> | null = null;

export function feature(name: keyof typeof FEATURE_DEFAULTS | string): boolean {
    if (!cache) cache = loadFeatureFile();
    const env = process.env[`XQODER_FEATURE_${name}`];
    if (env !== undefined) return env === '1' || env === 'true';
    return cache[name] ?? FEATURE_DEFAULTS[name] ?? false;
}

export function enableConfigs() { cache = loadFeatureFile(); }
```

`loadFeatureFile` 读 `~/.xqoder/features.json`（不存在返回空对象）。

### 3) fast-path handler 文件样例

```ts
// src/cli/handlers/dump-system-prompt.ts
export async function run(args: string[]) {
    const { buildSystemPrompt } = await import('../../application/chat/prompt-composer.js');
    const idx = args.indexOf('--model');
    const model = idx !== -1 ? args[idx + 1] : undefined;
    const prompt = await buildSystemPrompt({ model, cwd: process.cwd() });
    console.log(prompt);
}
```

`daemon.ts / bridge.ts` 等按 OpenClaude 对应 fast-path 的语义写（可先空跑
返回 "not implemented in this build"，具体实现留到 phase-25）。

### 4) `xqoder features` 子命令

```ts
// src/commands/features.ts
.command('features')
  .command('ls').action(printFeatureTable)
  .command('enable <name>').action(enableFeature)
  .command('disable <name>').action(disableFeature);
```

`printFeatureTable` 按 flag 名、默认值、当前值、override 来源 4 列。

## 验证

- `bun dist/index.js --version` 时延 `< 30ms`（hyperfine 基准）。
- Feature override 用 `XQODER_FEATURE_PROMPT_CACHE=0` 验证。
- `xqoder features enable INK_REPL && cat ~/.xqoder/features.json`
  确认文件更新。

## 风险与回退

- **风险**：fast-path 分流漏判导致误入 Ink 加载（启动变慢）。
  **缓解**：测试覆盖每个 fast-path；加一条 "所有 fast-path 不 import Ink"
  的自动守卫（通过 `bun build --analyze`）。
- **回退**：`XQODER_FEATURE_DUMP_SYSTEM_PROMPT=0` 关对应 fast-path。

## 不确定项

- `enableConfigs` 在 OpenClaude 里还做了 settings.env apply 等副作用。
  XQoder 等到 Phase 11 集中处理 settings.env；本期只做 feature flag 加载。
