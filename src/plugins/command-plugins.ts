import { Command } from 'commander';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CommandRegistration, Plugin, PluginAPI } from '@xqoder/plugin-sdk';
import { mergePluginPaths } from './plugin-discovery.js';
import { definePlugin } from '@xqoder/plugin-sdk';
import { buildCommand } from '../commands/build.js';
import { agentCommand } from '../commands/core/agent.js';
import { authCommand as loginCommand } from '../commands/core/auth.js';
import { chatCommand } from '../commands/core/chat.js';
import { configCommand } from '../commands/core/config.js';
import { costCommand } from '../commands/core/cost.js';
import { outputStyleCommand } from '../commands/core/output-style.js';
import { skillsCommand } from '../commands/core/skills.js';
import { effortCommand, fastCommand, thinkCommand } from '../commands/core/thinking.js';
import { authCommand } from '../commands/auth/index.js';
import { fixCommand } from '../commands/fix.js';
import { runCommand } from '../commands/workflows/run.js';
import { startCommand } from '../commands/workflows/start.js';
import { deployCommand } from '../commands/workflows/deploy.js';
import {
    agentsEntryCommand,
    automationCommand,
    planCommand,
    reviewCommand,
} from '../commands/workflows/unified-entry.js';
import { explainCommand } from '../commands/tools/explain.js';
import { exportCommand } from '../commands/sessions/export.js';
import { modelsCommand } from '../commands/core/models.js';
import { importCommand } from '../commands/sessions/import.js';
import { sessionCommand } from '../commands/sessions/sessions.js';
import { shareCommand } from '../commands/sessions/share.js';
import { statsCommand } from '../commands/sessions/stats.js';
import { testCommand } from '../commands/workflows/test.js';
import { tuiInterfaceCommand as tuiCommand } from '../interfaces/tui/index.js';
import { githubCommandExport } from '../commands/tools/github.js';
import { createMemoryCommand } from '../commands/system/memory.js';
import { createHooksCommand } from '../commands/system/hooks.js';
import { createFeaturesCommand } from '../commands/system/features.js';
import { createMcpCommand } from '../commands/integrations/mcp.js';
import { createServeCommand } from '../commands/remote/serve.js';
import { teamCommand } from '../commands/workflows/team.js';
import { ideCommand } from '../commands/system/ide.js';
import { permissionsCommand } from '../commands/system/permissions.js';
import { pluginsCommand } from '../commands/system/plugins.js';
import { uninstallCommand } from '../commands/system/uninstall.js';
import { upgradeCommand } from '../commands/system/upgrade.js';

export interface CommanderCommandRegistration extends CommandRegistration {
    kind: 'commander';
    createCommand: () => Command;
    hiddenFromRoot?: boolean;
}

const BUILT_IN_PLUGIN_DEFAULTS = {
    'cli-core-shell': true,
    'cli-workflows': true,
    'cli-extras': true,
    'cli-system': true,
    'cli-remote': false,
} as const;

type BuiltInPluginName = keyof typeof BUILT_IN_PLUGIN_DEFAULTS;

export interface CommandPluginFactoryOptions {
    chatCommand?: Command;
    tuiCommand?: Command;
}

export function defineCommanderCommand(command: Command, options: { hiddenFromRoot?: boolean } = {}): CommanderCommandRegistration {
    return {
        name: command.name(),
        description: command.description(),
        aliases: command.aliases(),
        kind: 'commander',
        createCommand: () => command,
        hiddenFromRoot: options.hiddenFromRoot ?? false,
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
                enabledByDefault: BUILT_IN_PLUGIN_DEFAULTS['cli-core-shell'],
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                [
                    configCommand,
                    costCommand,
                    thinkCommand,
                    effortCommand,
                    fastCommand,
                    authCommand,
                    loginCommand,
                    modelsCommand,
                    agentCommand,
                    sessionCommand,
                    statsCommand,
                    exportCommand,
                    importCommand,
                    shareCommand,
                    permissionsCommand,
                    skillsCommand,
                    outputStyleCommand,
                    options.chatCommand ?? chatCommand,
                    options.tuiCommand ?? tuiCommand,
                ].forEach((command) => api.registerCommand(defineCommanderCommand(command)));
                api.registerCommand(defineCommanderCommand(agentsEntryCommand, { hiddenFromRoot: false }));
            },
        }),
        definePlugin({
            manifest: {
                name: 'cli-workflows',
                version: '0.1.0',
                capabilities: ['commands'],
                enabledByDefault: BUILT_IN_PLUGIN_DEFAULTS['cli-workflows'],
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                [buildCommand, fixCommand, runCommand, startCommand, testCommand, deployCommand, teamCommand]
                    .forEach((command) => api.registerCommand(defineCommanderCommand(command)));
                [planCommand, reviewCommand, automationCommand]
                    .forEach((command) => api.registerCommand(defineCommanderCommand(command, { hiddenFromRoot: false })));
            },
        }),
        definePlugin({
            manifest: {
                name: 'cli-extras',
                version: '0.1.0',
                capabilities: ['commands'],
                enabledByDefault: BUILT_IN_PLUGIN_DEFAULTS['cli-extras'],
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                [explainCommand, githubCommandExport]
                    .forEach((command) => api.registerCommand(defineCommanderCommand(command)));
            },
        }),
        definePlugin({
            manifest: {
                name: 'cli-system',
                version: '0.1.0',
                capabilities: ['commands'],
                enabledByDefault: BUILT_IN_PLUGIN_DEFAULTS['cli-system'],
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                [
                    pluginsCommand,
                    uninstallCommand,
                    upgradeCommand,
                    createMemoryCommand(),
                    createHooksCommand(),
                    createFeaturesCommand(),
                    ideCommand,
                    createServeCommand(),
                ].forEach((command) => api.registerCommand(defineCommanderCommand(command)));
            },
        }),
        definePlugin({
            manifest: {
                name: 'cli-remote',
                version: '0.1.0',
                capabilities: ['commands'],
                enabledByDefault: BUILT_IN_PLUGIN_DEFAULTS['cli-remote'],
                compatibility: { product: 'xqoder', versionRange: '^0.1.0' },
            },
            setup(api) {
                [createServeCommand()].forEach((command) => api.registerCommand(defineCommanderCommand(command)));
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
                [createMcpCommand()].forEach((command) => api.registerCommand(defineCommanderCommand(command)));
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

export function resolveEnabledPluginNames(
    pluginConfig?: { enabled?: string[]; disabled?: string[] },
): Set<string> {
    const enabled = new Set(pluginConfig?.enabled ?? []);
    const disabled = new Set(pluginConfig?.disabled ?? []);
    const resolved = new Set<string>();

    const applyDefault = (name: BuiltInPluginName): void => {
        if (disabled.has(name)) {
            return;
        }
        if (enabled.size > 0) {
            if (enabled.has(name)) {
                resolved.add(name);
            }
            return;
        }
        if (BUILT_IN_PLUGIN_DEFAULTS[name]) {
            resolved.add(name);
        }
    };

    (Object.keys(BUILT_IN_PLUGIN_DEFAULTS) as BuiltInPluginName[]).forEach(applyDefault);

    for (const name of enabled) {
        if (!disabled.has(name)) {
            resolved.add(name);
        }
    }

    return resolved;
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
    private readonly commandNames = new Set<string>();

    registerCommand(command: CommandRegistration): void {
        if ('kind' in command && command.kind === 'commander' && 'createCommand' in command) {
            const registration = command as CommanderCommandRegistration;
            const commandNames = [registration.name, ...(registration.aliases ?? [])];
            if (commandNames.some((name) => this.commandNames.has(name))) {
                return;
            }
            commandNames.forEach((name) => this.commandNames.add(name));
            this.commands.push(registration);
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
        if (plugin.manifest.enabledByDefault === false) {
            continue;
        }
        plugin.setup(collector);
    }
    return collector.commands;
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
