import { Command } from 'commander';
import { ConfigManager, type XQoderConfig } from '@xqoder/shared';
import { getXQoderVersion } from '../../cli/version.js';
import { discoverCommandRegistrationsWithReport, type CommandPluginDiscoveryResult } from '../../plugins/command-plugins.js';

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
}

function writeOutput(text: string, dependencies: PluginsCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(text);
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

    if (options.json) {
        writeOutput(JSON.stringify(result, null, 2), dependencies);
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

    return result;
}

export function createPluginsCommand(dependencies: PluginsCommandDependencies = {}): Command {
    const command = new Command('plugin')
        .description('Inspect built-in and external plugin loading status');

    command
        .command('list')
        .description('List plugin load status, compatibility, and source')
        .option('--json', 'Output the plugin report as JSON')
        .option('--cwd <dir>', 'Resolve plugin config relative to a directory')
        .action(async (options: PluginsListOptions) => {
            await runListPluginsCommand(options, dependencies);
        });

    return command;
}

export const pluginsCommand = createPluginsCommand();
