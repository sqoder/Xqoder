import { describe, expect, it } from 'bun:test';
import type { MCPServerConfig } from '@xqoder/shared';
import {
    McpServerManager,
    createDefaultMcpClient,
} from '../../src/core/agent/mcp-server-manager.js';
import { McpServerManager as ReExportedManager } from '../../src/core/agent/mcp.js';
import { McpSseClient } from '../../src/core/agent/mcp-sse-client.js';
import { McpHttpClient } from '../../src/core/agent/mcp-http-client.js';
import { McpStdioClient } from '../../src/core/agent/mcp-stdio-client.js';
import type { McpClientAdapter } from '../../src/core/agent/mcp.js';

describe('McpServerManager', () => {
    it('adapts enabled server tools, skips disabled servers, logs failures, and reuses clients', async () => {
        const created: string[] = [];
        const closed: string[] = [];
        const warnings: string[] = [];
        const manager = new McpServerManager({
            servers: [
                createServer('alpha'),
                createServer('broken'),
                { ...createServer('disabled'), enabled: false },
            ],
            cwd: '/workspace',
            projectRoot: '/workspace',
            logger: createLogger(warnings),
        }, (server) => {
            created.push(server.name);
            if (server.name === 'broken') {
                return createClient(server.name, closed, {
                    listTools: async () => {
                        throw new Error('connection refused');
                    },
                });
            }

            return createClient(server.name, closed, {
                supportsPrompts: () => true,
                supportsResources: () => true,
                listTools: async () => [{ name: 'deploy.preview', description: 'Deploy preview' }],
            });
        });

        const tools = await manager.listTools();
        const toolsAgain = await manager.listTools();

        expect(tools.map((tool) => tool.definition.name)).toEqual([
            'mcp.alpha.deploy.preview',
            'mcp.alpha.resources.list',
            'mcp.alpha.resources.read',
            'mcp.alpha.prompts.list',
            'mcp.alpha.prompts.get',
        ]);
        expect(toolsAgain.map((tool) => tool.definition.name)).toEqual(tools.map((tool) => tool.definition.name));
        expect(created).toEqual(['alpha', 'broken']);
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toContain('MCP server broken unavailable: connection refused');

        await manager.dispose();
        expect(closed.sort()).toEqual(['alpha', 'broken']);
    });

    it('keeps the manager available through the public mcp entry', () => {
        expect(ReExportedManager).toBe(McpServerManager);
    });

    it('propagates server trust metadata into generated MCP tool adapters', async () => {
        const manager = new McpServerManager({
            servers: [
                createServer('local-docs'),
                {
                    name: 'remote-docs',
                    transport: 'http',
                    url: 'https://mcp.example.test',
                },
            ],
            cwd: '/workspace',
            projectRoot: '/workspace',
        }, () => createClient('shared', [], {
            supportsPrompts: () => true,
            supportsResources: () => true,
            listTools: async () => [{ name: 'lookup', description: 'Lookup docs' }],
        }));

        const tools = await manager.listTools();
        const localTool = tools.find((tool) => tool.definition.name === 'mcp.local-docs.lookup');
        const remoteResourceTool = tools.find((tool) => tool.definition.name === 'mcp.remote-docs.resources.list');

        expect(localTool?.getSecurityPolicyContext?.()).toMatchObject({
            source: 'mcp',
            serverName: 'local-docs',
            trust: 'trusted',
            operation: 'tool_call',
        });
        expect(remoteResourceTool?.getSecurityPolicyContext?.()).toMatchObject({
            source: 'mcp',
            serverName: 'remote-docs',
            trust: 'untrusted',
            operation: 'list_resources',
        });

        await manager.dispose();
    });

    it('routes transport "sse" to McpSseClient via createDefaultMcpClient', () => {
        const server = {
            name: 'remote-sse',
            transport: 'sse',
            url: 'https://mcp.example.test/sse',
        } as MCPServerConfig;
        const client = createDefaultMcpClient(server, {
            cwd: '/workspace',
            projectRoot: '/workspace',
        });
        expect(client).toBeInstanceOf(McpSseClient);
        expect(client).not.toBeInstanceOf(McpHttpClient);
    });

    it('routes transport "http" to McpHttpClient and default to McpStdioClient (no regression)', () => {
        const http = createDefaultMcpClient(
            {
                name: 'remote-http',
                transport: 'http',
                url: 'https://mcp.example.test',
            } as MCPServerConfig,
            { cwd: '/workspace', projectRoot: '/workspace' },
        );
        expect(http).toBeInstanceOf(McpHttpClient);
        expect(http).not.toBeInstanceOf(McpSseClient);

        const stdio = createDefaultMcpClient(
            { name: 'local-stdio', command: 'node' } as MCPServerConfig,
            { cwd: '/workspace', projectRoot: '/workspace' },
        );
        expect(stdio).toBeInstanceOf(McpStdioClient);
    });
});

function createServer(name: string): MCPServerConfig {
    return {
        name,
        command: 'node',
        args: [],
    } as MCPServerConfig;
}

function createClient(
    name: string,
    closed: string[],
    overrides: Partial<McpClientAdapter> = {},
): McpClientAdapter {
    return {
        supportsPrompts: () => false,
        supportsResources: () => false,
        listTools: async () => [],
        listPrompts: async () => [],
        getPrompt: async () => ({ description: '', messages: [] }),
        listResources: async () => [],
        listResourceTemplates: async () => [],
        readResource: async () => ({ contents: [] }),
        callTool: async () => ({ content: [] }),
        close: async () => {
            closed.push(name);
        },
        ...overrides,
    };
}

function createLogger(warnings: string[]) {
    const logger = {
        child: () => logger,
        warn: (message: string) => {
            warnings.push(message);
        },
    };

    return logger;
}
