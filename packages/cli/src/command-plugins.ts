import { Command } from 'commander';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CommandRegistration, Plugin, PluginAPI } from '@xqoder/plugin-sdk';
import { mergePluginPaths } from './plugin-discovery.js';
import { definePlugin } from '@xqoder/plugin-sdk';
import { buildCommand } from './commands/build.js';
import { agentCommand } from './commands/agent.js';
import { authCommand } from './commands/auth.js';
import { chatCommand } from './commands/chat.js';
import { configCommand } from './commands/config.js';
import { fixCommand } from './commands/fix.js';
import { runCommand } from './commands/run.js';
import { startCommand } from './commands/start.js';
import { deployCommand } from './commands/deploy.js';
import { explainCommand } from './commands/explain.js';
import { exportCommand } from './commands/export.js';
import { lspCommand } from './commands/lsp.js';
import { mcpCommand } from './commands/mcp.js';
import { modelsCommand } from './commands/models.js';
import { importCommand } from './commands/import.js';
import { rollbacksCommand } from './commands/rollbacks.js';
import { sessionCommand } from './commands/sessions.js';
import { shareCommand } from './commands/share.js';
import { statsCommand } from './commands/stats.js';
import { testCommand } from './commands/test.js';
import { tuiCommand } from './commands/tui.js';
import { attachCommand } from './commands/attach.js';
import { serveCommand } from './commands/serve.js';
import { webCommand } from './commands/web.js';
import { acpCommand } from './commands/acp.js';
import { githubCommandExport } from './commands/github.js';
import { pluginsCommand } from './commands/plugins.js';
import { uninstallCommand } from './commands/uninstall.js';
import { upgradeCommand } from './commands/upgrade.js';

export interface CommanderCommandRegistration extends CommandRegistration {
    kind: 'commander';
    createCommand: () => Command;
    hiddenFromRoot?: boolean;
}

export interface CommandPluginFactoryOptions {
    chatCommand?: Command;
    tuiCommand?: Command;
}

export interface CommandPluginDiscoveryOptions extends CommandPluginFactoryOptions {
    cwd?: string;
    plugins?: Plugin[];
    pluginConfig?: {
        enabled?: string[];
        disabled?: string[];
        paths?: string[];
        allowIncompatible?: boolean;
    };
    productVersion: string;
    productName?: string;
}

export type CommandPluginLoadStatus = 'loaded' | 'disabled' | 'incompatible' | 'failed';

export interface CommandPluginLoadReportItem {
    name: string;
    source: 'built-in' | 'external' | 'injected';
    status: CommandPluginLoadStatus;
    version?: string;
    reason?: string;
}

export interface CommandPluginDiscoveryResult {
    commands: CommanderCommandRegistration[];
    report: CommandPluginLoadReportItem[];
}

function defineCommanderCommand(command: Command, options: { hiddenFromRoot?: boolean } = {}): CommanderCommandRegistration {
    return {
        name: command.name(),
        description: command.description(),
        aliases: command.aliases(),
        kind: 'commander',
        createCommand: () => command,
        hiddenFromRoot: options.hiddenFromRoot ?? true,
        run: async () => {},
    };
}

function createBuiltInCommandPlugins(options: CommandPluginFactoryOptions = {}): Plugin[] {
    return [
        definePlugin({
            manifest: {
                name: 'cli-core-shell',
                version: '0.1.0',
                capabilities: ['commands'],
                enabledByDefault: true,
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                [
                    configCommand,
                    authCommand,
                    modelsCommand,
                    agentCommand,
                    attachCommand,
                    sessionCommand,
                    statsCommand,
                    exportCommand,
                    importCommand,
                    shareCommand,
                    options.chatCommand ?? chatCommand,
                    options.tuiCommand ?? tuiCommand,
                ].forEach((command) => api.registerCommand(defineCommanderCommand(command)));
            },
        }),
        definePlugin({
            manifest: {
                name: 'cli-workflows',
                version: '0.1.0',
                capabilities: ['commands'],
                enabledByDefault: true,
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                [buildCommand, fixCommand, runCommand, startCommand, testCommand, deployCommand]
                    .forEach((command) => api.registerCommand(defineCommanderCommand(command)));
            },
        }),
        definePlugin({
            manifest: {
                name: 'cli-integrations',
                version: '0.1.0',
                capabilities: ['commands'],
                enabledByDefault: true,
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                [explainCommand, lspCommand, mcpCommand, rollbacksCommand, serveCommand, webCommand, acpCommand, githubCommandExport]
                    .forEach((command) => api.registerCommand(defineCommanderCommand(command)));
            },
        }),
        definePlugin({
            manifest: {
                name: 'cli-system',
                version: '0.1.0',
                capabilities: ['commands'],
                enabledByDefault: true,
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                [pluginsCommand, uninstallCommand, upgradeCommand].forEach((command) => api.registerCommand(defineCommanderCommand(command)));
            },
        }),
    ];
}

export function getBuiltInCommandPlugins(options: CommandPluginFactoryOptions = {}): Plugin[] {
    return createBuiltInCommandPlugins(options);
}

function parseMajor(version: string): number | null {
    const match = version.match(/^(\d+)\./);
    return match ? Number.parseInt(match[1] ?? '0', 10) : null;
}

function isCompatibleVersion(range: string | undefined, version: string): boolean {
    if (!range || range === '*' || range === 'latest') {
        return true;
    }

    if (range.startsWith('^')) {
        return parseMajor(range.slice(1)) === parseMajor(version);
    }

    return range === version;
}

function shouldEnablePlugin(plugin: Plugin, options: CommandPluginDiscoveryOptions): boolean {
    const enabled = new Set(options.pluginConfig?.enabled ?? []);
    const disabled = new Set(options.pluginConfig?.disabled ?? []);
    const name = plugin.manifest.name;

    if (disabled.has(name)) {
        return false;
    }

    if (enabled.size > 0) {
        return enabled.has(name);
    }

    return plugin.manifest.enabledByDefault !== false;
}

function isCompatiblePlugin(plugin: Plugin, options: CommandPluginDiscoveryOptions): boolean {
    if (options.pluginConfig?.allowIncompatible) {
        return true;
    }

    const compatibility = plugin.manifest.compatibility;
    if (compatibility?.product && compatibility.product !== (options.productName ?? 'xqoder')) {
        return false;
    }

    return isCompatibleVersion(compatibility?.versionRange, options.productVersion);
}

class CommandCollector implements PluginAPI {
    readonly commands: CommanderCommandRegistration[] = [];

    registerCommand(command: CommandRegistration): void {
        if ('kind' in command && command.kind === 'commander' && 'createCommand' in command) {
            this.commands.push(command as CommanderCommandRegistration);
        }
    }

    registerModelProvider(): void {}
    registerAgentProvider(): void {}
    registerToolProvider(): void {}
    registerSyncProvider(): void {}
    registerAuthProvider(): void {}
    extendConfig(): void {}
    onEvent(): void {}
}

async function importPluginModule(modulePath: string, cwd: string | undefined): Promise<Plugin | null> {
    const resolvedPath = modulePath.startsWith('.')
        ? path.resolve(cwd ?? process.cwd(), modulePath)
        : modulePath;
    const specifier = resolvedPath.startsWith('/') ? pathToFileURL(resolvedPath).href : resolvedPath;
    const loaded = await import(specifier);
    const plugin = (loaded.default ?? loaded.plugin) as Plugin | undefined;
    return plugin ?? null;
}

function buildReportItem(plugin: Plugin, source: CommandPluginLoadReportItem['source'], status: CommandPluginLoadStatus, reason?: string): CommandPluginLoadReportItem {
    return {
        name: plugin.manifest.name,
        source,
        status,
        version: plugin.manifest.version,
        ...(reason ? { reason } : {}),
    };
}

export async function discoverCommandRegistrationsWithReport(
    options: CommandPluginDiscoveryOptions,
): Promise<CommandPluginDiscoveryResult> {
    const discoveredPlugins: Array<{ plugin: Plugin; source: CommandPluginLoadReportItem['source'] }> = [
        ...getBuiltInCommandPlugins(options).map((plugin) => ({ plugin, source: 'built-in' as const })),
        ...(options.plugins ?? []).map((plugin) => ({ plugin, source: 'injected' as const })),
    ];
    const report: CommandPluginLoadReportItem[] = [];

    const pluginPaths = mergePluginPaths(options.pluginConfig?.paths, options.cwd);
    for (const pluginPath of pluginPaths) {
        try {
            const plugin = await importPluginModule(pluginPath, options.cwd);
            if (!plugin) {
                report.push({
                    name: pluginPath,
                    source: 'external',
                    status: 'failed',
                    reason: 'Module did not export a plugin',
                });
                continue;
            }
            discoveredPlugins.push({ plugin, source: 'external' });
        } catch (error) {
            report.push({
                name: pluginPath,
                source: 'external',
                status: 'failed',
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const collector = new CommandCollector();
    for (const { plugin, source } of discoveredPlugins) {
        if (!shouldEnablePlugin(plugin, options)) {
            report.push(buildReportItem(plugin, source, 'disabled', 'Disabled by plugin configuration'));
            continue;
        }
        if (!isCompatiblePlugin(plugin, options)) {
            report.push(buildReportItem(plugin, source, 'incompatible', 'Plugin compatibility range does not match current product version'));
            continue;
        }

        try {
            await plugin.setup(collector);
            report.push(buildReportItem(plugin, source, 'loaded'));
        } catch (error) {
            report.push(buildReportItem(plugin, source, 'failed', error instanceof Error ? error.message : String(error)));
        }
    }

    return {
        commands: collector.commands,
        report,
    };
}

export async function discoverCommandRegistrations(
    options: CommandPluginDiscoveryOptions,
): Promise<CommanderCommandRegistration[]> {
    const result = await discoverCommandRegistrationsWithReport(options);
    return result.commands;
}

export function getBuiltInCommandRegistrations(options: CommandPluginFactoryOptions = {}): CommanderCommandRegistration[] {
    const collector = new CommandCollector();
    for (const plugin of getBuiltInCommandPlugins(options)) {
        plugin.setup(collector);
    }
    return collector.commands;
}
