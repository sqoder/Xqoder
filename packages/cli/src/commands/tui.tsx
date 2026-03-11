// ============================================================
// xqoder tui — 交互式终端界面
// ============================================================

import * as path from 'node:path';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { configManager, logger, LogLevel, resolveConfigWithEnvOverrides, installPanicHandler, type SandboxMode } from '@xqoder/shared';
import { XQoderTuiSafe } from '../tui/app.js';
import { installSafeTtyGuards, isIgnorableTtyStreamError } from '../tui/safe-tty.js';
import { installSafeRuntimeGuards } from '../tui/safe-runtime.js';
import { runTerminalApp } from '../terminal-app/run-terminal-app.js';

export interface TuiCommandOptions {
    dir?: string;
    model?: string;
    agent?: string;
    scope?: string;
    sandboxMode?: SandboxMode;
    continue?: boolean;
    session?: string;
    fork?: boolean;
    prompt?: string;
    port?: number;
    hostname?: string;
    experimentalCore?: boolean;
    legacyInk?: boolean;
}

interface TuiCommandDependencies {
    runTuiCommand?: (options: TuiCommandOptions) => Promise<void>;
}

interface InkInstanceLike {
    waitUntilExit: () => Promise<unknown>;
    unmount?: () => void;
}

type SignalName = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

interface SignalHostLike {
    on: (event: SignalName, listener: () => void) => unknown;
    off: (event: SignalName, listener: () => void) => unknown;
}

interface LifecycleStreamLike {
    on: (event: string, listener: (...args: unknown[]) => void) => unknown;
    off: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

interface TuiRuntimeDependencies {
    renderApp?: typeof render;
    runTerminalApp?: typeof runTerminalApp;
    installPanicHandler?: typeof installPanicHandler;
    installSafeTtyGuards?: typeof installSafeTtyGuards;
    installSafeRuntimeGuards?: typeof installSafeRuntimeGuards;
    resolveInitialSettings?: (options: TuiCommandOptions) => TuiCommandOptions & {
        dir: string;
        model: string;
        agent: string;
        sandboxMode: SandboxMode;
    };
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
    stderr?: NodeJS.WriteStream;
    signalHost?: SignalHostLike;
    clear?: () => void;
    wait?: (ms: number) => Promise<void>;
    maxUnexpectedRestarts?: number;
    restartDelayMs?: number;
}

function installLifecycleGuards(params: {
    signalHost: SignalHostLike;
    stdin: LifecycleStreamLike;
    stdout: LifecycleStreamLike;
    stderr: LifecycleStreamLike;
    onDisconnect: (reason: string) => void;
}): () => void {
    const { signalHost, stdin, stdout, stderr, onDisconnect } = params;
    const cleanup: Array<() => void> = [];

    const addSignalListener = (
        event: SignalName,
        listener: () => void,
    ): void => {
        try {
            signalHost.on(event, listener);
            cleanup.push(() => {
                try {
                    signalHost.off(event, listener);
                } catch {
                    // ignore cleanup errors
                }
            });
        } catch {
            // ignore unsupported hosts
        }
    };

    const addStreamListener = (
        target: LifecycleStreamLike,
        event: string,
        listener: (...args: unknown[]) => void,
    ): void => {
        try {
            target.on(event, listener);
            cleanup.push(() => {
                try {
                    target.off(event, listener);
                } catch {
                    // ignore cleanup errors
                }
            });
        } catch {
            // ignore unsupported hosts
        }
    };

    const onSigint = () => onDisconnect('signal SIGINT');
    const onSigterm = () => onDisconnect('signal SIGTERM');
    const onSighup = () => onDisconnect('signal SIGHUP');
    addSignalListener('SIGINT', onSigint);
    addSignalListener('SIGTERM', onSigterm);
    addSignalListener('SIGHUP', onSighup);

    addStreamListener(stdin, 'close', () => onDisconnect('stdin close'));
    addStreamListener(stdin, 'end', () => onDisconnect('stdin end'));
    addStreamListener(stdout, 'close', () => onDisconnect('stdout close'));
    addStreamListener(stderr, 'close', () => onDisconnect('stderr close'));

    return () => {
        for (const restore of cleanup.reverse()) {
            restore();
        }
    };
}

function safeWrite(stream: NodeJS.WriteStream, message: string): void {
    try {
        if (stream.writable !== false) {
            stream.write(message);
        }
    } catch {
        // ignore broken TTY writes
    }
}

function enterAlternateScreen(stream: NodeJS.WriteStream): void {
    safeWrite(stream, '\x1b[?1049h\x1b[2J\x1b[H');
}

function leaveAlternateScreen(stream: NodeJS.WriteStream): void {
    safeWrite(stream, '\x1b[?1049l');
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
        return {
            ...options,
            dir: resolvedDir,
            model: options.model ?? config.llm.model,
            agent: options.agent ?? config.defaultAgent ?? 'general',
            scope: options.scope ?? config.vercel?.scope,
            sandboxMode: options.sandboxMode ?? config.sandbox?.mode ?? 'project',
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
        };
    }
}

export async function runTuiCommand(
    options: TuiCommandOptions = {},
    dependencies: TuiRuntimeDependencies = {},
): Promise<void> {
    // TUI mode: log panics but do NOT exit — Ink/React must stay alive
    (dependencies.installPanicHandler ?? installPanicHandler)({ name: 'tui', exitOnPanic: false });

    const stdin = dependencies.stdin ?? process.stdin;
    const stdout = dependencies.stdout ?? process.stdout;
    const stderr = dependencies.stderr ?? process.stderr;
    const signalHost = dependencies.signalHost ?? process;
    const renderApp = dependencies.renderApp ?? render;
    const runTerminalCoreApp = dependencies.runTerminalApp ?? runTerminalApp;
    const wait = dependencies.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const maxUnexpectedRestarts = dependencies.maxUnexpectedRestarts ?? 3;
    const restartDelayMs = dependencies.restartDelayMs ?? 150;

    // Ensure all I/O streams are error-resilient.
    // index.ts installs handlers very early, but this is a safety net for
    // cases where runTuiCommand is imported and called directly.
    try { stdin.on('error', () => {}); } catch { /* ignore */ }
    try { stdout.on('error', () => {}); } catch { /* ignore */ }
    try { stderr.on('error', () => {}); } catch { /* ignore */ }

    // Ink requires a TTY stdin with raw mode support.
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

    if ((options.experimentalCore || !options.legacyInk) && process.env['XQODER_LEGACY_INK'] !== '1') {
        await runTerminalCoreApp(initialSettings, { stdin, stdout, stderr });
        return;
    }

    // Suppress global logger — Ink owns stdout.
    logger.setLevel(LogLevel.Silent);

    try {
        if (stdout.isTTY) {
            (dependencies.clear ?? console.clear)();
        }
    } catch { /* ignore */ }

    const restoreSafeTtyGuards = (dependencies.installSafeTtyGuards ?? installSafeTtyGuards)({
        stdin: stdin as never,
        stdout: stdout as never,
        stderr: stderr as never,
    });
    const restoreSafeRuntimeGuards = (dependencies.installSafeRuntimeGuards ?? installSafeRuntimeGuards)();

    try {
        let unexpectedExitCount = 0;
        let exitRequested = false;
        let activeInstance: InkInstanceLike | null = null;
        const requestLifecycleExit = (reason: string): void => {
            if (exitRequested) return;
            exitRequested = true;
            safeWrite(stderr, `[XQoder] TTY lifecycle event: ${reason}, shutting down safely.\n`);
            try {
                activeInstance?.unmount?.();
            } catch {
                // ignore unmount errors while tearing down
            }
        };
        const restoreLifecycleGuards = installLifecycleGuards({
            signalHost,
            stdin: stdin as unknown as LifecycleStreamLike,
            stdout: stdout as unknown as LifecycleStreamLike,
            stderr: stderr as unknown as LifecycleStreamLike,
            onDisconnect: requestLifecycleExit,
        });

        try {
            while (true) {
                let instance: InkInstanceLike;
                try {
                    enterAlternateScreen(stdout);
                    instance = renderApp(
                        React.createElement(XQoderTuiSafe, {
                            initialSettings,
                            onRequestExit: () => {
                                exitRequested = true;
                            },
                        }),
                        {
                            exitOnCtrlC: false,
                            stdin,
                            stdout,
                            incrementalRendering: true,
                            maxFps: 20,
                        },
                    );
                    activeInstance = instance;
                } catch (err) {
                    leaveAlternateScreen(stdout);
                    safeWrite(stderr, `[XQoder] Failed to start TUI: ${err instanceof Error ? err.message : String(err)}\n`);
                    return;
                }

                try {
                    await instance.waitUntilExit();
                } catch (err) {
                    if (isIgnorableTtyStreamError(err)) {
                        requestLifecycleExit('runtime tty stream error');
                    } else {
                        safeWrite(stderr, `[XQoder] TUI runtime error: ${err instanceof Error ? err.message : String(err)}\n`);
                    }
                } finally {
                    leaveAlternateScreen(stdout);
                    activeInstance = null;
                }

                if (exitRequested) {
                    return;
                }

                unexpectedExitCount += 1;
                safeWrite(stderr, `[XQoder] TUI exited unexpectedly; restarting (${unexpectedExitCount}/${maxUnexpectedRestarts})...\n`);

                if (unexpectedExitCount > maxUnexpectedRestarts) {
                    safeWrite(stderr, '[XQoder] TUI exited unexpectedly too many times; stopping.\n');
                    return;
                }

                try { stdin.resume?.(); } catch { /* ignore */ }
                await wait(restartDelayMs);
            }
        } finally {
            restoreLifecycleGuards();
        }
    } finally {
        restoreSafeRuntimeGuards();
        restoreSafeTtyGuards();
    }
}

export function createTuiCommand(
    dependencies: TuiCommandDependencies = {},
): Command {
    return new Command('tui')
        .description('启动交互式终端 UI（OpenCode 风格）')
        .option('-c, --continue', '继续上次 session')
        .option('-s, --session <id>', '指定 session ID 继续')
        .option('--fork', 'fork session 后继续')
        .option('--prompt <text>', '启动时发送的 prompt')
        .option('-p, --port <port>', '端口（attach 模式）', parseInt)
        .option('--hostname <host>', '主机名（attach 模式）')
        .option('-d, --dir <dir>', '初始项目目录')
        .option('-m, --model <model>', '初始模型')
        .option('-a, --agent <name>', '初始 agent')
        .option('--experimental-core', '兼容旧参数：启动新的非 Ink terminal-core')
        .option('--legacy-ink', '使用旧的 Ink 渲染路径（迁移过渡期）')
        .option('--scope <scope>', '初始 Vercel scope')
        .option('--sandbox-mode <mode>', '初始 sandbox 模式 (project/paths/full-access)')
        .action(async (options: TuiCommandOptions) => {
            try {
                await (dependencies.runTuiCommand ?? runTuiCommand)(options);
            } catch (err) {
                try {
                    process.stderr.write(`[XQoder] TUI error: ${err instanceof Error ? err.message : String(err)}\n`);
                } catch { /* ignore */ }
            }
        });
}

export const tuiCommand = createTuiCommand();
