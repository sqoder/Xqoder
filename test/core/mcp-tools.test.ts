import { describe, expect, it } from 'bun:test';
import {
    McpGetPromptTool,
    McpListResourcesTool,
    McpReadResourceTool,
    McpRemoteTool,
} from '../../src/core/agent/mcp-tools.js';
import type {
    McpClientAdapter,
    McpToolDescriptor,
} from '../../src/core/agent/mcp.js';

describe('mcp tool adapters', () => {
    it('forwards remote tool calls, strips toolCallId, and surfaces remote errors', async () => {
        const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
        const descriptor: McpToolDescriptor = {
            name: 'deploy.preview',
            description: 'Deploy a preview build',
            inputSchema: {
                type: 'object',
                properties: {
                    branch: { type: 'string' },
                },
            },
        };
        const tool = new McpRemoteTool('deploy_preview', 'deployer', descriptor, createClient({
            async callTool(name, args) {
                calls.push({ name, args });
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'preview failed' }],
                };
            },
        }));

        expect(tool.definition.name).toBe('deploy_preview');
        expect(tool.buildApprovalRequest({ branch: 'main' }, {} as never).summary).toContain('deploy.preview');

        const result = await tool.execute({
            toolCallId: 'call-1',
            branch: 'main',
        }, {} as never);

        expect(calls).toEqual([
            {
                name: 'deploy.preview',
                args: { branch: 'main' },
            },
        ]);
        expect(result.success).toBe(false);
        expect(result.toolCallId).toBe('call-1');
        expect(result.error).toContain('preview failed');
        expect(result.metadata).toMatchObject({
            mcpServer: 'deployer',
            remoteTool: 'deploy.preview',
        });
    });

    it('lists prompts/resources and reads prompt/resource payloads through the shared client', async () => {
        const client = createClient({
            async listResources() {
                return [{ uri: 'file://README.md', name: 'README.md' }];
            },
            async listResourceTemplates() {
                return [{ uriTemplate: 'file://{path}', name: 'workspace-file' }];
            },
            async getPrompt(name, args) {
                return {
                    description: 'Prompt description',
                    messages: [{ role: 'user', content: { type: 'text', text: `${name}:${args?.branch ?? 'none'}` } }],
                };
            },
            async readResource(uri) {
                return {
                    contents: [{ uri, text: '# Hello' }],
                };
            },
        });

        const listResources = new McpListResourcesTool('repo', 'resources_list', client);
        const getPrompt = new McpGetPromptTool('repo', 'prompts_get', client);
        const readResource = new McpReadResourceTool('repo', 'resource_read', client);

        const resourcesResult = await listResources.execute({ toolCallId: 'call-2' }, {} as never);
        const promptResult = await getPrompt.execute({
            toolCallId: 'call-3',
            name: 'release-notes',
            arguments: {
                branch: 'main',
                ignored: 123,
            },
        }, {} as never);
        const resourceResult = await readResource.execute({
            toolCallId: 'call-4',
            uri: 'file://README.md',
        }, {} as never);

        expect(resourcesResult.success).toBe(true);
        expect(resourcesResult.output).toContain('README.md');
        expect(resourcesResult.metadata).toMatchObject({
            action: 'list_resources',
            resourceCount: 1,
            resourceTemplateCount: 1,
        });

        expect(promptResult.success).toBe(true);
        expect(promptResult.output).toContain('release-notes');
        expect(promptResult.output).toContain('release-notes:main');
        expect(promptResult.metadata).toMatchObject({
            action: 'get_prompt',
            promptName: 'release-notes',
        });

        expect(resourceResult.success).toBe(true);
        expect(resourceResult.output).toContain('# Hello');
        expect(resourceResult.metadata).toMatchObject({
            action: 'read_resource',
            uri: 'file://README.md',
        });
    });
});

function createClient(overrides: Partial<McpClientAdapter> = {}): McpClientAdapter {
    return {
        supportsPrompts: () => true,
        supportsResources: () => true,
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
