import * as path from 'node:path';
import {
    createMcpAuthProvider,
    createStandaloneMcpClient,
    FileMcpTokenStore,
    type McpClientAdapter,
    type McpTokenStore,
} from '@xqoder/agent';
import {
    ConfigManager,
    configManager,
    resolveConfigWithEnvOverrides,
    type MCPServerConfig,
    type SandboxMode,
} from '@xqoder/shared';
import {
    collectMcpOAuthStatuses,
    defaultTokenStorePath,
    type McpOAuthStatus,
} from './mcp-oauth-status.js';

export interface McpDebugCommandOptions {
    dir?: string;
    cwd?: string;
    json?: boolean;
}

export interface McpDebugCommandDependencies {
    writeOutput?: (output: string) => void;
    store?: McpTokenStore;
    tokenFilePath?: string;
    createClient?: (
        server: MCPServerConfig,
        options: {
            cwd: string;
            projectRoot: string;
            sandboxMode?: SandboxMode;
            allowedPaths?: string[];
        },
    ) => McpClientAdapter;
    now?: () => number;
    env?: NodeJS.ProcessEnv;
}

export interface McpDebugCommandResult {
    name: string;
    enabled: boolean;
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    url?: string;
    args: string[];
    cwd?: string;
    oauth: McpOAuthStatus;
    handshake: McpDebugHandshake;
    tools: string[];
    error?: string;
}

export interface McpDebugHandshake {
    status: 'ok' | 'error' | 'disabled';
    protocolVersion?: string;
    serverName?: string;
    serverVersion?: string;
    toolCount: number;
    promptCount: number;
    resourceCount: number;
    resourceTemplateCount: number;
    error?: string;
}

export async function runDebugMcpCommand(
    name: string,
    options: McpDebugCommandOptions = {},
    dependencies: McpDebugCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): Promise<McpDebugCommandResult> {
    const projectRoot = path.resolve(options.dir ?? options.cwd ?? process.cwd());
    const { config } = resolveConfigWithEnvOverrides(manager.load({ cwd: projectRoot }));
    const server = (config.mcp?.servers ?? []).find((entry) => entry.name === name);
    if (!server) {
        throw new Error(`MCP server "${name}" not found.`);
    }

    const tokenFilePath = dependencies.tokenFilePath ?? defaultTokenStorePath();
    const store = dependencies.store ?? new FileMcpTokenStore(tokenFilePath);
    const statuses = await collectMcpOAuthStatuses({
        servers: [server],
        store,
        tokenFilePath,
        ...(dependencies.now ? { now: dependencies.now } : {}),
        ...(dependencies.env ? { env: dependencies.env } : {}),
    });
    const oauth = statuses.get(server.name) ?? createEmptyStatus();

    const result: McpDebugCommandResult = {
        name: server.name,
        enabled: server.enabled !== false,
        transport: server.transport ?? 'stdio',
        args: server.args ?? [],
        cwd: server.cwd,
        ...(server.command ? { command: server.command } : {}),
        ...(server.url ? { url: server.url } : {}),
        oauth,
        handshake: { status: 'disabled', toolCount: 0, promptCount: 0, resourceCount: 0, resourceTemplateCount: 0 },
        tools: [],
    };

    if (!result.enabled) {
        writeDebugResult(result, options, dependencies);
        return result;
    }

    try {
        const clientOptions = {
            cwd: projectRoot,
            projectRoot,
            ...(config.sandbox?.mode ? { sandboxMode: config.sandbox.mode } : {}),
            ...(config.sandbox?.allowedPaths ? { allowedPaths: config.sandbox.allowedPaths } : {}),
        };
        const authProvider = createMcpAuthProvider(server, {
            store,
            ...(dependencies.now ? { now: dependencies.now } : {}),
        });
        const client = dependencies.createClient
            ? dependencies.createClient(server, clientOptions)
            : createStandaloneMcpClient(server, {
                servers: [server],
                ...clientOptions,
                ...(authProvider ? { authProvider } : {}),
            });
        try {
            const [tools, prompts, resources, templates] = await Promise.all([
                client.listTools(),
                client.supportsPrompts() ? client.listPrompts() : Promise.resolve([]),
                client.supportsResources() ? client.listResources() : Promise.resolve([]),
                client.supportsResources() ? client.listResourceTemplates() : Promise.resolve([]),
            ]);
            result.handshake = {
                status: 'ok',
                ...(client.protocolVersion ? { protocolVersion: client.protocolVersion } : {}),
                ...(client.serverInfo ? {
                    serverName: client.serverInfo.name,
                    serverVersion: client.serverInfo.version,
                } : {}),
                toolCount: tools.length,
                promptCount: prompts.length,
                resourceCount: resources.length,
                resourceTemplateCount: templates.length,
            };
            result.tools = tools.map((tool) => tool.name);
        } finally {
            await client.close().catch((): undefined => undefined);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.handshake = {
            status: 'error',
            toolCount: 0,
            promptCount: 0,
            resourceCount: 0,
            resourceTemplateCount: 0,
            error: message,
        };
        result.error = message;
    }

    writeDebugResult(result, options, dependencies);
    return result;
}

function writeDebugResult(
    result: McpDebugCommandResult,
    options: McpDebugCommandOptions,
    dependencies: McpDebugCommandDependencies,
): void {
    const write = dependencies.writeOutput ?? console.log;
    if (options.json) {
        write(JSON.stringify(result, null, 2));
        return;
    }
    write(formatDebugResult(result));
}

function formatDebugResult(result: McpDebugCommandResult): string {
    const lines = [
        `${result.name} transport=${result.transport} enabled=${result.enabled ? 'yes' : 'no'}`,
    ];
    if (result.url) lines.push(`  url=${result.url}`);
    if (result.command) lines.push(`  command=${result.command}`);
    lines.push(`  handshake=${result.handshake.status}`);
    if (result.handshake.status === 'ok') {
        if (result.handshake.serverName) {
            lines.push(`  server=${result.handshake.serverName}@${result.handshake.serverVersion ?? '?'} protocol=${result.handshake.protocolVersion ?? '?'}`);
        }
        lines.push(`  tools=${result.handshake.toolCount} prompts=${result.handshake.promptCount} resources=${result.handshake.resourceCount} templates=${result.handshake.resourceTemplateCount}`);
        if (result.tools.length > 0) {
            lines.push(`  tool names=${result.tools.join(', ')}`);
        }
    } else if (result.handshake.status === 'error') {
        lines.push(`  error=${result.handshake.error ?? 'unknown'}`);
    }
    lines.push(`  oauth.configured=${result.oauth.configured ? 'yes' : 'no'}`);
    if (result.oauth.configured) {
        lines.push(`  oauth.disabledByEnv=${result.oauth.disabledByEnv ? 'yes' : 'no'}`);
        lines.push(`  oauth.token=${result.oauth.tokenPresent ? (result.oauth.tokenExpired ? 'expired' : 'ok') : 'missing'}`);
        if (result.oauth.tokenExpiresAt !== undefined) {
            lines.push(`  oauth.expiresAt=${new Date(result.oauth.tokenExpiresAt).toISOString()}`);
        }
        if (result.oauth.tokenFileMode) {
            const warn = result.oauth.tokenFileWorldReadable ? ' (world-readable!)' : '';
            lines.push(`  oauth.tokenFile=${result.oauth.tokenFilePath} mode=${result.oauth.tokenFileMode}${warn}`);
        }
    }
    return lines.join('\n');
}

function createEmptyStatus(): McpOAuthStatus {
    return {
        configured: false,
        disabledByEnv: false,
        tokenPresent: false,
        tokenExpired: false,
        refreshTokenPresent: false,
    };
}
