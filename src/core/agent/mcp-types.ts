import type { Logger, MCPServerConfig, SandboxMode } from '@xqoder/shared';
import type { ElicitationAsk } from './mcp-elicitation.js';

export const MCP_CLIENT_INFO = {
    name: 'xqoder',
    version: '0.1.0',
};

export const MCP_REQUEST_PROTOCOL_VERSION = '2025-11-25';

export const SUPPORTED_PROTOCOL_VERSIONS = new Set([
    '2025-11-25',
    '2025-06-18',
    '2025-03-26',
    '2024-11-05',
]);

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number;
    method: string;
    params?: unknown;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

export interface McpInitializeResult {
    protocolVersion: string;
    capabilities?: Record<string, unknown>;
    serverInfo?: McpServerInfo;
}

export interface McpServerInfo {
    name: string;
    version: string;
    title?: string;
}

export interface McpToolDescriptor {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
}

export interface McpPromptArgumentDescriptor {
    name: string;
    title?: string;
    description?: string;
    required?: boolean;
}

export interface McpPromptDescriptor {
    name: string;
    title?: string;
    description?: string;
    arguments?: McpPromptArgumentDescriptor[];
}

export interface McpResourceDescriptor {
    uri: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
    size?: number;
}

export interface McpResourceTemplateDescriptor {
    uriTemplate: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
}

export interface McpToolsListResult {
    tools?: McpToolDescriptor[];
    nextCursor?: string;
}

export interface McpPromptsListResult {
    prompts?: McpPromptDescriptor[];
    nextCursor?: string;
}

export interface McpResourcesListResult {
    resources?: McpResourceDescriptor[];
    nextCursor?: string;
}

export interface McpResourceTemplatesListResult {
    resourceTemplates?: McpResourceTemplateDescriptor[];
    nextCursor?: string;
}

export interface McpCallToolResult {
    content?: Array<Record<string, unknown>>;
    structuredContent?: unknown;
    isError?: boolean;
}

export interface McpReadResourceResult {
    contents?: Array<Record<string, unknown>>;
}

export interface McpGetPromptResult {
    description?: string;
    messages?: Array<Record<string, unknown>>;
}

export interface McpManagerOptions {
    servers: MCPServerConfig[];
    cwd: string;
    projectRoot: string;
    sandboxMode?: SandboxMode;
    allowedPaths?: string[];
    logger?: Logger;
    elicit?: ElicitationAsk;
}

export interface McpClientAdapter {
    readonly protocolVersion?: string;
    readonly serverInfo?: McpServerInfo;
    supportsPrompts(): boolean;
    supportsResources(): boolean;
    listTools(force?: boolean): Promise<McpToolDescriptor[]>;
    listPrompts(force?: boolean): Promise<McpPromptDescriptor[]>;
    getPrompt(name: string, args?: Record<string, string>): Promise<McpGetPromptResult>;
    listResources(force?: boolean): Promise<McpResourceDescriptor[]>;
    listResourceTemplates(force?: boolean): Promise<McpResourceTemplateDescriptor[]>;
    readResource(uri: string): Promise<McpReadResourceResult>;
    callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult>;
    close(): Promise<void>;
}
