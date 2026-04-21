import {
    ConfigManager,
    configManager,
    type MCPServerConfig,
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

export interface McpCommandDependencies {
    writeOutput?: (output: string) => void;
}

export interface McpServerSummary {
    name: string;
    enabled: boolean;
    transport: string;
    source: string;
}

export interface McpSnapshot {
    cwd: string;
    servers: McpServerSummary[];
}

interface McpConfigFragment extends Partial<XQoderConfig> {
    mcpServers?: MCPServerConfig[];
}

export function createMcpSnapshot(
    options: McpOutputOptions = {},
    manager: Pick<ConfigManager, 'load' | 'getLoadMetadata'> = configManager,
): McpSnapshot {
    const snapshot = createLayeredConfigSnapshot(options, manager);
    const servers: McpServerSummary[] = [];

    // Combine servers from all sources
    for (const source of snapshot.sources) {
        const sourceConfig = readMcpFragment(source.path);
        const configuredServers = sourceConfig.mcp?.servers ?? sourceConfig.mcpServers ?? [];
        for (const server of configuredServers) {
            servers.push({
                name: server.name,
                enabled: server.enabled !== false,
                transport: server.transport ?? 'stdio',
                source: source.path,
            });
        }
    }

    return {
        cwd: snapshot.cwd,
        servers,
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
        lines.push(`- ${server.name} (${server.transport}) [${server.enabled ? 'enabled' : 'disabled'}] source: ${server.source}`);
    }

    writeOutput(lines.join('\n'), dependencies);
    return snapshot;
}

export function runAddMcpCommand(
    name: string,
    command: string,
    args: string[],
    options: McpOutputOptions = {},
    dependencies: McpCommandDependencies = {},
): void {
    const target = resolveConfigWriteTarget(options);
    const config = target.manager.load({ mode: 'single' });
    const mcpServers = config.mcp?.servers ?? [];

    if (mcpServers.some((server) => server.name === name)) {
        throw new Error(`MCP server with name "${name}" already exists in ${target.scope} config.`);
    }

    const newServer: MCPServerConfig = {
        name,
        transport: 'stdio',
        command,
        args,
        enabled: true,
    };

    target.manager.set({
        ...config,
        mcp: {
            servers: [...mcpServers, newServer],
        },
    });
    target.manager.save();

    const message = `Added MCP server "${name}" to ${target.scope} config (${target.path}).`;
    if (options.json) {
        writeOutput(JSON.stringify({ message, server: newServer }, null, 2), dependencies);
    } else {
        writeOutput(message, dependencies);
    }
}

export function runRemoveMcpCommand(
    name: string,
    options: McpOutputOptions = {},
    dependencies: McpCommandDependencies = {},
): void {
    const target = resolveConfigWriteTarget(options);
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

    const message = `Removed MCP server "${name}" from ${target.scope} config (${target.path}).`;
    if (options.json) {
        writeOutput(JSON.stringify({ message }, null, 2), dependencies);
    } else {
        writeOutput(message, dependencies);
    }
}

function readMcpFragment(filePath: string): McpConfigFragment {
    try {
        const fs = require('node:fs');
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as McpConfigFragment;
    } catch {
        return {};
    }
}

function writeOutput(output: string, dependencies: McpCommandDependencies): void {
    (dependencies.writeOutput ?? console.log)(output);
}
