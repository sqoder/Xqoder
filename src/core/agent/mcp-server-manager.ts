import { logger as defaultLogger, type Logger, type MCPServerConfig } from '@xqoder/shared';
import type { ITool } from './tools/tool.js';
import {
    createReservedAlias,
    createToolAlias,
} from './mcp-utils.js';
import {
    McpGetPromptTool,
    McpListPromptsTool,
    McpListResourcesTool,
    McpReadResourceTool,
    McpRemoteTool,
} from './mcp-tools.js';
import { inspectMcpServersWithClientFactory } from './mcp-inspection.js';
import type { McpServerInspection } from './mcp-inspection.js';
import { McpHttpClient } from './mcp-http-client.js';
import { McpStdioClient } from './mcp-stdio-client.js';
import type {
    McpClientAdapter,
    McpManagerOptions,
} from './mcp-types.js';

export type McpClientFactory = (
    server: MCPServerConfig,
    options: Omit<McpManagerOptions, 'servers'>,
) => McpClientAdapter;

export class McpServerManager {
    private readonly clients = new Map<string, McpClientAdapter>();
    private readonly logger: Logger;

    constructor(
        private readonly options: McpManagerOptions,
        private readonly createClient: McpClientFactory = createDefaultMcpClient,
    ) {
        this.logger = (options.logger ?? defaultLogger).child('MCP');
    }

    async listTools(): Promise<ITool[]> {
        const tools: ITool[] = [];
        const aliases = new Set<string>();

        for (const server of this.options.servers) {
            if (server.enabled === false) {
                continue;
            }

            try {
                const client = this.getClient(server);
                const remoteTools = await client.listTools();
                for (const descriptor of remoteTools) {
                    const alias = createToolAlias(server.name, descriptor.name, aliases);
                    tools.push(new McpRemoteTool(alias, server.name, descriptor, client));
                }
                if (client.supportsResources()) {
                    tools.push(new McpListResourcesTool(
                        server.name,
                        createReservedAlias(server.name, 'resources.list', aliases),
                        client,
                    ));
                    tools.push(new McpReadResourceTool(
                        server.name,
                        createReservedAlias(server.name, 'resources.read', aliases),
                        client,
                    ));
                }
                if (client.supportsPrompts()) {
                    tools.push(new McpListPromptsTool(
                        server.name,
                        createReservedAlias(server.name, 'prompts.list', aliases),
                        client,
                    ));
                    tools.push(new McpGetPromptTool(
                        server.name,
                        createReservedAlias(server.name, 'prompts.get', aliases),
                        client,
                    ));
                }
            } catch (error) {
                this.logger.warn(`MCP server ${server.name} unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        return tools;
    }

    async dispose(): Promise<void> {
        await Promise.all(
            Array.from(this.clients.values(), (client) => client.close()),
        );
        this.clients.clear();
    }

    private getClient(server: MCPServerConfig): McpClientAdapter {
        const existing = this.clients.get(server.name);
        if (existing) {
            return existing;
        }

        const client = this.createClient(server, {
            cwd: this.options.cwd,
            projectRoot: this.options.projectRoot,
            sandboxMode: this.options.sandboxMode,
            allowedPaths: this.options.allowedPaths,
            logger: this.logger,
        });

        this.clients.set(server.name, client);
        return client;
    }
}

export function createDefaultMcpClient(
    server: MCPServerConfig,
    options: Omit<McpManagerOptions, 'servers'>,
): McpClientAdapter {
    if (server.transport === 'http' || server.transport === 'sse') {
        return new McpHttpClient(server, options);
    }
    return new McpStdioClient(server, options);
}

export function createStandaloneMcpClient(server: MCPServerConfig, options: McpManagerOptions): McpClientAdapter {
    return createDefaultMcpClient(server, {
        cwd: options.cwd,
        projectRoot: options.projectRoot,
        sandboxMode: options.sandboxMode,
        allowedPaths: options.allowedPaths,
        logger: options.logger,
    });
}

export async function inspectMcpServers(options: McpManagerOptions): Promise<McpServerInspection[]> {
    return inspectMcpServersWithClientFactory(
        options,
        (server) => createStandaloneMcpClient(server, options),
    );
}
