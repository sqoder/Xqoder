import { Command } from 'commander';
import {
    createIdeSnapshot,
    runIdeAsyncCommand,
    runIdeCommand,
    runShowIdeCommand,
    runShowIdeDiagnosticsCommand,
    runShowIdeStateCommand,
    type IdeCommandDependencies,
    type IdeCommandOutputOptions,
    type IdeDiagnostic,
    type IdeSnapshot,
    type IdeState,
} from '../../application/system/ide.js';

export {
    createIdeSnapshot,
    runShowIdeCommand,
    runShowIdeDiagnosticsCommand,
    runShowIdeStateCommand,
};
export type {
    IdeCommandDependencies,
    IdeCommandOutputOptions,
    IdeDiagnostic,
    IdeSnapshot,
    IdeState,
};

export function createIdeCommand(
    dependencies: IdeCommandDependencies = {},
): Command {
    const command = new Command('ide')
        .description('Show IDE bridge status and local attach instructions')
        .option('--cwd <dir>', 'Project directory')
        .option('-d, --dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: IdeCommandOutputOptions) => {
            runIdeCommand(() => runShowIdeCommand(options, dependencies));
        });

    command
        .command('status')
        .description('Show IDE bridge status and local attach instructions')
        .option('--cwd <dir>', 'Project directory')
        .option('-d, --dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: IdeCommandOutputOptions) => {
            runIdeCommand(() => runShowIdeCommand(options, dependencies));
        });

    command
        .command('state')
        .description('Show current IDE state (active file, selection)')
        .option('--cwd <dir>', 'Project directory')
        .option('-d, --dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: IdeCommandOutputOptions) => {
            return runIdeAsyncCommand(() => runShowIdeStateCommand(options, dependencies));
        });

    command
        .command('diagnostics')
        .description('Get diagnostics from the IDE')
        .option('--cwd <dir>', 'Project directory')
        .option('-d, --dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: IdeCommandOutputOptions) => {
            return runIdeAsyncCommand(() => runShowIdeDiagnosticsCommand(options, dependencies));
        });

    return command;
}

export const ideCommand = createIdeCommand();
