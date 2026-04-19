import { logger as defaultLogger, type Logger, type MCPServerConfig } from '@xqoder/shared';
import { hasCapability } from './mcp-utils.js';
import {
    MCP_CLIENT_INFO,
    MCP_REQUEST_PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    type JsonRpcResponse,
    type McpCallToolResult,
    type McpClientAdapter,
    type McpGetPromptResult,
    type McpInitializeResult,
    type McpManagerOptions,
    type McpPromptDescriptor,
    type McpPromptsListResult,
    type McpReadResourceResult,
    type McpResourceDescriptor,
    type McpResourceTemplateDescriptor,
    type McpResourceTemplatesListResult,
    type McpResourcesListResult,
    type McpServerInfo,
    type McpToolDescriptor,
    type McpToolsListResult,
} from './mcp-types.js';

export class McpHttpClient implements McpClientAdapter {
    private readonly logger: Logger;
    private initialized = false;
    private nextId = 1;
    private protocolVersionValue?: string;
    private serverInfoValue?: McpServerInfo;
    private capabilitiesValue?: Record<string, unknown>;
    private toolsCache?: McpToolDescriptor[];
    private promptsCache?: McpPromptDescriptor[];
    private resourcesCache?: McpResourceDescriptor[];
    private resourceTemplatesCache?: McpResourceTemplateDescriptor[];

    constructor(private readonly config: MCPServerConfig, options: Omit<McpManagerOptions, 'servers'>) {
        this.logger = (options.logger ?? defaultLogger).child(`MCP:${config.name}`);
    }

    get protocolVersion(): string | undefined {
        return this.protocolVersionValue;
    }

    get serverInfo(): McpServerInfo | undefined {
        return this.serverInfoValue;
    }

    supportsPrompts(): boolean {
        return hasCapability(this.capabilitiesValue, 'prompts');
    }

    supportsResources(): boolean {
        return hasCapability(this.capabilitiesValue, 'resources');
    }

    async listTools(force = false): Promise<McpToolDescriptor[]> {
        await this.ensureInitialized();
        if (!force && this.toolsCache) {
            return this.toolsCache;
        }
        const tools = await this.collectCursorPages<McpToolDescriptor, McpToolsListResult>('tools/list', 'tools');
        this.toolsCache = tools;
        return tools;
    }

    async listPrompts(force = false): Promise<McpPromptDescriptor[]> {
        await this.ensureInitialized();
        if (!this.supportsPrompts()) {
            return [];
        }
        if (!force && this.promptsCache) {
            return this.promptsCache;
        }
        const prompts = await this.collectCursorPages<McpPromptDescriptor, McpPromptsListResult>('prompts/list', 'prompts');
        this.promptsCache = prompts;
        return prompts;
    }

    async getPrompt(name: string, args: Record<string, string> = {}): Promise<McpGetPromptResult> {
        await this.ensureInitialized();
        const result = await this.sendRequest<McpGetPromptResult>('prompts/get', {
            name,
            arguments: args,
        });
        this.promptsCache = undefined;
        return result;
    }

    async listResources(force = false): Promise<McpResourceDescriptor[]> {
        await this.ensureInitialized();
        if (!this.supportsResources()) {
            return [];
        }
        if (!force && this.resourcesCache) {
            return this.resourcesCache;
        }
        const resources = await this.collectCursorPages<McpResourceDescriptor, McpResourcesListResult>('resources/list', 'resources');
        this.resourcesCache = resources;
        return resources;
    }

    async listResourceTemplates(force = false): Promise<McpResourceTemplateDescriptor[]> {
        await this.ensureInitialized();
        if (!this.supportsResources()) {
            return [];
        }
        if (!force && this.resourceTemplatesCache) {
            return this.resourceTemplatesCache;
        }
        const templates = await this.collectCursorPages<McpResourceTemplateDescriptor, McpResourceTemplatesListResult>('resources/templates/list', 'resourceTemplates');
        this.resourceTemplatesCache = templates;
        return templates;
    }

    async readResource(uri: string): Promise<McpReadResourceResult> {
        await this.ensureInitialized();
        const result = await this.sendRequest<McpReadResourceResult>('resources/read', { uri });
        this.resourcesCache = undefined;
        this.resourceTemplatesCache = undefined;
        return result;
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
        await this.ensureInitialized();
        const result = await this.sendRequest<McpCallToolResult>('tools/call', {
            name,
            arguments: args,
        });
        this.toolsCache = undefined;
        return result;
    }

    async close(): Promise<void> {
        this.initialized = false;
        this.toolsCache = undefined;
        this.promptsCache = undefined;
        this.resourcesCache = undefined;
        this.resourceTemplatesCache = undefined;
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const result = await this.sendRequest<McpInitializeResult>('initialize', {
            protocolVersion: MCP_REQUEST_PROTOCOL_VERSION,
            capabilities: {
                roots: {
                    listChanged: false,
                },
            },
            clientInfo: MCP_CLIENT_INFO,
        });

        if (!SUPPORTED_PROTOCOL_VERSIONS.has(result.protocolVersion)) {
            throw new Error(`MCP protocol version unsupported: ${result.protocolVersion}`);
        }

        this.protocolVersionValue = result.protocolVersion;
        this.serverInfoValue = result.serverInfo;
        this.capabilitiesValue = result.capabilities;
        this.initialized = true;

        try {
            await this.sendNotification('notifications/initialized', {});
        } catch (error) {
            this.logger.debug(`MCP HTTP initialized notification failed: ${String(error)}`);
        }
    }

    private async collectCursorPages<TItem, TResult extends { nextCursor?: string }>(
        method: string,
        key: keyof TResult,
    ): Promise<TItem[]> {
        const items: TItem[] = [];
        let cursor: string | undefined;

        do {
            const result = await this.sendRequest<TResult>(method, cursor ? { cursor } : {});
            const chunk = result[key];
            if (Array.isArray(chunk)) {
                items.push(...chunk as TItem[]);
            }
            cursor = result.nextCursor;
        } while (cursor);

        return items;
    }

    private async sendNotification(method: string, params: unknown): Promise<void> {
        await this.sendRaw({
            jsonrpc: '2.0',
            method,
            params,
        });
    }

    private async sendRequest<T>(method: string, params: unknown): Promise<T> {
        const id = this.nextId++;
        const payload = {
            jsonrpc: '2.0',
            id,
            method,
            params,
        };
        const result = await this.sendRaw(payload);
        if (result.error) {
            throw new Error(result.error.message || `MCP request failed: ${method}`);
        }
        return result.result as T;
    }

    private async sendRaw(payload: Record<string, unknown>): Promise<JsonRpcResponse> {
        const endpoint = this.config.url?.trim();
        if (!endpoint) {
            throw new Error(`MCP server ${this.config.name} missing url for ${this.config.transport ?? 'http'} transport`);
        }
        const timeoutMs = this.config.timeoutMs ?? 15_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    ...(this.config.headers ?? {}),
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const raw = await response.json();
            if (!raw || typeof raw !== 'object') {
                throw new Error('Invalid MCP HTTP response');
            }
            return raw as JsonRpcResponse;
        } finally {
            clearTimeout(timer);
        }
    }
}
