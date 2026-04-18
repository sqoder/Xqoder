import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import { inspectMcpServers, type McpServerInspection } from '@xqoder/agent';
import {
    ConfigManager,
    type SandboxMode,
    configManager,
    logger,
    resolveConfigWithEnvOverrides,
    type MCPServerConfig,
    type XQoderConfig,
} from '@xqoder/shared';

interface McpOutputOptions {
    json?: boolean;
    dir?: string;
}

interface McpAddOptions {
    transport?: 'stdio' | 'http' | 'sse';
    command?: string;
    url?: string;
    arg: string[];
    env: string[];
    header?: string[];
    cwd?: string;
    timeoutMs: number;
    disabled?: boolean;
}

interface McpCommandDependencies {
    inspectServers?: (options: {
        servers: MCPServerConfig[];
        cwd: string;
        projectRoot: string;
        sandboxMode?: SandboxMode;
        allowedPaths?: string[];
    }) => Promise<McpServerInspection[]>;
    writeOutput?: (output: string) => void;
}

export function runListMcpServersCommand(
    options: McpOutputOptions,
    dependencies: McpCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): void {
    const servers = manager.load().mcp?.servers ?? [];
    if (options.json) {
        writeOutput(JSON.stringify(servers, null, 2), dependencies);
        return;
    }

    if (servers.length === 0) {
        writeOutput('No MCP servers configured.', dependencies);
        return;
    }

    for (const server of servers) {
        writeOutput([
            `${server.name} ${server.enabled === false ? '[disabled]' : '[enabled]'}`,
            `transport=${server.transport ?? 'stdio'}`,
            `command=${server.command ?? '-'}`,
            ...(server.url ? [`url=${server.url}`] : []),
            `args=${server.args?.length ?? 0}`,
            `timeout=${server.timeoutMs ?? 15_000}ms`,
        ].join(' '), dependencies);
    }
}

export function runShowMcpServerCommand(
    name: string,
    options: McpOutputOptions,
    dependencies: McpCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): void {
    const server = findServerOrThrow(manager.load(), name);
    const output = JSON.stringify(server, null, 2);

    if (options.json) {
        writeOutput(output, dependencies);
        return;
    }

    writeOutput(output, dependencies);
}

export async function runDoctorMcpServersCommand(
    name: string | undefined,
    options: McpOutputOptions,
    dependencies: McpCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): Promise<void> {
    const { config } = resolveConfigWithEnvOverrides(manager.load());
    const configuredServers = config.mcp?.servers ?? [];
    const selectedServers = name
        ? configuredServers.filter((server) => server.name === name)
        : configuredServers;

    if (name && selectedServers.length === 0) {
        throw new Error(`MCP server not found: ${name}`);
    }

    const inspect = dependencies.inspectServers ?? inspectMcpServers;
    const projectRoot = path.resolve(options.dir ?? '.');
    const inspections = await inspect({
        servers: selectedServers,
        cwd: projectRoot,
        projectRoot,
        sandboxMode: config.sandbox?.mode,
        allowedPaths: config.sandbox?.allowedPaths,
    });

    if (options.json) {
        writeOutput(JSON.stringify(inspections, null, 2), dependencies);
        return;
    }

    if (inspections.length === 0) {
        writeOutput('No MCP servers configured.', dependencies);
        return;
    }

    for (const inspection of inspections) {
        const status = inspection.status.toUpperCase();
        const header = `${inspection.name} ${status} transport=${inspection.transport} tools=${inspection.toolCount} prompts=${inspection.promptCount} resources=${inspection.resourceCount} templates=${inspection.resourceTemplateCount}`;
        writeOutput(header, dependencies);
        if (inspection.url) {
            writeOutput(`url=${inspection.url}`, dependencies);
        }
        if (inspection.serverInfo) {
            writeOutput(`server=${inspection.serverInfo.name}@${inspection.serverInfo.version} protocol=${inspection.protocolVersion ?? 'unknown'}`, dependencies);
        }
        if (inspection.error) {
            writeOutput(`error=${inspection.error}`, dependencies);
            continue;
        }
        if (inspection.tools.length > 0) {
            writeOutput(`tools=${inspection.tools.map((tool) => tool.name).join(', ')}`, dependencies);
        }
        if (inspection.prompts.length > 0) {
            writeOutput(`prompts=${inspection.prompts.map((prompt) => prompt.name).join(', ')}`, dependencies);
        }
        if (inspection.resources.length > 0) {
            writeOutput(`resources=${inspection.resources.map((resource) => resource.uri).join(', ')}`, dependencies);
        }
        if (inspection.resourceTemplates.length > 0) {
            writeOutput(`resourceTemplates=${inspection.resourceTemplates.map((template) => template.uriTemplate).join(', ')}`, dependencies);
        }
    }
}

export function runAddMcpServerCommand(
    name: string,
    options: McpAddOptions,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const current = manager.load();
    if ((current.mcp?.servers ?? []).some((server) => server.name === name)) {
        throw new Error(`MCP server already exists: ${name}`);
    }

    const nextServers = [
        ...(current.mcp?.servers ?? []),
        buildMcpServerConfigFromOptions(name, options),
    ];

    manager.update({
        mcp: {
            servers: nextServers,
        },
    });
    manager.save();
    logger.success(`Added MCP server: ${name}`);
}

function buildMcpServerConfigFromOptions(name: string, options: McpAddOptions): MCPServerConfig {
    const transport = normalizeMcpTransport(options.transport);
    if (transport === 'http' || transport === 'sse') {
        if (!options.url?.trim()) {
            throw new Error(`${transport} transport requires --url`);
        }
        return {
            name,
            transport,
            url: options.url.trim(),
            headers: parseEnvPairs(options.header),
            enabled: !options.disabled,
            timeoutMs: options.timeoutMs,
        };
    }

    if (!options.command?.trim()) {
        throw new Error('stdio transport requires --command');
    }

    return {
        name,
        transport: 'stdio',
        command: options.command.trim(),
        args: options.arg,
        env: parseEnvPairs(options.env),
        cwd: options.cwd ? path.resolve(options.cwd) : undefined,
        enabled: !options.disabled,
        timeoutMs: options.timeoutMs,
    };
}

function normalizeMcpTransport(value: string | undefined): 'stdio' | 'http' | 'sse' {
    const raw = (value ?? 'stdio').trim().toLowerCase();
    if (raw === 'http' || raw === 'sse' || raw === 'stdio') {
        return raw;
    }
    throw new Error(`Unsupported MCP transport: ${value}`);
}

export function runRemoveMcpServerCommand(
    name: string,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const current = manager.load();
    const existingServers = current.mcp?.servers ?? [];
    const nextServers = existingServers.filter((server) => server.name !== name);

    if (nextServers.length === existingServers.length) {
        throw new Error(`MCP server not found: ${name}`);
    }

    manager.update({
        mcp: {
            servers: nextServers,
        },
    });
    manager.save();
    logger.success(`Removed MCP server: ${name}`);
}

export function runToggleMcpServerCommand(
    name: string,
    enabled: boolean,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const current = manager.load();
    const nextServers = (current.mcp?.servers ?? []).map((server) => server.name === name
        ? { ...server, enabled }
        : server);

    if (nextServers.every((server) => server.name !== name)) {
        throw new Error(`MCP server not found: ${name}`);
    }

    manager.update({
        mcp: {
            servers: nextServers,
        },
    });
    manager.save();
    logger.success(`${enabled ? 'Enabled' : 'Disabled'} MCP server: ${name}`);
}

export function createMcpCommand(
    manager: ConfigManager = configManager,
    dependencies: McpCommandDependencies = {},
): Command {
    const mcpCommand = new Command('mcp')
        .description('Manage external MCP servers and runtime connectivity');

    mcpCommand
        .command('list')
        .description('List configured MCP servers')
        .option('--json', 'Output in JSON format')
        .action((options: McpOutputOptions) => {
            try {
                runListMcpServersCommand(options, dependencies, manager);
            } catch (error) {
                logger.error(`Failed to list MCP servers: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    mcpCommand
        .command('show')
        .description('Show configuration for a single MCP server')
        .argument('<name>', 'server name')
        .option('--json', 'Output in JSON format')
        .action((name: string, options: McpOutputOptions) => {
            try {
                runShowMcpServerCommand(name, options, dependencies, manager);
            } catch (error) {
                logger.error(`Failed to read MCP configuration: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    mcpCommand
        .command('add')
        .description('Add a new MCP server (stdio/http/sse)')
        .argument('<name>', 'server name')
        .option('--transport <transport>', 'Transport protocol: stdio | http | sse', 'stdio')
        .option('--command <command>', 'stdio start command')
        .option('--url <url>', 'http/sse server URL')
        .option('--arg <value>', 'Command argument, can be passed multiple times', collectOption, [])
        .option('--env <key=value>', 'Extra environment variable, can be passed multiple times', collectOption, [])
        .option('--header <key=value>', 'http/sse request header, can be passed multiple times', collectOption, [])
        .option('--cwd <dir>', 'server working directory')
        .option('--timeout-ms <ms>', 'Request timeout (milliseconds)', parseNumberOption, 15_000)
        .option('--disabled', 'Keep disabled after adding')
        .action((name: string, options: McpAddOptions) => {
            try {
                runAddMcpServerCommand(name, options, manager);
            } catch (error) {
                logger.error(`Failed to add MCP server: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    mcpCommand
        .command('remove')
        .description('Remove an MCP server')
        .argument('<name>', 'server name')
        .action((name: string) => {
            try {
                runRemoveMcpServerCommand(name, manager);
            } catch (error) {
                logger.error(`Failed to remove MCP server: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    mcpCommand
        .command('enable')
        .description('Enable an MCP server')
        .argument('<name>', 'server name')
        .action((name: string) => {
            try {
                runToggleMcpServerCommand(name, true, manager);
            } catch (error) {
                logger.error(`Failed to enable MCP server: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    mcpCommand
        .command('disable')
        .description('Disable an MCP server')
        .argument('<name>', 'server name')
        .action((name: string) => {
            try {
                runToggleMcpServerCommand(name, false, manager);
            } catch (error) {
                logger.error(`Failed to disable MCP server: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    mcpCommand
        .command('doctor')
        .description('Connectivity check: start MCP server and list its tools')
        .argument('[name]', 'Check specific server only')
        .option('-d, --dir <dir>', 'Project directory used as root', '.')
        .option('--json', 'Output in JSON format')
        .action(async (name: string | undefined, options: McpOutputOptions) => {
            try {
                await runDoctorMcpServersCommand(name, options, dependencies, manager);
            } catch (error) {
                logger.error(`MCP check failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    return mcpCommand;
}

export const mcpCommand = createMcpCommand();

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

function findServerOrThrow(config: XQoderConfig, name: string): MCPServerConfig {
    const server = (config.mcp?.servers ?? []).find((entry) => entry.name === name);
    if (!server) {
        throw new Error(`MCP server not found: ${name}`);
    }
    return server;
}

function parseEnvPairs(entries: string[] = []): Record<string, string> {
    return Object.fromEntries(entries.map((entry) => {
        const separatorIndex = entry.indexOf('=');
        if (separatorIndex <= 0) {
            throw new Error(`Invalid --env argument: ${entry}`);
        }
        const key = entry.slice(0, separatorIndex).trim();
        const value = entry.slice(separatorIndex + 1);
        return [key, value];
    }));
}

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

function writeOutput(output: string, dependencies: McpCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}
