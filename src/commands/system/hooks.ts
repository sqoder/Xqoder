import { Command } from 'commander';
import { ConfigManager, configManager } from '@xqoder/shared';
import {
    createHooksSnapshot,
    runHooksCommand,
    runHooksPathCommand,
    runSetDisableAllHooksCommand,
    runShowHooksCommand,
    type HookEventSummary,
    type HookHandlerEntry,
    type HooksCommandDependencies,
    type HooksOutputOptions,
    type HooksSnapshot,
    type HooksToggleResult,
} from '../../application/system/hooks.js';

export {
    createHooksSnapshot,
    runHooksPathCommand,
    runSetDisableAllHooksCommand,
    runShowHooksCommand,
};
export type {
    HookEventSummary,
    HookHandlerEntry,
    HooksCommandDependencies,
    HooksOutputOptions,
    HooksSnapshot,
    HooksToggleResult,
};

function parseOnOff(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'on' || normalized === 'true') {
        return true;
    }
    if (normalized === 'off' || normalized === 'false') {
        return false;
    }
    throw new Error(`Unsupported hook state: ${value}`);
}

export function createHooksCommand(
    manager: ConfigManager = configManager,
    dependencies: HooksCommandDependencies = {},
): Command {
    const command = new Command('hooks')
        .description('Inspect configured hooks and toggle hook execution')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runShowHooksCommand(options, dependencies, manager));
        });

    command
        .command('show')
        .description('Show configured hooks, grouped by event and source')
        .option('--dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .option('--event <name>', 'Only show one hook event')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runShowHooksCommand(options, dependencies, manager));
        });

    command
        .command('path')
        .description('Print the config file path used when writing hook settings')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runHooksPathCommand(options, dependencies));
        });

    command
        .command('disable-all')
        .description('Enable or disable all configured hooks in one config scope')
        .argument('<state>', 'on | off')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((state: string, options: HooksOutputOptions) => {
            runHooksCommand(() => runSetDisableAllHooksCommand(parseOnOff(state), options, dependencies));
        });

    return command;
}

export const hooksCommand = createHooksCommand();
