// ============================================================
// xqoder tui — terminal-core only
// ============================================================

import * as path from 'node:path';
import { Command } from 'commander';
import { configManager, logger, resolveConfigWithEnvOverrides, installPanicHandler, type SandboxMode } from '@xqoder/shared';
import { runTerminalApp } from '../terminal-app/run-terminal-app.js';
import { resolveEnabledPluginNames } from '../command-plugins.js';

export interface TuiCommandOptions {
    dir?: string;
    model?: string;
    agent?: string;
    scope?: string;
    sandboxMode?: SandboxMode;
    enabledPlugins?: string[];
    continue?: boolean;
    session?: string;
    fork?: boolean;
    prompt?: string;
    port?: number;
    hostname?: string;
    /** 连接远程 serve（attach 模式） */
    attachBaseUrl?: string;
}

interface TuiCommandDependencies {
    runTuiCommand?: (options: TuiCommandOptions) => Promise<void>;
}

interface TuiRuntimeDependencies {
    runTerminalApp?: typeof runTerminalApp;
    installPanicHandler?: typeof installPanicHandler;
    resolveInitialSettings?: (options: TuiCommandOptions) => TuiCommandOptions & {
        dir: string;
        model: string;
        agent: string;
        sandboxMode: SandboxMode;
        enabledPlugins?: string[];
    };
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
    stderr?: NodeJS.WriteStream;
}

function resolveInitialSettings(options: TuiCommandOptions): TuiCommandOptions & {
    dir: string;
    model: string;
    agent: string;
    sandboxMode: SandboxMode;
} {
    const resolvedDir = path.resolve(options.dir ?? process.cwd());

    try {
        const { config } = resolveConfigWithEnvOverrides(configManager.load({ cwd: resolvedDir }));
        const enabledPlugins = Array.from(resolveEnabledPluginNames(config.plugins));
        return {
            ...options,
            dir: resolvedDir,
            model: options.model ?? config.llm.model,
            agent: options.agent ?? config.defaultAgent ?? 'general',
            scope: options.scope ?? config.vercel?.scope,
            sandboxMode: options.sandboxMode ?? config.sandbox?.mode ?? 'project',
            enabledPlugins,
            ...(options.session ? { initialSessionId: options.session } : undefined),
            ...(options.continue && !options.session ? { initialSessionId: 'latest' } : undefined),
            ...(options.prompt ? { initialPrompt: options.prompt } : undefined),
        };
    } catch (err) {
        logger.error(`配置加载失败: ${err instanceof Error ? err.message : String(err)}`);
        return {
            ...options,
            dir: resolvedDir,
            model: 'qwen-plus',
            agent: 'general',
            sandboxMode: 'project',
            enabledPlugins: Array.from(resolveEnabledPluginNames()),
        };
    }
}

export async function runTuiCommand(
    options: TuiCommandOptions = {},
    dependencies: TuiRuntimeDependencies = {},
): Promise<void> {
    (dependencies.installPanicHandler ?? installPanicHandler)({ name: 'tui', exitOnPanic: false });

    const stdin = dependencies.stdin ?? process.stdin;
    const stdout = dependencies.stdout ?? process.stdout;
    const stderr = dependencies.stderr ?? process.stderr;
    const runTerminalCoreApp = dependencies.runTerminalApp ?? runTerminalApp;

    try { stdin.on('error', () => {}); } catch { /* ignore */ }
    try { stdout.on('error', () => {}); } catch { /* ignore */ }
    try { stderr.on('error', () => {}); } catch { /* ignore */ }

    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
        logger.error(
            'TUI 需要交互式终端 (TTY)。\n' +
            '  请直接运行: node scripts/xqoder.mjs tui\n' +
            '  或者确保终端支持 raw mode（不要通过管道/重定向启动）',
        );
        return;
    }

    try { stdin.resume?.(); } catch { /* ignore */ }

    const initialSettings = (dependencies.resolveInitialSettings ?? resolveInitialSettings)(options);
    await runTerminalCoreApp(initialSettings, { stdin, stdout, stderr });
}

export function createTuiCommand(
    dependencies: TuiCommandDependencies = {},
): Command {
    return new Command('tui')
        .description('启动交互式终端 UI（terminal-core）')
        .option('-c, --continue', '继续上次 session')
        .option('-s, --session <id>', '指定 session ID 继续')
        .option('--fork', 'fork session 后继续')
        .option('--prompt <text>', '启动时发送的 prompt')
        .option('-p, --port <port>', '端口（attach 模式）', parseInt)
        .option('--hostname <host>', '主机名（attach 模式）')
        .option('-d, --dir <dir>', '初始项目目录')
        .option('-m, --model <model>', '初始模型')
        .option('-a, --agent <name>', '初始 agent')
        .option('--scope <scope>', '初始 Vercel scope')
        .option('--sandbox-mode <mode>', '初始 sandbox 模式 (project/paths/full-access)')
        .action(async (options: TuiCommandOptions) => {
            try {
                await (dependencies.runTuiCommand ?? runTuiCommand)(options);
            } catch (err) {
                try {
                    process.stderr.write(`[XQoder] TUI error: ${err instanceof Error ? err.message : String(err)}\n`);
                } catch {
                    // ignore stderr failures
                }
            }
        });
}

export const tuiCommand = createTuiCommand();
