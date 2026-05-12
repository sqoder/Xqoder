# Phase 18 · Plugin 生态

## 任务目标（必须可验证）

实现对齐 OpenClaude 的插件系统：
- 安装 / 卸载 / 启用 / 禁用
- 提供 commands / skills / tools / hooks 注册能力
- 支持 `~/.xqoder/plugins/<name>/`（本地）与 remote npm 安装
- 热加载（无需重启 CLI）

## 对标源

- `openclaude/src/plugins/builtinPlugins.ts`
- `openclaude/src/plugins/bundled/**`
- `openclaude/src/services/plugins/PluginInstallationManager.ts`
- `openclaude/src/services/plugins/pluginOperations.ts`
- `openclaude/src/services/plugins/pluginCliCommands.ts`
- `openclaude/src/state/pluginCommandsStore.ts`
- `openclaude/src/hooks/useManagePlugins.ts`
- `openclaude/src/utils/plugins/**`
- `openclaude/src/commands/plugin/**`
- `openclaude/src/commands/reload-plugins/**`

### 成功判定

- `xqoder plugin install <name>` 从 npm 下载到 `~/.xqoder/plugins/<name>/`。
- 插件 `xqoder.plugin.json` 清单描述：
  ```json
  {
    "name": "my-plugin",
    "entry": "./index.js",
    "provides": {
      "commands": [{"name": "/my-cmd", "file": "./cmd.js"}],
      "tools": [{"name": "my_tool", "file": "./tool.js"}],
      "skills": [{"file": "./my-skill.md"}],
      "hooks": {
        "PreToolUse": [{"command": "./hook.sh"}]
      }
    }
  }
  ```
- 插件 lifecycle：`onActivate(ctx) / onDeactivate(ctx)`。
- `/reload-plugins` 重载无需重启。

## 范围与边界

### 允许修改

- 扩展 `src/plugins/*.ts`（已存在）：
  - `plugin-discovery.ts` 接 `~/.xqoder/plugins/`。
  - `runtime-plugin-loader.ts` 解析 manifest + dynamic import。
- 新增 `src/infra/plugins/installer.ts` (`npm install` wrapper)。
- 新增 `src/commands/plugin/*`：`install / remove / list / enable / disable / reload`。

### 禁止修改

- `ToolRegistry` / `SlashCommandRegistry` 对外签名。

## 改动要点

### 1) PluginManifest

```ts
export interface PluginManifest {
    name: string;
    version: string;
    entry?: string;
    provides?: {
        commands?: Array<{ name: string; file: string }>;
        tools?: Array<{ name: string; file: string }>;
        skills?: Array<{ file: string }>;
        hooks?: Partial<Record<HookEventName, HookHandler[]>>;
    };
    engines?: { xqoder?: string };
}
```

### 2) 加载

```ts
export async function loadPlugin(dir: string, registries: PluginRegistries): Promise<LoadedPlugin> {
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'xqoder.plugin.json'), 'utf8'));
    const entry = manifest.entry ? await import(pathToFileURL(path.join(dir, manifest.entry)).href) : undefined;
    for (const cmd of manifest.provides?.commands ?? []) {
        const mod = await import(pathToFileURL(path.join(dir, cmd.file)).href);
        registries.commands.register(cmd.name, mod.default);
    }
    for (const tool of manifest.provides?.tools ?? []) {
        const mod = await import(pathToFileURL(path.join(dir, tool.file)).href);
        registries.tools.register(new mod.default());
    }
    // skills / hooks 类似
    await entry?.onActivate?.(registries.ctx);
    return { manifest, dir };
}
```

### 3) 卸载 / 禁用

- `unloadPlugin(name)` 触发 `onDeactivate` + registries.unregister 所有该 plugin 注册的对象。
- 禁用 = 不加载，而不是删除文件。

### 4) hot reload

- 监听 `~/.xqoder/plugins/` 目录变化（node `fs.watch`）；
- 某插件目录变动 → `unloadPlugin → loadPlugin`。
- Ctrl+R 触发 `/reload-plugins` 重新加载全部。

## 验证

- Fixture 插件 `test-plugin` 提供一个 `/hello` 命令与一个 `hello_tool` 工具。
- 安装后 `/hello` 可用。
- 禁用后 `/hello` 不可见。
- 重载后新版 `/hello` 输出更新。

## 风险与回退

- **风险**：第三方 plugin 代码在主进程跑，存在安全风险。
  **缓解**：
  - plugin 加载前检查 `xqoder.plugin.json` 完整性；
  - `onActivate` 抛错不影响主进程（try/catch）；
  - 提供 `XQODER_DISABLE_THIRD_PARTY_PLUGINS=1` 关闭全部非 bundled plugin。
- **回退**：`xqoder plugin disable --all`。

## 不确定项

- 是否要做进程级沙箱（worker_thread）。v1 不做；所有 plugin 共享主进程
  （性能、实现成本折中）。
