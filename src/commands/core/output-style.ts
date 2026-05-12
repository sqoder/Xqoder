import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import {
    clearOutputStyleSelection,
    loadOutputStyleRegistry,
    readOutputStyleSelection,
    writeOutputStyleSelection,
} from '../../core/output-styles/index.js';

export interface OutputStyleCommandDependencies {
    cwd?: string;
    writeOutput?: (output: string) => void;
}

interface OutputStyleOutputOptions {
    json?: boolean;
}

export function createOutputStyleCommand(dependencies: OutputStyleCommandDependencies = {}): Command {
    const command = new Command('output-style').description('List and switch output styles');

    command
        .command('ls')
        .description('List available output styles')
        .option('--json', 'Output in JSON format')
        .action((options: OutputStyleOutputOptions) => runSafely(() => runListOutputStylesCommand(options, dependencies)));

    command
        .command('use')
        .description('Select an output style for the current project')
        .argument('<name>', 'output-style name')
        .action((name: string) => runSafely(() => runUseOutputStyleCommand(name, dependencies)));

    command
        .command('show')
        .description('Show the currently selected output style (if any)')
        .option('--json', 'Output in JSON format')
        .action((options: OutputStyleOutputOptions) => runSafely(() => runShowOutputStyleCommand(options, dependencies)));

    command
        .command('clear')
        .description('Clear the currently selected output style')
        .action(() => runSafely(() => runClearOutputStyleCommand(dependencies)));

    return command;
}

export function runListOutputStylesCommand(
    options: OutputStyleOutputOptions = {},
    dependencies: OutputStyleCommandDependencies = {},
): Array<{ name: string; description: string; filePath: string }> {
    const cwd = dependencies.cwd ?? process.cwd();
    const registry = loadOutputStyleRegistry(cwd);
    const active = readOutputStyleSelection(cwd);
    const entries = registry.styles.map((style) => ({
        name: style.name,
        description: style.description,
        filePath: style.filePath,
        active: style.name === active,
    }));

    const write = dependencies.writeOutput ?? console.log;
    if (options.json) {
        write(JSON.stringify(entries, null, 2));
        return entries;
    }

    if (entries.length === 0) {
        write('No output styles found under .xqoder/output-styles, .claude/output-styles, or user-level equivalents.');
        return entries;
    }

    for (const entry of entries) {
        const prefix = entry.active ? '* ' : '  ';
        write(`${prefix}${entry.name} — ${entry.description}`);
    }
    return entries;
}

export function runUseOutputStyleCommand(
    name: string,
    dependencies: OutputStyleCommandDependencies = {},
): void {
    const cwd = dependencies.cwd ?? process.cwd();
    const registry = loadOutputStyleRegistry(cwd);
    if (!registry.get(name)) {
        throw new Error(`Output style not found: ${name}`);
    }
    writeOutputStyleSelection(cwd, name);
    logger.success(`Output style switched to ${name}`);
}

export function runShowOutputStyleCommand(
    options: OutputStyleOutputOptions = {},
    dependencies: OutputStyleCommandDependencies = {},
): { name: string | null } {
    const cwd = dependencies.cwd ?? process.cwd();
    const name = readOutputStyleSelection(cwd) ?? null;
    const write = dependencies.writeOutput ?? console.log;
    if (options.json) {
        write(JSON.stringify({ name }, null, 2));
    } else {
        write(name ? `Active output style: ${name}` : 'No output style selected.');
    }
    return { name };
}

export function runClearOutputStyleCommand(
    dependencies: OutputStyleCommandDependencies = {},
): void {
    const cwd = dependencies.cwd ?? process.cwd();
    clearOutputStyleSelection(cwd);
    logger.success('Output style cleared');
}

function runSafely(action: () => void): void {
    try {
        action();
    } catch (err) {
        logger.error(`Output style command failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

export const outputStyleCommand = createOutputStyleCommand();
