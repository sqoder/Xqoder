import * as path from 'node:path';
import { Command } from 'commander';
import {
    configManager,
    installPanicHandler,
    logger,
    resolveConfigWithEnvOverrides,
    type SandboxMode,
} from '@xqoder/shared';
import { runTerminalApp } from '../../platform/terminal/app/run-terminal-app.js';
import { resolveEnabledPluginNames } from '../../plugins/command-plugins.js';

export interface TuiInterfaceOptions {
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
    attachBaseUrl?: string;
}

interface TuiCommandDependencies {
    runTuiCommand?: (options: TuiInterfaceOptions) => Promise<void>;
}

interface TuiRuntimeDependencies {
    runTerminalApp?: typeof runTerminalApp;
    installPanicHandler?: typeof installPanicHandler;
    resolveInitialSettings?: (options: TuiInterfaceOptions) => TuiInterfaceOptions & {
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

function resolveInitialSettings(options: TuiInterfaceOptions): TuiInterfaceOptions & {
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
        logger.error(`Failed to load configuration: ${err instanceof Error ? err.message : String(err)}`);
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

export async function runTuiInterface(
    options: TuiInterfaceOptions = {},
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
            'TUI requires an interactive terminal (TTY).\n' +
            '  Please run directly: bun dist/index.js tui\n' +
            '  Or ensure terminal supports raw mode (do not start via pipes/redirection)',
        );
        return;
    }

    try { stdin.resume?.(); } catch { /* ignore */ }

    const initialSettings = (dependencies.resolveInitialSettings ?? resolveInitialSettings)(options);
    await runTerminalCoreApp(initialSettings, { stdin, stdout, stderr });
}

export function createTuiInterfaceCommand(
    dependencies: TuiCommandDependencies = {},
): Command {
    return new Command('tui')
        .description('Start interactive Terminal shell')
        .option('-c, --continue', 'Continue the last session')
        .option('-s, --session <id>', 'Specify session ID to continue')
        .option('--fork', 'Fork session before continuing')
        .option('--prompt <text>', 'Initial prompt to send on startup')
        .option('-p, --port <port>', 'Port (attach mode)', parseInt)
        .option('--hostname <host>', 'Hostname (attach mode)')
        .option('-d, --dir <dir>', 'Initial project directory')
        .option('-m, --model <model>', 'Initial model')
        .option('-a, --agent <name>', 'Initial agent')
        .option('--scope <scope>', 'Initial Vercel scope')
        .option('--sandbox-mode <mode>', 'Initial sandbox mode (project/paths/full-access)')
        .action(async (options: TuiInterfaceOptions) => {
            try {
                await (dependencies.runTuiCommand ?? runTuiInterface)(options);
            } catch (err) {
                try {
                    process.stderr.write(`[XQoder] TUI error: ${err instanceof Error ? err.message : String(err)}\n`);
                } catch {
                    // ignore stderr failures
                }
            }
        });
}

export const tuiInterfaceCommand = createTuiInterfaceCommand();
