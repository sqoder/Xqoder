import { describe, expect, it } from 'bun:test';
import type { MCPServerConfig } from '@xqoder/shared';
import {
    inspectMcpServersWithClientFactory,
    type McpInspectionClientFactory,
} from '../../src/core/agent/mcp-inspection.js';
import type { McpClientAdapter } from '../../src/core/agent/mcp.js';

describe('mcp inspection helpers', () => {
    it('reports disabled servers without contacting a client', async () => {
        let factoryCalls = 0;
        const inspections = await inspectMcpServersWithClientFactory({
            servers: [{
                name: 'disabled-server',
                command: 'node',
                enabled: false,
            }],
        }, () => {
            factoryCalls += 1;
            return createClient();
        });

        expect(factoryCalls).toBe(0);
        expect(inspections).toEqual([
            {
                name: 'disabled-server',
                enabled: false,
                status: 'disabled',
                transport: 'stdio',
                command: 'node',
                args: [],
                cwd: undefined,
                toolCount: 0,
                tools: [],
                promptCount: 0,
                prompts: [],
                resourceCount: 0,
                resources: [],
                resourceTemplateCount: 0,
                resourceTemplates: [],
            },
        ]);
    });

    it('collects tools, prompts, and resources for healthy servers', async () => {
        const inspections = await inspectMcpServersWithClientFactory({
            servers: [{
                name: 'healthy-server',
                command: 'node',
                args: ['server.js'],
                url: 'http://localhost:8123',
                cwd: '/workspace/demo',
            }],
        }, () => createClient({
            protocolVersion: '2025-11-25',
            serverInfo: {
                name: 'healthy-server',
                version: '1.0.0',
            },
            async listTools() {
                return [{ name: 'deploy', title: 'Deploy', description: 'Deploy preview' }];
            },
            supportsPrompts: () => true,
            async listPrompts() {
                return [{ name: 'release-notes', title: 'Release Notes', description: 'Draft notes' }];
            },
            supportsResources: () => true,
            async listResources() {
                return [{ uri: 'file://README.md', name: 'README.md', description: 'Project docs' }];
            },
            async listResourceTemplates() {
                return [{ uriTemplate: 'file://{path}', name: 'workspace-file', description: 'Workspace file' }];
            },
        }));

        expect(inspections).toEqual([
            {
                name: 'healthy-server',
                enabled: true,
                status: 'ok',
                transport: 'stdio',
                command: 'node',
                url: 'http://localhost:8123',
                args: ['server.js'],
                cwd: '/workspace/demo',
                protocolVersion: '2025-11-25',
                serverInfo: {
                    name: 'healthy-server',
                    version: '1.0.0',
                },
                toolCount: 1,
                tools: [{ name: 'deploy', title: 'Deploy', description: 'Deploy preview' }],
                promptCount: 1,
                prompts: [{ name: 'release-notes', title: 'Release Notes', description: 'Draft notes' }],
                resourceCount: 1,
                resources: [{ uri: 'file://README.md', name: 'README.md', title: undefined, description: 'Project docs' }],
                resourceTemplateCount: 1,
                resourceTemplates: [{ uriTemplate: 'file://{path}', name: 'workspace-file', title: undefined, description: 'Workspace file' }],
            },
        ]);
    });

    it('reports errors and still closes clients when inspection fails', async () => {
        let closeCalls = 0;
        const inspections = await inspectMcpServersWithClientFactory({
            servers: [{
                name: 'broken-server',
                transport: 'http',
                url: 'http://localhost:3000',
            }],
        }, () => createClient({
            supportsPrompts: () => false,
            supportsResources: () => false,
            async listTools() {
                throw new Error('connection refused');
            },
            async close() {
                closeCalls += 1;
            },
        }));

        expect(closeCalls).toBe(1);
        expect(inspections).toEqual([
            {
                name: 'broken-server',
                enabled: true,
                status: 'error',
                transport: 'http',
                command: '-',
                url: 'http://localhost:3000',
                args: [],
                cwd: undefined,
                toolCount: 0,
                tools: [],
                promptCount: 0,
                prompts: [],
                resourceCount: 0,
                resources: [],
                resourceTemplateCount: 0,
                resourceTemplates: [],
                error: 'connection refused',
            },
        ]);
    });
});

function createClient(overrides: Partial<McpClientAdapter> = {}): McpClientAdapter {
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
        close: async () => {},
        ...overrides,
    };
}
