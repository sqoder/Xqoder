import type {
    ToolDefinition,
    ToolResult,
} from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tools/tool.js';
import {
    buildSyntheticApproval,
    convertJsonSchemaToParameters,
    formatPromptList,
    formatPromptResult,
    formatReadResourceResult,
    formatResourceIndex,
    formatToolCallResult,
    normalizePromptArguments,
    requireStringArgument,
    safeStringify,
} from './mcp-utils.js';
import type {
    McpClientAdapter,
    McpToolDescriptor,
} from './mcp.js';

export class McpRemoteTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly aliasName: string,
        private readonly serverName: string,
        private readonly remoteTool: McpToolDescriptor,
        private readonly client: McpClientAdapter,
    ) {
        this.definition = {
            name: aliasName,
            description: `[MCP:${serverName}] ${remoteTool.description ?? remoteTool.title ?? remoteTool.name}`,
            parameters: convertJsonSchemaToParameters(remoteTool.inputSchema),
        };
    }

    buildApprovalRequest(args: Record<string, unknown>, _context: ToolContext): ToolApprovalRequest {
        return {
            toolCallId: '',
            toolName: this.aliasName,
            summary: `Call MCP tool ${this.remoteTool.name} @ ${this.serverName}`,
            reason: 'MCP tools are provided by external processes and require explicit confirmation before execution.',
            preview: safeStringify(args, 600),
            risk: 'medium',
        };
    }

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = String(args.toolCallId ?? '');
        const remoteArgs = { ...args };
        delete remoteArgs.toolCallId;

        const result = await this.client.callTool(this.remoteTool.name, remoteArgs);
        const output = formatToolCallResult(result);
        const isError = result.isError === true;

        return {
            toolCallId,
            success: !isError,
            output,
            error: isError ? output : undefined,
            metadata: {
                mcpServer: this.serverName,
                remoteTool: this.remoteTool.name,
            },
        };
    }
}

export class McpListPromptsTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly serverName: string,
        private readonly aliasName: string,
        private readonly client: McpClientAdapter,
    ) {
        this.definition = {
            name: aliasName,
            description: `[MCP:${serverName}] List available prompts`,
            parameters: [],
        };
    }

    buildApprovalRequest(_args: Record<string, unknown>, _context: ToolContext): ToolApprovalRequest {
        return buildSyntheticApproval(this.aliasName, this.serverName, 'List MCP prompts');
    }

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const prompts = await this.client.listPrompts();
        return {
            toolCallId: String(args.toolCallId ?? ''),
            success: true,
            output: formatPromptList(prompts),
            metadata: {
                mcpServer: this.serverName,
                action: 'list_prompts',
                promptCount: prompts.length,
            },
        };
    }
}

export class McpGetPromptTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly serverName: string,
        private readonly aliasName: string,
        private readonly client: McpClientAdapter,
    ) {
        this.definition = {
            name: aliasName,
            description: `[MCP:${serverName}] Get prompt templates and messages`,
            parameters: [
                {
                    name: 'name',
                    type: 'string',
                    description: 'prompt name',
                    required: true,
                },
                {
                    name: 'arguments',
                    type: 'object',
                    description: 'prompt arguments object, values should ideally be strings',
                },
            ],
        };
    }

    buildApprovalRequest(args: Record<string, unknown>, _context: ToolContext): ToolApprovalRequest {
        return buildSyntheticApproval(
            this.aliasName,
            this.serverName,
            'Read MCP prompt',
            safeStringify(args, 600),
        );
    }

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const promptName = requireStringArgument(args, 'name');
        const promptArgs = normalizePromptArguments(args['arguments']);
        const result = await this.client.getPrompt(promptName, promptArgs);

        return {
            toolCallId: String(args.toolCallId ?? ''),
            success: true,
            output: formatPromptResult(promptName, result),
            metadata: {
                mcpServer: this.serverName,
                action: 'get_prompt',
                promptName,
            },
        };
    }
}

export class McpListResourcesTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly serverName: string,
        private readonly aliasName: string,
        private readonly client: McpClientAdapter,
    ) {
        this.definition = {
            name: aliasName,
            description: `[MCP:${serverName}] List readable resources`,
            parameters: [],
        };
    }

    buildApprovalRequest(_args: Record<string, unknown>, _context: ToolContext): ToolApprovalRequest {
        return buildSyntheticApproval(this.aliasName, this.serverName, 'List MCP resources');
    }

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const [resources, templates] = await Promise.all([
            this.client.listResources(),
            this.client.listResourceTemplates(),
        ]);

        return {
            toolCallId: String(args.toolCallId ?? ''),
            success: true,
            output: formatResourceIndex(resources, templates),
            metadata: {
                mcpServer: this.serverName,
                action: 'list_resources',
                resourceCount: resources.length,
                resourceTemplateCount: templates.length,
            },
        };
    }
}

export class McpReadResourceTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly serverName: string,
        private readonly aliasName: string,
        private readonly client: McpClientAdapter,
    ) {
        this.definition = {
            name: aliasName,
            description: `[MCP:${serverName}] Read specified resource`,
            parameters: [
                {
                    name: 'uri',
                    type: 'string',
                    description: 'resource URI',
                    required: true,
                },
            ],
        };
    }

    buildApprovalRequest(args: Record<string, unknown>, _context: ToolContext): ToolApprovalRequest {
        return buildSyntheticApproval(
            this.aliasName,
            this.serverName,
            'Read MCP resource',
            safeStringify(args, 600),
        );
    }

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const uri = requireStringArgument(args, 'uri');
        const result = await this.client.readResource(uri);

        return {
            toolCallId: String(args.toolCallId ?? ''),
            success: true,
            output: formatReadResourceResult(uri, result),
            metadata: {
                mcpServer: this.serverName,
                action: 'read_resource',
                uri,
            },
        };
    }
}
