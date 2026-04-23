import * as fs from 'node:fs';
import * as path from 'node:path';
import { inspectMcpServers, type McpServerInspection } from '@xqoder/agent';
import {
    ConfigManager,
    configManager,
    resolveConfigWithEnvOverrides,
    type MCPServerConfig,
    type SandboxMode,
    type XQoderConfig,
} from '@xqoder/shared';
import {
    createLayeredConfigSnapshot,
    resolveConfigWriteTarget,
    type ConfigWriteScope,
} from '../system/config-targets.js';

export interface McpOutputOptions {
    cwd?: string;
    dir?: string;
    json?: boolean;
    scope?: ConfigWriteScope;
}

export interface McpAddOptions {
    dir?: string;
    json?: boolean;
    scope?: ConfigWriteScope;
    transport?: string;
    command?: string;
    url?: string;
    arg?: string[];
    env?: string[];
    header?: string[];
    cwd?: string;
    timeoutMs?: number;
    disabled?: boolean;
}

export interface McpCommandDependencies {
    inspectServers?: (options: {
        servers: MCPServerConfig[];
        cwd: string;
        projectRoot: string;
        sandboxMode?: SandboxMode;
        allowedPaths?: string[];
    }) => Promise<McpServerInspection[]>;
    writeOutput?: (output: string) => void;
}

export interface McpServerSummary {
    name: string;
    enabled: boolean;
    transport: string;
    source: string;
    command?: string;
    url?: string;
    timeoutMs?: number;
}

export interface McpSnapshot {
    cwd: string;
    servers: McpServerSummary[];
}

export interface McpServerDetail extends MCPServerConfig {
    source: string;
}

export interface McpWriteResult {
    message: string;
    scope: ConfigWriteScope;
    path: string;
    server?: MCPServerConfig;
}

interface McpConfigFragment extends Partial<XQoderConfig> {
    mcpServers?: MCPServerConfig[];
}

interface McpServerRecord {
    server: MCPServerConfig;
    source: string;
}

const DEFAULT_MCP_TIMEOUT_MS = 15_000;

export function createMcpSnapshot(
    options: McpOutputOptions = {},
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'> = configManager,
): McpSnapshot {
    const cwd = resolveProjectCwd(options);
    const records = createMcpServerRecords({ ...options, cwd }, manager);

    return {
        cwd,
        servers: records.map(({ server, source }) => ({
            name: server.name,
            enabled: server.enabled !== false,
            transport: server.transport ?? 'stdio',
            source,
            ...(server.command ? { command: server.command } : {}),
            ...(server.url ? { url: server.url } : {}),
            ...(server.timeoutMs ? { timeoutMs: server.timeoutMs } : {}),
        })),
    };
}

export function runListMcpCommand(
    options: McpOutputOptions = {},
    dependencies: McpCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'> = configManager,
): McpSnapshot {
    const snapshot = createMcpSnapshot(options, manager);
    if (options.json) {
        writeOutput(JSON.stringify(snapshot, null, 2), dependencies);
        return snapshot;
    }

    if (snapshot.servers.length === 0) {
        writeOutput('No MCP servers configured.', dependencies);
        return snapshot;
    }

    const lines = ['Configured MCP servers:'];
    for (const server of snapshot.servers) {
        const target = server.url ?? server.command ?? '-';
        lines.push([
            `- ${server.name}`,
            `(${server.transport})`,
            `[${server.enabled ? 'enabled' : 'disabled'}]`,
            `target: ${target}`,
            `source: ${server.source}`,
        ].join(' '));
    }

    writeOutput(lines.join('\n'), dependencies);
    return snapshot;
}

export function runShowMcpCommand(
    name: string,
    options: McpOutputOptions = {},
    dependencies: McpCommandDependencies = {},
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'> = configManager,
): McpServerDetail {
    const record = findMcpServerRecord(name, options, manager);
    const detail: McpServerDetail = {
        ...record.server,
        source: record.source,
    };
    const output = JSON.stringify(detail, null, 2);

    writeOutput(output, dependencies);
    return detail;
}

export async function runDoctorMcpCommand(
    name: string | undefined,
    options: McpOutputOptions = {},
    dependencies: McpCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): Promise<McpServerInspection[]> {
    const projectRoot = resolveProjectCwd(options);
    const { config } = resolveConfigWithEnvOverrides(manager.load({ cwd: projectRoot }));
    const configuredServers = config.mcp?.servers ?? [];
    const selectedServers = name
        ? configuredServers.filter((server) => server.name === name)
        : configuredServers;

    if (name && selectedServers.length === 0) {
        throw new Error(`MCP server not found: ${name}`);
    }

    const inspect = dependencies.inspectServers ?? inspectMcpServers;
    const inspections = await inspect({
        servers: selectedServers,
        cwd: projectRoot,
        projectRoot,
        sandboxMode: config.sandbox?.mode,
        allowedPaths: config.sandbox?.allowedPaths,
    });

    if (options.json) {
        writeOutput(JSON.stringify(inspections, null, 2), dependencies);
        return inspections;
    }

    if (inspections.length === 0) {
        writeOutput('No MCP servers configured.', dependencies);
        return inspections;
    }

    for (const inspection of inspections) {
        writeOutput(formatMcpInspection(inspection), dependencies);
    }
    return inspections;
}

export function runAddMcpCommand(
    name: string,
    command: string,
    args: string[],
    options: McpOutputOptions = {},
    dependencies: McpCommandDependencies = {},
): McpWriteResult {
    return runAddMcpServerCommand(name, {
        dir: options.dir ?? options.cwd,
        json: options.json,
        scope: options.scope,
        transport: 'stdio',
        command,
        arg: args,
    }, dependencies);
}

export function runAddMcpServerCommand(
    name: string,
    options: McpAddOptions = {},
    dependencies: McpCommandDependencies = {},
): McpWriteResult {
    const target = resolveConfigWriteTarget({
        cwd: path.resolve(options.dir ?? process.cwd()),
        scope: options.scope,
    });
    const config = target.manager.load({ mode: 'single' });
    const mcpServers = config.mcp?.servers ?? [];

    if (mcpServers.some((server) => server.name === name)) {
        throw new Error(`MCP server with name "${name}" already exists in ${target.scope} config.`);
    }

    const newServer = buildMcpServerConfigFromOptions(name, options);
    target.manager.set({
        ...config,
        mcp: {
            servers: [...mcpServers, newServer],
        },
    });
    target.manager.save();

    const result: McpWriteResult = {
        message: `Added MCP server "${name}" to ${target.scope} config (${target.path}).`,
        scope: target.scope,
        path: target.path,
        server: newServer,
    };
    writeMcpWriteResult(result, options, dependencies);
    return result;
}

export function runRemoveMcpCommand(
    name: string,
    options: McpOutputOptions = {},
    dependencies: McpCommandDependencies = {},
): McpWriteResult {
    const target = resolveConfigWriteTarget({
        cwd: resolveProjectCwd(options),
        scope: options.scope,
    });
    const config = target.manager.load({ mode: 'single' });
    const mcpServers = config.mcp?.servers ?? [];
    const filtered = mcpServers.filter((server) => server.name !== name);

    if (filtered.length === mcpServers.length) {
        throw new Error(`MCP server "${name}" not found in ${target.scope} config.`);
    }

    target.manager.set({
        ...config,
        mcp: {
            servers: filtered,
        },
    });
    target.manager.save();

    const result: McpWriteResult = {
        message: `Removed MCP server "${name}" from ${target.scope} config (${target.path}).`,
        scope: target.scope,
        path: target.path,
    };
    writeMcpWriteResult(result, options, dependencies);
    return result;
}

export function runToggleMcpCommand(
    name: string,
    enabled: boolean,
    options: McpOutputOptions = {},
    dependencies: McpCommandDependencies = {},
): McpWriteResult {
    const target = resolveConfigWriteTarget({
        cwd: resolveProjectCwd(options),
        scope: options.scope,
    });
    const config = target.manager.load({ mode: 'single' });
    const mcpServers = config.mcp?.servers ?? [];
    let changed = false;
    const nextServers = mcpServers.map((server) => {
        if (server.name !== name) {
            return server;
        }
        changed = true;
        return { ...server, enabled };
    });

    if (!changed) {
        throw new Error(`MCP server "${name}" not found in ${target.scope} config.`);
    }

    target.manager.set({
        ...config,
        mcp: {
            servers: nextServers,
        },
    });
    target.manager.save();

    const result: McpWriteResult = {
        message: `${enabled ? 'Enabled' : 'Disabled'} MCP server "${name}" in ${target.scope} config (${target.path}).`,
        scope: target.scope,
        path: target.path,
        server: nextServers.find((server) => server.name === name),
    };
    writeMcpWriteResult(result, options, dependencies);
    return result;
}

export function runMcpCommand(fn: () => unknown | Promise<unknown>): void | Promise<void> {
    try {
        const result = fn();
        if (result && typeof (result as Promise<unknown>).then === 'function') {
            return Promise.resolve(result).then((): void => undefined).catch((error: unknown): never => {
                failMcpCommand(error);
            });
        }
        return undefined;
    } catch (error) {
        failMcpCommand(error);
    }
}

function createMcpServerRecords(
    options: McpOutputOptions,
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'>,
): McpServerRecord[] {
    const snapshot = createLayeredConfigSnapshot({
        cwd: resolveProjectCwd(options),
    }, manager);
    const servers: McpServerRecord[] = [];

    for (const source of snapshot.sources) {
        const sourceConfig = readMcpFragment(source.path);
        const configuredServers = sourceConfig.mcp?.servers ?? sourceConfig.mcpServers ?? [];
        for (const server of configuredServers) {
            servers.push({
                server,
                source: source.path,
            });
        }
    }

    if (servers.length > 0) {
        return servers;
    }

    return (snapshot.config.mcp?.servers ?? []).map((server) => ({
        server,
        source: 'effective',
    }));
}

function findMcpServerRecord(
    name: string,
    options: McpOutputOptions,
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'>,
): McpServerRecord {
    const record = createMcpServerRecords(options, manager)
        .find((entry) => entry.server.name === name);
    if (!record) {
        throw new Error(`MCP server "${name}" not found.`);
    }
    return record;
}

function buildMcpServerConfigFromOptions(name: string, options: McpAddOptions): MCPServerConfig {
    const transport = normalizeMcpTransport(options.transport);
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    if (transport === 'http' || transport === 'sse') {
        if (!options.url?.trim()) {
            throw new Error(`${transport} transport requires --url`);
        }
        return {
            name,
            transport,
            url: options.url.trim(),
            headers: parseKeyValuePairs(options.header, '--header'),
            enabled: !options.disabled,
            timeoutMs,
        };
    }

    if (!options.command?.trim()) {
        throw new Error('stdio transport requires --command or a positional command');
    }

    return {
        name,
        transport: 'stdio',
        command: options.command.trim(),
        args: options.arg ?? [],
        env: parseKeyValuePairs(options.env, '--env'),
        cwd: options.cwd ? path.resolve(options.cwd) : undefined,
        enabled: !options.disabled,
        timeoutMs,
    };
}

function normalizeMcpTransport(value: string | undefined): 'stdio' | 'http' | 'sse' {
    const raw = (value ?? 'stdio').trim().toLowerCase();
    if (raw === 'stdio' || raw === 'http' || raw === 'sse') {
        return raw;
    }
    throw new Error(`Unsupported MCP transport: ${value}`);
}

function normalizeTimeoutMs(value: number | undefined): number {
    return Number.isFinite(value) && (value ?? 0) > 0
        ? Number(value)
        : DEFAULT_MCP_TIMEOUT_MS;
}

function parseKeyValuePairs(entries: string[] = [], flagName: string): Record<string, string> {
    return Object.fromEntries(entries.map((entry) => {
        const separatorIndex = entry.indexOf('=');
        if (separatorIndex <= 0) {
            throw new Error(`Invalid ${flagName} argument: ${entry}`);
        }
        const key = entry.slice(0, separatorIndex).trim();
        const value = entry.slice(separatorIndex + 1);
        return [key, value];
    }));
}

function readMcpFragment(filePath: string): McpConfigFragment {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as McpConfigFragment;
    } catch {
        return {};
    }
}

function resolveProjectCwd(options: Pick<McpOutputOptions, 'cwd' | 'dir'> = {}): string {
    return path.resolve(options.dir ?? options.cwd ?? process.cwd());
}

function formatMcpInspection(inspection: McpServerInspection): string {
    const status = inspection.status.toUpperCase();
    const lines = [
        `${inspection.name} ${status} transport=${inspection.transport} tools=${inspection.toolCount} prompts=${inspection.promptCount} resources=${inspection.resourceCount} templates=${inspection.resourceTemplateCount}`,
    ];
    if (inspection.url) {
        lines.push(`url=${inspection.url}`);
    }
    if (inspection.serverInfo) {
        lines.push(`server=${inspection.serverInfo.name}@${inspection.serverInfo.version} protocol=${inspection.protocolVersion ?? 'unknown'}`);
    }
    if (inspection.error) {
        lines.push(`error=${inspection.error}`);
    }
    if (inspection.tools.length > 0) {
        lines.push(`tools=${inspection.tools.map((tool) => tool.name).join(', ')}`);
    }
    if (inspection.prompts.length > 0) {
        lines.push(`prompts=${inspection.prompts.map((prompt) => prompt.name).join(', ')}`);
    }
    if (inspection.resources.length > 0) {
        lines.push(`resources=${inspection.resources.map((resource) => resource.uri).join(', ')}`);
    }
    if (inspection.resourceTemplates.length > 0) {
        lines.push(`resourceTemplates=${inspection.resourceTemplates.map((template) => template.uriTemplate).join(', ')}`);
    }
    return lines.join('\n');
}

function writeMcpWriteResult(
    result: McpWriteResult,
    options: Pick<McpOutputOptions, 'json'>,
    dependencies: McpCommandDependencies,
): void {
    if (options.json) {
        writeOutput(JSON.stringify(result, null, 2), dependencies);
        return;
    }
    writeOutput(result.message, dependencies);
}

function writeOutput(output: string, dependencies: McpCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}

function failMcpCommand(error: unknown): never {
    process.stderr.write(`mcp command failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
}
