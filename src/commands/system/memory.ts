import { Command } from 'commander';
import { ConfigManager, configManager } from '@xqoder/shared';
import {
    createMemorySnapshot,
    runInitMemoryCommand,
    runMemoryCommand,
    runMemoryPathCommand,
    runMigrateMemoryCommand,
    runShowMemoryCommand,
    type MemoryCommandDependencies,
    type MemoryCommandOutputOptions,
    type MemoryPaths,
    type MemorySnapshot,
    type MemoryWriteResult,
} from '../../application/system/memory.js';

export {
    createMemorySnapshot,
    runInitMemoryCommand,
    runMemoryPathCommand,
    runMigrateMemoryCommand,
    runShowMemoryCommand,
};
export type {
    MemoryCommandDependencies,
    MemoryCommandOutputOptions,
    MemoryPaths,
    MemorySnapshot,
    MemoryWriteResult,
};

export function createMemoryCommand(
    manager: ConfigManager = configManager,
    dependencies: MemoryCommandDependencies = {},
): Command {
    const command = new Command('memory')
        .description('Inspect and manage the project CLAUDE.md instruction file')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: MemoryCommandOutputOptions) => {
            runMemoryCommand(() => runShowMemoryCommand(options, dependencies, manager));
        });

    command
        .command('show')
        .description('Show the effective project instruction file and its current content')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: MemoryCommandOutputOptions) => {
            runMemoryCommand(() => runShowMemoryCommand(options, dependencies, manager));
        });

    command
        .command('path')
        .description('Print the canonical CLAUDE.md path for the current project')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: MemoryCommandOutputOptions) => {
            runMemoryCommand(() => runMemoryPathCommand(options, dependencies));
        });

    command
        .command('init')
        .description('Create CLAUDE.md if missing, or migrate from XQoder.md when present')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .option('--force', 'Overwrite an existing CLAUDE.md')
        .action((options: MemoryCommandOutputOptions) => {
            runMemoryCommand(() => runInitMemoryCommand(options, dependencies));
        });

    command
        .command('migrate')
        .description('Copy legacy XQoder.md content into CLAUDE.md')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .option('--force', 'Overwrite an existing CLAUDE.md')
        .action((options: MemoryCommandOutputOptions) => {
            runMemoryCommand(() => runMigrateMemoryCommand(options, dependencies));
        });

    return command;
}

export const memoryCommand = createMemoryCommand();
