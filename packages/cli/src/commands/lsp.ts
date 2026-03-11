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
        throw new Error(`未找到 LSP server: ${name}`);
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
        throw new Error(`LSP server 已存在: ${name}`);
    }
    if (options.extension.length === 0) {
        throw new Error('至少需要一个 --extension');
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
        throw new Error('stdio transport 需要 --command');
    }

    if (transport === 'tcp' && (!options.port || options.port <= 0)) {
        throw new Error('tcp transport 需要合法的 --port');
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
    logger.success(`已添加 LSP server: ${name}`);
}

export function runRemoveLspServerCommand(
    name: string,
    manager: Pick<ConfigManager, 'load' | 'update' | 'save'> = configManager,
): void {
    const current = manager.load();
    const existingServers = current.lsp?.servers ?? [];
    const nextServers = existingServers.filter((server) => server.name !== name);

    if (nextServers.length === existingServers.length) {
        throw new Error(`未找到 LSP server: ${name}`);
    }

    manager.update({
        lsp: {
            servers: nextServers,
        },
    });
    manager.save();
    logger.success(`已移除 LSP server: ${name}`);
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
        throw new Error(`未找到 LSP server: ${name}`);
    }

    manager.update({
        lsp: {
            servers: nextServers,
        },
    });
    manager.save();
    logger.success(`${enabled ? '已启用' : '已禁用'} LSP server: ${name}`);
}

export function createLspCommand(
    manager: ConfigManager = configManager,
    dependencies: LspCommandDependencies = {},
): Command {
    const lspCommand = new Command('lsp')
        .description('管理外部 Language Servers 和运行时连通性');

    lspCommand
        .command('list')
        .description('列出已配置的 LSP servers')
        .option('--json', '以 JSON 输出')
        .action((options: LspOutputOptions) => {
            try {
                runListLspServersCommand(options, dependencies, manager);
            } catch (error) {
                logger.error(`LSP 列表失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('show')
        .description('显示单个 LSP server 配置')
        .argument('<name>', 'server 名称')
        .option('--json', '以 JSON 输出')
        .action((name: string, options: LspOutputOptions) => {
            try {
                runShowLspServerCommand(name, options, dependencies, manager);
            } catch (error) {
                logger.error(`LSP 配置读取失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('add')
        .description('新增一个 LSP server（支持 stdio/tcp）')
        .argument('<name>', 'server 名称')
        .option('--transport <transport>', '传输方式 (stdio/tcp)', 'stdio')
        .option('--command <command>', 'stdio 启动命令；tcp 下可选，可用于先启动本地 bridge/server')
        .option('--arg <value>', '命令参数，可重复传入', collectOption, [])
        .option('--extension <ext>', '负责的文件扩展名，可重复传入', collectOption, [])
        .option('--host <host>', 'tcp 目标主机', '127.0.0.1')
        .option('--port <port>', 'tcp 目标端口', parseNumberOption)
        .option('--language-id <id>', 'didOpen 使用的 languageId')
        .option('--env <key=value>', '额外环境变量，可重复传入', collectOption, [])
        .option('--cwd <dir>', 'server 工作目录')
        .option('--timeout-ms <ms>', '请求超时（毫秒）', parseNumberOption, 15_000)
        .option('--init-json <json>', 'initialize.initializationOptions JSON')
        .option('--disabled', '新增后保持禁用状态')
        .action((name: string, options: LspAddOptions) => {
            try {
                runAddLspServerCommand(name, options, manager);
            } catch (error) {
                logger.error(`添加 LSP server 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('remove')
        .description('移除一个 LSP server')
        .argument('<name>', 'server 名称')
        .action((name: string) => {
            try {
                runRemoveLspServerCommand(name, manager);
            } catch (error) {
                logger.error(`移除 LSP server 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('enable')
        .description('启用一个 LSP server')
        .argument('<name>', 'server 名称')
        .action((name: string) => {
            try {
                runToggleLspServerCommand(name, true, manager);
            } catch (error) {
                logger.error(`启用 LSP server 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('disable')
        .description('禁用一个 LSP server')
        .argument('<name>', 'server 名称')
        .action((name: string) => {
            try {
                runToggleLspServerCommand(name, false, manager);
            } catch (error) {
                logger.error(`禁用 LSP server 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });

    lspCommand
        .command('doctor')
        .description('连通性检查：启动 LSP server 并检查核心能力')
        .argument('[name]', '只检查指定 server')
        .option('-d, --dir <dir>', '作为 workspace root 的项目目录', '.')
        .option('--json', '以 JSON 输出')
        .action(async (name: string | undefined, options: LspOutputOptions) => {
            try {
                await runDoctorLspServersCommand(name, options, dependencies, manager);
            } catch (error) {
                logger.error(`LSP 检查失败: ${error instanceof Error ? error.message : String(error)}`);
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
        throw new Error(`未找到 LSP server: ${name}`);
    }
    return server;
}

function parseEnvPairs(entries: string[]): Record<string, string> {
    return Object.fromEntries(entries.map((entry) => {
        const separatorIndex = entry.indexOf('=');
        if (separatorIndex <= 0) {
            throw new Error(`无效的 --env 参数: ${entry}`);
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
        throw new Error(`--init-json 不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('--init-json 必须是 JSON object');
    }

    return parsed as Record<string, unknown>;
}

function collectOption(value: string, previous: string[]): string[] {
    return [...previous, value];
}

function parseNumberOption(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`数值无效: ${value}`);
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
    throw new Error(`不支持的 transport: ${value}`);
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
