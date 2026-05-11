import { Command } from 'commander';
import { ConfigManager, type XQoderConfig } from '@xqoder/shared';
import { getXQoderVersion } from '../../cli/version.js';
import { discoverCommandRegistrationsWithReport, type CommandPluginDiscoveryResult } from '../../plugins/command-plugins.js';
import {
    installLocalPlugin,
    isPluginEnabled,
    listInstalledPlugins,
    removeInstalledPlugin,
    resolvePluginsHome,
    setPluginEnabled,
    type InstalledPlugin,
} from '../../infra/plugins/index.js';

interface PluginsListOptions {
    json?: boolean;
    cwd?: string;
}

interface PluginsCommandDependencies {
    configManager?: Pick<ConfigManager, 'load'>;
    discover?: (options: {
        cwd?: string;
        pluginConfig?: XQoderConfig['plugins'];
        productVersion: string;
        productName?: string;
    }) => Promise<CommandPluginDiscoveryResult>;
    writeOutput?: (output: string) => void;
    writeError?: (output: string) => void;
}

function writeOutput(text: string, dependencies: PluginsCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(text);
}

function writeError(text: string, dependencies: PluginsCommandDependencies): void {
    (dependencies.writeError ?? console.error)(text);
}

function formatInstalledRow(plugin: InstalledPlugin): string {
    const enabled = isPluginEnabled(plugin.name);
    return [
        plugin.name,
        `status=installed${enabled ? '' : ' (disabled)'}`,
        'source=installed',
        `version=${plugin.version}`,
        `dir=${plugin.dir}`,
    ].join(' ');
}

export async function runListPluginsCommand(
    options: PluginsListOptions,
    dependencies: PluginsCommandDependencies = {},
): Promise<CommandPluginDiscoveryResult> {
    const manager = dependencies.configManager ?? new ConfigManager();
    const config = manager.load({ cwd: options.cwd });
    const result = await (dependencies.discover ?? discoverCommandRegistrationsWithReport)({
        cwd: options.cwd,
        pluginConfig: config.plugins,
        productVersion: getXQoderVersion(),
        productName: 'xqoder',
    });

    const installed = listInstalledPlugins();

    if (options.json) {
        writeOutput(JSON.stringify({
            ...result,
            installed: installed.map((plugin) => ({
                name: plugin.name,
                version: plugin.version,
                dir: plugin.dir,
                enabled: isPluginEnabled(plugin.name),
            })),
        }, null, 2), dependencies);
        return result;
    }

    for (const item of result.report) {
        const parts = [
            item.name,
            `status=${item.status}`,
            `source=${item.source}`,
            ...(item.version ? [`version=${item.version}`] : []),
            ...(item.reason ? [`reason=${item.reason}`] : []),
        ];
        writeOutput(parts.join(' '), dependencies);
    }

    for (const plugin of installed) {
        writeOutput(formatInstalledRow(plugin), dependencies);
    }

    return result;
}

export interface PluginInstallOptions {
    readonly source: string;
    readonly force?: boolean;
    readonly json?: boolean;
}

export async function runInstallPluginCommand(
    options: PluginInstallOptions,
    dependencies: PluginsCommandDependencies = {},
): Promise<InstalledPlugin> {
    const installed = await installLocalPlugin(options.source, { force: options.force ?? false });
    if (options.json) {
        writeOutput(JSON.stringify(installed, null, 2), dependencies);
    } else {
        writeOutput(
            `installed ${installed.name}@${installed.version} → ${installed.dir}`,
            dependencies,
        );
    }
    return installed;
}

export interface PluginRemoveOptions {
    readonly name: string;
    readonly json?: boolean;
}

export function runRemovePluginCommand(
    options: PluginRemoveOptions,
    dependencies: PluginsCommandDependencies = {},
): void {
    removeInstalledPlugin(options.name);
    if (options.json) {
        writeOutput(JSON.stringify({ removed: options.name }), dependencies);
    } else {
        writeOutput(`removed ${options.name}`, dependencies);
    }
}

export interface PluginEnableOptions {
    readonly name: string;
    readonly enabled: boolean;
    readonly json?: boolean;
}

export function runSetPluginEnabledCommand(
    options: PluginEnableOptions,
    dependencies: PluginsCommandDependencies = {},
): void {
    setPluginEnabled(options.name, options.enabled);
    const verb = options.enabled ? 'enabled' : 'disabled';
    if (options.json) {
        writeOutput(JSON.stringify({ name: options.name, enabled: options.enabled }), dependencies);
    } else {
        writeOutput(`${verb} ${options.name}`, dependencies);
    }
}

export function runPluginsHomeCommand(
    options: { json?: boolean } = {},
    dependencies: PluginsCommandDependencies = {},
): string {
    const home = resolvePluginsHome();
    if (options.json) {
        writeOutput(JSON.stringify({ home }), dependencies);
    } else {
        writeOutput(home, dependencies);
    }
    return home;
}

export function createPluginsCommand(dependencies: PluginsCommandDependencies = {}): Command {
    const command = new Command('plugin')
        .description('Inspect, install, and manage XQoder plugins');

    command
        .command('list')
        .description('List plugin load status, compatibility, and source')
        .option('--json', 'Output the plugin report as JSON')
        .option('--cwd <dir>', 'Resolve plugin config relative to a directory')
        .action(async (options: PluginsListOptions) => {
            await runListPluginsCommand(options, dependencies);
        });

    command
        .command('install <source>')
        .description('Install a plugin from a local directory into ~/.xqoder/plugins/')
        .option('-f, --force', 'Overwrite an existing install with the same name')
        .option('--json', 'Output the installed plugin as JSON')
        .action(async (source: string, options: { force?: boolean; json?: boolean }) => {
            try {
                await runInstallPluginCommand({ source, ...options }, dependencies);
            } catch (error) {
                writeError(error instanceof Error ? error.message : String(error), dependencies);
                process.exitCode = 1;
            }
        });

    command
        .command('remove <name>')
        .alias('uninstall')
        .description('Remove an installed plugin from ~/.xqoder/plugins/')
        .option('--json', 'Output the removal result as JSON')
        .action((name: string, options: { json?: boolean }) => {
            try {
                runRemovePluginCommand({ name, ...options }, dependencies);
            } catch (error) {
                writeError(error instanceof Error ? error.message : String(error), dependencies);
                process.exitCode = 1;
            }
        });

    command
        .command('enable <name>')
        .description('Enable an installed plugin')
        .option('--json', 'Output the state change as JSON')
        .action((name: string, options: { json?: boolean }) => {
            runSetPluginEnabledCommand({ name, enabled: true, ...options }, dependencies);
        });

    command
        .command('disable <name>')
        .description('Disable an installed plugin without removing it')
        .option('--json', 'Output the state change as JSON')
        .action((name: string, options: { json?: boolean }) => {
            runSetPluginEnabledCommand({ name, enabled: false, ...options }, dependencies);
        });

    command
        .command('home')
        .description('Print the plugin install directory (~/.xqoder/plugins/)')
        .option('--json', 'Output as JSON')
        .action((options: { json?: boolean }) => {
            runPluginsHomeCommand(options, dependencies);
        });

    return command;
}

export const pluginsCommand = createPluginsCommand();
