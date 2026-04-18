import { Command } from 'commander';
import { ConfigManager } from '@xqoder/shared';
import { getXQoderVersion } from '../../cli/version.js';
import {
    applyRootShellOptions,
    resolveRootShellOutputFormat,
    runRootShellAction,
    type RootShellDependencies,
} from '../../cli/root-shell.js';
import {
    discoverCommandRegistrations,
    getBuiltInCommandRegistrations,
    type CommanderCommandRegistration,
} from '../../plugins/command-plugins.js';
import { tuiInterfaceCommand as tuiCommand } from '../tui/index.js';

interface ProgramDependencies {
    chatCommand?: Command;
    tuiCommand?: Command;
    commandRegistrations?: CommanderCommandRegistration[];
    configManager?: ConfigManager;
    promptRunner?: RootShellDependencies['promptRunner'];
}

const ROOT_HELP_EXAMPLES = [
    '  # Run in interactive mode',
    '  xqoder',
    '',
    '  # Run in a specific directory',
    '  xqoder -c /path/to/project',
    '',
    '  # Run a single non-interactive prompt',
    '  xqoder -p "Explain the use of context in Go"',
    '',
    '  # Run a single non-interactive prompt with JSON output',
    '  xqoder -p "Explain the use of context in Go" -f json',
].join('\n');

function addHiddenRootCommand(program: Command, command: Command): void {
    program.addCommand(command, { hidden: true });
}

export function createProgram(
    argv: string[] = process.argv.slice(2),
    dependencies: ProgramDependencies = {},
): Command {
    const normalizedArgv = normalizeCliArgs(argv);
    const commandRegistrations = dependencies.commandRegistrations
        ?? getBuiltInCommandRegistrations({
            chatCommand: dependencies.chatCommand,
            tuiCommand: dependencies.tuiCommand,
        });
    const topLevelCommandNames = new Set(commandRegistrations.flatMap((registration) => [registration.name, ...(registration.aliases ?? [])]));
    const program = new Command();

    program
        .name('xqoder')
        .description('Terminal-based AI assistant for software development')
        .summary('Terminal-based AI assistant for software development')
        .addHelpText('after', `\nExamples:\n${ROOT_HELP_EXAMPLES}\n`)
        .version(getXQoderVersion());

    for (const registration of commandRegistrations) {
        const command = registration.createCommand();
        if (registration.hiddenFromRoot) {
            addHiddenRootCommand(program, command);
            continue;
        }
        program.addCommand(command);
    }

    if (!hasTopLevelCommand(normalizedArgv, topLevelCommandNames)) {
        applyRootShellOptions(program);
    }

    program.action(async (opts) => {
        try {
            const result = await runRootShellAction(opts, {
                promptRunner: dependencies.promptRunner,
            });
            if (result === 'show-help') {
                program.outputHelp();
            }
        } catch (err) {
            const outputFormat = resolveRootShellOutputFormat(opts.outputFormat, Boolean(opts.json));
            if (outputFormat === 'json') {
                const output = {
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                };
                process.stderr.write(JSON.stringify(output, null, 2) + '\n');
            } else {
                process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
            }
            process.exit(1);
        }
    });

    return program;
}

export async function runProgram(
    argv: string[] = process.argv,
    dependencies: ProgramDependencies = {},
): Promise<void> {
    const normalizedArgv = normalizeProcessArgv(argv);
    const configManager = dependencies.configManager ?? new ConfigManager();
    const config = configManager.load();
    const commandRegistrations = dependencies.commandRegistrations
        ?? await discoverCommandRegistrations({
            chatCommand: dependencies.chatCommand,
            tuiCommand: dependencies.tuiCommand ?? tuiCommand,
            cwd: process.cwd(),
            pluginConfig: config.plugins,
            productVersion: getXQoderVersion(),
            productName: 'xqoder',
        });
    const program = createProgram(normalizedArgv.slice(2), {
        ...dependencies,
        commandRegistrations,
    });
    await program.parseAsync(normalizedArgv);
}

export { createProgram as createCliProgram, runProgram as runCliProgram };

function hasTopLevelCommand(argv: string[], topLevelCommandNames: ReadonlySet<string>): boolean {
    const optionValueFlags = new Set([
        '-p', '--prompt',
        '-m', '--model',
        '-a', '--agent',
        '-c', '--cwd',
        '-f', '--output-format',
    ]);

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
            continue;
        }

        if (optionValueFlags.has(arg)) {
            index += 1;
            continue;
        }

        if (arg.startsWith('-')) {
            continue;
        }

        return topLevelCommandNames.has(arg);
    }

    return false;
}

function normalizeProcessArgv(argv: string[]): string[] {
    if (argv.length > 2 && argv[2] === '--') {
        return [argv[0] ?? 'node', argv[1] ?? 'xqoder', ...argv.slice(3)];
    }

    return argv;
}

function normalizeCliArgs(argv: string[]): string[] {
    return argv[0] === '--'
        ? argv.slice(1)
        : argv;
}
