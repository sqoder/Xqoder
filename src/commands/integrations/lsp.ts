import * as path from 'node:path';
import { Command } from 'commander';
import { inspectLspServers, type LspServerInspection } from '@xqoder/agent';
import {
    ConfigManager,
    configManager,
    logger,
    resolveConfigWithEnvOverrides,
    type LSPServerConfig,
    type LSPTcpServerConfig,
    type XQoderConfig,
} from '@xqoder/shared';
import { commandExists } from './mcp.js';
import { createLspUiCommand } from './lsp-ui.js';

interface LspOutputOptions {
    json?: boolean;
    dir?: string;
}

interface LspAddOptions {
    transport?: string;
    command?: string;
    arg: string[];
    extension: string[];
    env: string[];
    cwd?: string;
    host?: string;
    port?: number;
    languageId?: string;
    timeoutMs: number;
    disabled?: boolean;
    initJson?: string;
}

interface LspCommandDependencies {
    inspectServers?: (options: {
        servers: LSPServerConfig[];
        cwd: string;
        projectRoot: string;
    }) => Promise<LspServerInspection[]>;
    writeOutput?: (output: string) => void;
}

export function runListLspServersCommand(
    options: LspOutputOptions,
    dependencies: LspCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): void {
    const servers = manager.load().lsp?.servers ?? [];
    if (options.json) {
        writeOutput(JSON.stringify(servers, null, 2), dependencies);
        return;
    }

    if (servers.length === 0) {
        writeOutput('No LSP servers configured.', dependencies);
        return;
    }

    for (const server of servers) {
        const transport = server.transport ?? 'stdio';
        const endpoint = isTcpServerConfig(server)
            ? `${server.host}:${server.port}`
            : undefined;
        writeOutput([
            `${server.name} ${server.enabled === false ? '[disabled]' : '[enabled]'}`,
            `transport=${transport}`,
            transport === 'tcp'
                ? `endpoint=${endpoint}`
                : `command=${server.command}`,
            transport === 'tcp' && server.command ? `bootstrap=${server.command}` : undefined,
            `extensions=${server.extensions.join(',') || '-'}`,
            `languageId=${server.languageId ?? '-'}`,
            `timeout=${server.timeoutMs ?? 15_000}ms`,
        ].join(' '), dependencies);
    }
}

export function runShowLspServerCommand(
    name: string,
    options: LspOutputOptions,
    dependencies: LspCommandDependencies = {},
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

export async function runDoctorLspServersCommand(
    name: string | undefined,
    options: LspOutputOptions,
    dependencies: LspCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): Promise<void> {
    const { config } = resolveConfigWithEnvOverrides(manager.load());
    const configuredServers = config.lsp?.servers ?? [];
    const selectedServers = name
        ? configuredServers.filter((server) => server.name === name)
        : configuredServers;

    if (name && selectedServers.length === 0) {
        throw new Error(`LSP server not found: ${name}`);
    }

    const inspect = dependencies.inspectServers ?? inspectLspServers;
    const projectRoot = path.resolve(options.dir ?? '.');
    const inspections = await inspect({
        servers: selectedServers,
        cwd: projectRoot,
        projectRoot,
    });

    if (options.json) {
        writeOutput(JSON.stringify(inspections, null, 2), dependencies);
        return;
    }

    if (inspections.length === 0) {
        writeOutput('No LSP servers configured.', dependencies);
        return;
    }

    for (const inspection of inspections) {
        const capabilityFlags = [
            `symbols=${inspection.capabilities.workspaceSymbols ? 'yes' : 'no'}`,
            `definition=${inspection.capabilities.definition ? 'yes' : 'no'}`,
            `references=${inspection.capabilities.references ? 'yes' : 'no'}`,
            `diagnostics=${inspection.capabilities.diagnostics ? 'yes' : 'no'}`,
            `hover=${inspection.capabilities.hover ? 'yes' : 'no'}`,
            `completion=${inspection.capabilities.completion ? 'yes' : 'no'}`,
            `completionResolve=${inspection.capabilities.completionResolve ? 'yes' : 'no'}`,
            `rename=${inspection.capabilities.rename ? 'yes' : 'no'}`,
        ];
        writeOutput([
            `${inspection.name} ${inspection.status.toUpperCase()}`,
            `transport=${inspection.transport}`,
            inspection.transport === 'tcp'
                ? `endpoint=${inspection.host}:${inspection.port}`
                : `command=${inspection.command ?? '-'}`,
            inspection.transport === 'tcp' && inspection.command ? `bootstrap=${inspection.command}` : undefined,
            `extensions=${inspection.extensions.join(',') || '-'}`,
            `languageId=${inspection.languageId ?? '-'}`,
            ...capabilityFlags,
        ].join(' '), dependencies);

        if (inspection.serverInfo) {
            writeOutput(`server=${inspection.serverInfo.name}@${inspection.serverInfo.version ?? 'unknown'}`, dependencies);
        }

        if (inspection.error) {
            writeOutput(`error=${inspection.error}`, dependencies);
        }
    }
}

export function runAddLspServerCommand(
    name: string,
    options: LspAddOptions,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const current = manager.load();
    if ((current.lsp?.servers ?? []).some((server) => server.name === name)) {
        throw new Error(`LSP server already exists: ${name}`);
    }
    if (options.extension.length === 0) {
        throw new Error('At least one --extension is required');
    }
    const transport = normalizeTransport(options.transport);
    const args = options.arg;
    const env = parseEnvPairs(options.env);
    const initializationOptions = parseInitJson(options.initJson);
    const commonFields = {
        name,
        extensions: options.extension,
        languageId: options.languageId,
        env,
        cwd: options.cwd ? path.resolve(options.cwd) : undefined,
        enabled: !options.disabled,
        timeoutMs: options.timeoutMs,
        initializationOptions,
    };

    if (transport === 'stdio' && !options.command?.trim()) {
        throw new Error('stdio transport requires --command');
    }

    if (transport === 'tcp' && (!options.port || options.port <= 0)) {
        throw new Error('tcp transport requires a valid --port');
    }

    const nextServers = [
        ...(current.lsp?.servers ?? []),
        transport === 'tcp'
            ? {
                ...commonFields,
                transport: 'tcp' as const,
                host: options.host?.trim() || '127.0.0.1',
                port: options.port!,
                ...(options.command?.trim() ? { command: options.command.trim() } : {}),
                args,
            }
            : {
                ...commonFields,
                transport: 'stdio' as const,
                command: options.command!.trim(),
                args,
            },
    ];

    manager.update({
        lsp: {
            servers: nextServers,
        },
    });
    manager.save();
    logger.success(`Added LSP server: ${name}`);
}

export function runRemoveLspServerCommand(
    name: string,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const current = manager.load();
    const existingServers = current.lsp?.servers ?? [];
    const nextServers = existingServers.filter((server) => server.name !== name);

    if (nextServers.length === existingServers.length) {
        throw new Error(`LSP server not found: ${name}`);
    }

    manager.update({
        lsp: {
            servers: nextServers,
        },
    });
    manager.save();
    logger.success(`Removed LSP server: ${name}`);
}

export function runToggleLspServerCommand(
    name: string,
    enabled: boolean,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const current = manager.load();
    const nextServers = (current.lsp?.servers ?? []).map((server) => server.name === name
        ? { ...server, enabled }
        : server);

    if (nextServers.every((server) => server.name !== name)) {
        throw new Error(`LSP server not found: ${name}`);
    }

    manager.update({
        lsp: {
            servers: nextServers,
        },
    });
    manager.save();
    logger.success(`${enabled ? 'Enabled' : 'Disabled'} LSP server: ${name}`);
}

export function createLspCommand(
    manager: ConfigManager = configManager,
    dependencies: LspCommandDependencies = {},
): Command {
    const lspCommand = new Command('lsp')
        .description('Manage external Language Servers and runtime connectivity');

    lspCommand
        .command('list')
        .description('List configured LSP servers')
        .option('--json', 'Output in JSON format')
        .action((options: LspOutputOptions) => {
            try {
                runListLspServersCommand(options, dependencies, manager);
            } catch (error) {
                logger.error(`Failed to list LSP servers: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('show')
        .description('Show configuration for a single LSP server')
        .argument('<name>', 'server name')
        .option('--json', 'Output in JSON format')
        .action((name: string, options: LspOutputOptions) => {
            try {
                runShowLspServerCommand(name, options, dependencies, manager);
            } catch (error) {
                logger.error(`Failed to read LSP configuration: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('add')
        .description('Add a new LSP server (supports stdio/tcp)')
        .argument('<name>', 'server name')
        .option('--transport <transport>', 'Transport protocol (stdio/tcp)', 'stdio')
        .option('--command <command>', 'stdio start command; optional for tcp, can be used to start local bridge/server')
        .option('--arg <value>', 'Command argument, can be passed multiple times', collectOption, [])
        .option('--extension <ext>', 'Target file extension, can be passed multiple times', collectOption, [])
        .option('--host <host>', 'tcp target host', '127.0.0.1')
        .option('--port <port>', 'tcp target port', parseNumberOption)
        .option('--language-id <id>', 'languageId for didOpen')
        .option('--env <key=value>', 'Extra environment variable, can be passed multiple times', collectOption, [])
        .option('--cwd <dir>', 'server working directory')
        .option('--timeout-ms <ms>', 'Request timeout (milliseconds)', parseNumberOption, 15_000)
        .option('--init-json <json>', 'initialize.initializationOptions JSON')
        .option('--disabled', 'Keep disabled after adding')
        .action((name: string, options: LspAddOptions) => {
            try {
                runAddLspServerCommand(name, options, manager);
            } catch (error) {
                logger.error(`Failed to add LSP server: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('remove')
        .description('Remove an LSP server')
        .argument('<name>', 'server name')
        .action((name: string) => {
            try {
                runRemoveLspServerCommand(name, manager);
            } catch (error) {
                logger.error(`Failed to remove LSP server: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('enable')
        .description('Enable an LSP server')
        .argument('<name>', 'server name')
        .action((name: string) => {
            try {
                runToggleLspServerCommand(name, true, manager);
            } catch (error) {
                logger.error(`Failed to enable LSP server: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('disable')
        .description('Disable an LSP server')
        .argument('<name>', 'server name')
        .action((name: string) => {
            try {
                runToggleLspServerCommand(name, false, manager);
            } catch (error) {
                logger.error(`Failed to disable LSP server: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('doctor')
        .description('Connectivity check: start LSP server and check core capabilities')
        .argument('[name]', 'Check specific server only')
        .option('-d, --dir <dir>', 'Project directory used as workspace root', '.')
        .option('--json', 'Output in JSON format')
        .action(async (name: string | undefined, options: LspOutputOptions) => {
            try {
                await runDoctorLspServersCommand(name, options, dependencies, manager);
            } catch (error) {
                logger.error(`LSP check failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand.addCommand(createLspUiCommand());

    return lspCommand;
}

export const lspCommand = createLspCommand();

function findServerOrThrow(config: XQoderConfig, name: string): LSPServerConfig {
    const server = (config.lsp?.servers ?? []).find((entry) => entry.name === name);
    if (!server) {
        throw new Error(`LSP server not found: ${name}`);
    }
    return server;
}

function parseEnvPairs(entries: string[]): Record<string, string> {
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

function parseInitJson(value: string | undefined): Record<string, unknown> | undefined {
    if (!value) {
        return undefined;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        throw new Error(`--init-json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('--init-json must be a JSON object');
    }

    return parsed as Record<string, unknown>;
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

function normalizeTransport(value: string | undefined): 'stdio' | 'tcp' {
    if (!value || value === 'stdio') {
        return 'stdio';
    }
    if (value === 'tcp') {
        return 'tcp';
    }
        throw new Error(`Unsupported transport: ${value}`);
}

function writeOutput(output: string, dependencies: LspCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}

export function hasLspCommand(command: string): boolean {
    return commandExists(command);
}

function isTcpServerConfig(server: LSPServerConfig): server is LSPTcpServerConfig {
    return server.transport === 'tcp';
}
