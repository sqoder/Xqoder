import { Command } from 'commander';
import { ConfigManager, configManager } from '@xqoder/shared';
import {
    runHooksCommand,
    runHooksPathCommand,
    runSetDisableAllHooksCommand,
    runShowHooksCommand,
    type HooksCommandDependencies,
    type HooksOutputOptions,
    type HooksSnapshot,
    type HooksToggleResult,
} from '../../application/system/hooks.js';

export {
    runHooksCommand,
    runHooksPathCommand,
    runSetDisableAllHooksCommand,
    runShowHooksCommand,
};
export type {
    HooksCommandDependencies,
    HooksOutputOptions,
    HooksSnapshot,
    HooksToggleResult,
};

export function createHooksCommand(
    manager: ConfigManager = configManager,
    dependencies: HooksCommandDependencies = {},
): Command {
    const command = new Command('hooks')
        .description('Inspect and update lifecycle hook configurations')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runShowHooksCommand(options, dependencies, manager));
        });

    command
        .command('show')
        .description('Show effective hook configurations and sources')
        .option('--dir <dir>', 'Project directory')
        .option('--event <event>', 'Filter by event name')
        .option('--json', 'Output in JSON format')
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
        .command('enable')
        .description('Enable all hooks in one config scope')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runSetDisableAllHooksCommand(false, options, dependencies, manager));
        });

    command
        .command('disable')
        .description('Disable all hooks in one config scope')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((options: HooksOutputOptions) => {
            runHooksCommand(() => runSetDisableAllHooksCommand(true, options, dependencies, manager));
        });

    return command;
}

export const hooksCommand = createHooksCommand();
