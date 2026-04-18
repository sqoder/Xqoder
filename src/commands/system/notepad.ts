import { Command } from 'commander';
import {
    createNotepadSnapshot,
    createNotepadStats,
    runNotepadCommand,
    runNotepadPathCommand,
    runNotepadStatsCommand,
    runPruneNotepadCommand,
    runShowNotepadCommand,
    runWriteManualNotepadCommand,
    runWritePriorityNotepadCommand,
    runWriteWorkingNotepadCommand,
    type NotepadCommandDependencies,
    type NotepadOutputOptions,
    type NotepadPaths,
    type NotepadSnapshot,
    type NotepadStats,
    type NotepadWriteResult,
} from '../../application/system/notepad.js';

export {
    createNotepadSnapshot,
    createNotepadStats,
    runNotepadPathCommand,
    runNotepadStatsCommand,
    runPruneNotepadCommand,
    runShowNotepadCommand,
    runWriteManualNotepadCommand,
    runWritePriorityNotepadCommand,
    runWriteWorkingNotepadCommand,
};
export type {
    NotepadCommandDependencies,
    NotepadOutputOptions,
    NotepadPaths,
    NotepadSnapshot,
    NotepadStats,
    NotepadWriteResult,
};

export function createNotepadCommand(
    dependencies: NotepadCommandDependencies = {},
): Command {
    const command = new Command('notepad')
        .description('Inspect and update the project notepad stored in .xqoder/notepad.md')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .option('--section <section>', 'Section to show: all | priority | working | manual')
        .action((options: NotepadOutputOptions) => {
            runNotepadCommand(() => runShowNotepadCommand(options, dependencies));
        });

    command
        .command('show')
        .description('Show current notepad content or one section')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .option('--section <section>', 'Section to show: all | priority | working | manual')
        .action((options: NotepadOutputOptions) => {
            runNotepadCommand(() => runShowNotepadCommand(options, dependencies));
        });

    command
        .command('path')
        .description('Print the canonical project notepad path')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: NotepadOutputOptions) => {
            runNotepadCommand(() => runNotepadPathCommand(options, dependencies));
        });

    command
        .command('write-priority')
        .description('Replace the PRIORITY section with compact always-load context')
        .argument('<content>', 'Priority content')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((content: string, options: NotepadOutputOptions) => {
            runNotepadCommand(() => runWritePriorityNotepadCommand(content, options, dependencies));
        });

    command
        .command('write-working')
        .description('Append a timestamped working-memory entry')
        .argument('<content>', 'Working note content')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((content: string, options: NotepadOutputOptions) => {
            runNotepadCommand(() => runWriteWorkingNotepadCommand(content, options, dependencies));
        });

    command
        .command('write-manual')
        .description('Append a durable manual note')
        .argument('<content>', 'Manual note content')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((content: string, options: NotepadOutputOptions) => {
            runNotepadCommand(() => runWriteManualNotepadCommand(content, options, dependencies));
        });

    command
        .command('prune')
        .description('Prune working-memory entries older than N days (default 7)')
        .argument('[daysOld]', 'Days to retain', (value) => Number.parseInt(value, 10))
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((daysOld: number | undefined, options: NotepadOutputOptions) => {
            runNotepadCommand(() => runPruneNotepadCommand({ ...options, daysOld }, dependencies));
        });

    command
        .command('stats')
        .description('Show notepad size and entry counts')
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: NotepadOutputOptions) => {
            runNotepadCommand(() => runNotepadStatsCommand(options, dependencies));
        });

    return command;
}

export const notepadCommand = createNotepadCommand();
