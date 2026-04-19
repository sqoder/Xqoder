import { describe, expect, it } from 'bun:test';
import type { MCPServerConfig } from '@xqoder/shared';
import {
    McpServerManager,
} from '../../src/core/agent/mcp-server-manager.js';
import { McpServerManager as ReExportedManager } from '../../src/core/agent/mcp.js';
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
