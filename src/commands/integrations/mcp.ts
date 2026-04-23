import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import { ConfigManager, configManager } from '@xqoder/shared';
import {
    createMcpSnapshot,
    runAddMcpCommand,
    runAddMcpServerCommand,
    runDoctorMcpCommand,
    runListMcpCommand,
    runMcpCommand,
    runRemoveMcpCommand,
    runShowMcpCommand,
    runToggleMcpCommand,
    type McpAddOptions,
    type McpCommandDependencies,
    type McpOutputOptions,
    type McpServerDetail,
    type McpSnapshot,
    type McpWriteResult,
} from '../../application/integrations/mcp.js';

export {
    createMcpSnapshot,
    runAddMcpCommand,
    runAddMcpServerCommand,
    runDoctorMcpCommand,
    runListMcpCommand,
    runRemoveMcpCommand,
    runShowMcpCommand,
    runToggleMcpCommand,
};
export type {
    McpAddOptions,
    McpCommandDependencies,
    McpOutputOptions,
    McpServerDetail,
    McpSnapshot,
    McpWriteResult,
};

export function createMcpCommand(
    manager: ConfigManager = configManager,
    dependencies: McpCommandDependencies = {},
): Command {
    const command = new Command('mcp')
        .description('Manage external MCP servers and runtime connectivity')
        .option('--dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: McpOutputOptions) => {
            runMcpCommand(() => runListMcpCommand(options, dependencies, manager));
        });

    command
        .command('list')
        .description('List configured MCP servers')
        .option('--dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((options: McpOutputOptions) => {
            runMcpCommand(() => runListMcpCommand(options, dependencies, manager));
        });

    command
        .command('show')
        .description('Show configuration for a single MCP server')
        .argument('<name>', 'Server name')
        .option('--dir <dir>', 'Project directory')
        .option('--json', 'Output in JSON format')
        .action((name: string, options: McpOutputOptions) => {
            runMcpCommand(() => runShowMcpCommand(name, options, dependencies, manager));
        });

    command
        .command('add')
        .description('Add a new MCP server (stdio/http/sse)')
        .argument('<name>', 'Server name')
        .argument('[command]', 'stdio command to run')
        .argument('[args...]', 'Arguments for the stdio command')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .option('--transport <transport>', 'Transport protocol: stdio | http | sse', 'stdio')
        .option('--command <command>', 'stdio start command')
        .option('--url <url>', 'http/sse server URL')
        .option('--arg <value>', 'Command argument, can be passed multiple times', collectOption, [])
        .option('--env <key=value>', 'Extra environment variable, can be passed multiple times', collectOption, [])
        .option('--header <key=value>', 'http/sse request header, can be passed multiple times', collectOption, [])
        .option('--cwd <dir>', 'server working directory')
        .option('--timeout-ms <ms>', 'Request timeout in milliseconds', parseNumberOption, 15_000)
        .option('--disabled', 'Keep disabled after adding')
        .action((
            name: string,
            positionalCommand: string | undefined,
            positionalArgs: string[],
            options: McpAddOptions,
        ) => {
            const positionalCommandAsArg = options.command && positionalCommand
                ? [positionalCommand]
                : [];
            runMcpCommand(() => runAddMcpServerCommand(name, {
                ...options,
                command: options.command ?? positionalCommand,
                arg: [
                    ...(options.arg ?? []),
                    ...positionalCommandAsArg,
                    ...(positionalArgs ?? []),
                ],
            }, dependencies));
        });

    command
        .command('remove')
        .description('Remove an MCP server')
        .argument('<name>', 'Server name')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((name: string, options: McpOutputOptions) => {
            runMcpCommand(() => runRemoveMcpCommand(name, options, dependencies));
        });

    command
        .command('enable')
        .description('Enable an MCP server')
        .argument('<name>', 'Server name')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((name: string, options: McpOutputOptions) => {
            runMcpCommand(() => runToggleMcpCommand(name, true, options, dependencies));
        });

    command
        .command('disable')
        .description('Disable an MCP server')
        .argument('<name>', 'Server name')
        .option('--dir <dir>', 'Project directory')
        .option('--scope <scope>', 'Write target scope: global | project', 'project')
        .option('--json', 'Output in JSON format')
        .action((name: string, options: McpOutputOptions) => {
            runMcpCommand(() => runToggleMcpCommand(name, false, options, dependencies));
        });

    command
        .command('doctor')
        .description('Connectivity check: start MCP server and list its tools')
        .argument('[name]', 'Check specific server only')
        .option('-d, --dir <dir>', 'Project directory used as root', '.')
        .option('--json', 'Output in JSON format')
        .action((name: string | undefined, options: McpOutputOptions) => {
            return runMcpCommand(() => runDoctorMcpCommand(name, options, dependencies, manager));
        });

    return command;
}

export const mcpCommand = createMcpCommand();

function collectOption(value: string, previous: string[]): string[] {
    return [...previous, value];
}

function parseNumberOption(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid numeric value: ${value}`);
    }
    return parsed;
}

export function commandExists(command: string): boolean {
    if (command.includes(path.sep) || command.startsWith('.')) {
        return fs.existsSync(command);
    }

    const result = spawnSync('which', [command], {
        encoding: 'utf-8',
        stdio: 'ignore',
    });
    return result.status === 0;
}
