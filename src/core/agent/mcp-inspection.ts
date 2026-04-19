import type { MCPServerConfig } from '@xqoder/shared';
import type {
    McpClientAdapter,
    McpServerInfo,
} from './mcp.js';

export interface McpServerInspection {
    name: string;
    enabled: boolean;
    status: 'ok' | 'error' | 'disabled';
    transport: 'stdio' | 'http' | 'sse';
    command: string;
    url?: string;
    args: string[];
    cwd?: string;
    protocolVersion?: string;
    serverInfo?: McpServerInfo;
    toolCount: number;
    tools: Array<{
        name: string;
        title?: string;
        description?: string;
    }>;
    promptCount: number;
    prompts: Array<{
        name: string;
        title?: string;
        description?: string;
    }>;
    resourceCount: number;
    resources: Array<{
        uri: string;
        name: string;
        title?: string;
        description?: string;
    }>;
    resourceTemplateCount: number;
    resourceTemplates: Array<{
        uriTemplate: string;
        name: string;
        title?: string;
        description?: string;
    }>;
    error?: string;
}

export interface McpInspectionOptions {
    servers: MCPServerConfig[];
}

export type McpInspectionClientFactory = (
    server: MCPServerConfig,
    options: McpInspectionOptions,
) => McpClientAdapter;

export async function inspectMcpServersWithClientFactory(
    options: McpInspectionOptions,
    createClient: McpInspectionClientFactory,
): Promise<McpServerInspection[]> {
    const inspections: McpServerInspection[] = [];

    for (const server of options.servers) {
        if (server.enabled === false) {
            inspections.push(createDisabledInspection(server));
            continue;
        }

        const client = createClient(server, options);

        try {
            const tools = await client.listTools();
            const [prompts, resources, resourceTemplates] = await Promise.all([
                client.supportsPrompts() ? client.listPrompts() : Promise.resolve([]),
                client.supportsResources() ? client.listResources() : Promise.resolve([]),
                client.supportsResources() ? client.listResourceTemplates() : Promise.resolve([]),
            ]);
            inspections.push({
                ...createBaseInspection(server),
                enabled: true,
                status: 'ok',
                protocolVersion: client.protocolVersion,
                serverInfo: client.serverInfo,
                toolCount: tools.length,
                tools: tools.map((tool) => ({
                    name: tool.name,
                    title: tool.title,
                    description: tool.description,
                })),
                promptCount: prompts.length,
                prompts: prompts.map((prompt) => ({
                    name: prompt.name,
                    title: prompt.title,
                    description: prompt.description,
                })),
                resourceCount: resources.length,
                resources: resources.map((resource) => ({
                    uri: resource.uri,
                    name: resource.name,
                    title: resource.title,
                    description: resource.description,
                })),
                resourceTemplateCount: resourceTemplates.length,
                resourceTemplates: resourceTemplates.map((template) => ({
                    uriTemplate: template.uriTemplate,
                    name: template.name,
                    title: template.title,
                    description: template.description,
                })),
            });
        } catch (error) {
            inspections.push({
                ...createEmptyInspection(server),
                enabled: true,
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            await client.close();
        }
    }

    return inspections;
}

function createDisabledInspection(server: MCPServerConfig): McpServerInspection {
    return {
        ...createEmptyInspection(server),
        enabled: false,
        status: 'disabled',
    };
}

function createEmptyInspection(server: MCPServerConfig): Omit<McpServerInspection, 'enabled' | 'status'> {
    return {
        ...createBaseInspection(server),
        toolCount: 0,
        tools: [],
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
        resourceTemplateCount: 0,
        resourceTemplates: [],
    };
}

function createBaseInspection(server: MCPServerConfig): Pick<
    McpServerInspection,
    'name' | 'transport' | 'command' | 'url' | 'args' | 'cwd'
> {
    return {
        name: server.name,
        transport: server.transport ?? 'stdio',
        command: server.command ?? '-',
        ...(server.url ? { url: server.url } : {}),
        args: server.args ?? [],
        cwd: server.cwd,
    };
}
