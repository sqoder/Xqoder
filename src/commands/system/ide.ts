import { Command } from 'commander';
import {
    createIdeSnapshot,
    runIdeCommand,
    runShowIdeCommand,
    type IdeCommandDependencies,
    type IdeCommandOutputOptions,
    type IdeSnapshot,
} from '../../application/system/ide.js';

export {
    createIdeSnapshot,
    runShowIdeCommand,
};
export type {
    IdeCommandDependencies,
    IdeCommandOutputOptions,
    IdeSnapshot,
};

export function createIdeCommand(
    dependencies: IdeCommandDependencies = {},
): Command {
    const command = new Command('ide')
        .description('Show IDE bridge status and local attach instructions')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: IdeCommandOutputOptions) => {
            runIdeCommand(() => runShowIdeCommand(options, dependencies));
        });

    command
        .command('status')
        .description('Show IDE bridge status and local attach instructions')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: IdeCommandOutputOptions) => {
            runIdeCommand(() => runShowIdeCommand(options, dependencies));
        });

    return command;
}

export const ideCommand = createIdeCommand();
