import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import {
    logger as defaultLogger,
    type Logger,
    type MCPServerConfig,
    type SandboxMode,
} from '@xqoder/shared';
import type { ITool } from './tools/tool.js';
import {
    buildRoots,
    createReservedAlias,
    createToolAlias,
    formatNotificationMessage,
    hasCapability,
    resolveServerCwd,
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

export type { McpServerInspection } from './mcp-inspection.js';

const MCP_CLIENT_INFO = {
    name: 'xqoder',
    version: '0.1.0',
};

const MCP_REQUEST_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
    '2025-11-25',
    '2025-06-18',
    '2025-03-26',
    '2024-11-05',
]);

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number;
    method: string;
    params?: unknown;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

interface McpInitializeResult {
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

interface McpToolsListResult {
    tools?: McpToolDescriptor[];
    nextCursor?: string;
}

interface McpPromptsListResult {
    prompts?: McpPromptDescriptor[];
    nextCursor?: string;
}

interface McpResourcesListResult {
    resources?: McpResourceDescriptor[];
    nextCursor?: string;
}

interface McpResourceTemplatesListResult {
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

interface McpManagerOptions {
    servers: MCPServerConfig[];
    cwd: string;
    projectRoot: string;
    sandboxMode?: SandboxMode;
    allowedPaths?: string[];
    logger?: Logger;
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

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
};

class McpStdioClient {
    private child?: ChildProcessWithoutNullStreams;
    private readonly pendingRequests = new Map<string | number, PendingRequest>();
    private readonly stderrLines: string[] = [];
    private readonly logger: Logger;
    private stdoutBuffer = '';
    private messageQueue: Promise<void> = Promise.resolve();
    private nextId = 1;
    private initialized = false;
    private protocolVersionValue?: string;
    private serverInfoValue?: McpServerInfo;
    private capabilitiesValue?: Record<string, unknown>;
    private toolsCache: McpToolDescriptor[] | undefined;
    private promptsCache: McpPromptDescriptor[] | undefined;
    private resourcesCache: McpResourceDescriptor[] | undefined;
    private resourceTemplatesCache: McpResourceTemplateDescriptor[] | undefined;
    private toolsDirty = false;
    private promptsDirty = false;
    private resourcesDirty = false;
    private resourceTemplatesDirty = false;

    constructor(
        private readonly config: MCPServerConfig,
        private readonly options: Omit<McpManagerOptions, 'servers'>,
    ) {
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

        if (!force && this.toolsCache && !this.toolsDirty) {
            return this.toolsCache;
        }

        const tools: McpToolDescriptor[] = [];
        let cursor: string | undefined;
        do {
            const result = await this.sendRequest<McpToolsListResult>('tools/list', cursor ? { cursor } : {});
            tools.push(...(result.tools ?? []));
            cursor = result.nextCursor;
        } while (cursor);

        this.toolsCache = tools;
        this.toolsDirty = false;
        return tools;
    }

    async listPrompts(force = false): Promise<McpPromptDescriptor[]> {
        await this.ensureInitialized();
        if (!this.supportsPrompts()) {
            return [];
        }

        if (!force && this.promptsCache && !this.promptsDirty) {
            return this.promptsCache;
        }

        const prompts = await this.collectCursorPages<McpPromptDescriptor, McpPromptsListResult>(
            'prompts/list',
            'prompts',
        );
        this.promptsCache = prompts;
        this.promptsDirty = false;
        return prompts;
    }

    async getPrompt(name: string, args: Record<string, string> = {}): Promise<McpGetPromptResult> {
        await this.ensureInitialized();
        const result = await this.sendRequest<McpGetPromptResult>('prompts/get', {
            name,
            arguments: args,
        });
        this.promptsDirty = true;
        return result;
    }

    async listResources(force = false): Promise<McpResourceDescriptor[]> {
        await this.ensureInitialized();
        if (!this.supportsResources()) {
            return [];
        }

        if (!force && this.resourcesCache && !this.resourcesDirty) {
            return this.resourcesCache;
        }

        const resources = await this.collectCursorPages<McpResourceDescriptor, McpResourcesListResult>(
            'resources/list',
            'resources',
        );
        this.resourcesCache = resources;
        this.resourcesDirty = false;
        return resources;
    }

    async listResourceTemplates(force = false): Promise<McpResourceTemplateDescriptor[]> {
        await this.ensureInitialized();
        if (!this.supportsResources()) {
            return [];
        }

        if (!force && this.resourceTemplatesCache && !this.resourceTemplatesDirty) {
            return this.resourceTemplatesCache;
        }

        const templates = await this.collectCursorPages<McpResourceTemplateDescriptor, McpResourceTemplatesListResult>(
            'resources/templates/list',
            'resourceTemplates',
        );
        this.resourceTemplatesCache = templates;
        this.resourceTemplatesDirty = false;
        return templates;
    }

    async readResource(uri: string): Promise<McpReadResourceResult> {
        await this.ensureInitialized();
        const result = await this.sendRequest<McpReadResourceResult>('resources/read', { uri });
        this.resourcesDirty = true;
        this.resourceTemplatesDirty = true;
        return result;
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult> {
        await this.ensureInitialized();
        const result = await this.sendRequest<McpCallToolResult>('tools/call', {
            name,
            arguments: args,
        });
        this.toolsDirty = true;
        return result;
    }

    async close(): Promise<void> {
        if (!this.child) {
            return;
        }

        const child = this.child;
        this.child = undefined;
        this.initialized = false;
        this.toolsCache = undefined;
        this.promptsCache = undefined;
        this.resourcesCache = undefined;
        this.resourceTemplatesCache = undefined;
        this.toolsDirty = false;
        this.promptsDirty = false;
        this.resourcesDirty = false;
        this.resourceTemplatesDirty = false;

        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();

        if (!child.killed) {
            child.kill();
        }

        if (child.exitCode === null && child.signalCode === null) {
            try {
                await once(child, 'exit');
            } catch {
                // ignore
            }
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (!this.config.command?.trim()) {
            throw new Error(`MCP server ${this.config.name} missing stdio command`);
        }

        const child = spawn(this.config.command, this.config.args ?? [], {
            cwd: resolveServerCwd(this.config.cwd, this.options.projectRoot, this.options.cwd),
            env: {
                ...process.env,
                ...(this.config.env ?? {}),
            },
            stdio: 'pipe',
        });
        this.child = child;

        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (chunk: string) => {
            this.handleStdoutChunk(chunk);
        });
        child.stderr.on('data', (chunk: string) => {
            this.handleStderrChunk(chunk);
        });
        child.once('error', (error) => {
            this.rejectAllPending(new Error(`MCP process failed to start: ${error.message}`));
        });
        child.once('exit', (code, signal) => {
            const reason = code !== null
                ? `Exit code ${code}`
                : `Signal ${signal ?? 'unknown'}`;
            this.rejectAllPending(new Error(`MCP process exited (${reason})`));
        });

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
        this.sendNotification('notifications/initialized', {});
    }

    private handleStdoutChunk(chunk: string): void {
        this.stdoutBuffer += chunk;

        let newlineIndex = this.stdoutBuffer.indexOf('\n');
        while (newlineIndex >= 0) {
            const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

            if (line.length > 0) {
                this.handleIncomingPayload(line);
            }

            newlineIndex = this.stdoutBuffer.indexOf('\n');
        }
    }

    private handleStderrChunk(chunk: string): void {
        const lines = chunk
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        for (const line of lines) {
            this.stderrLines.push(line);
            if (this.stderrLines.length > 20) {
                this.stderrLines.shift();
            }
            this.logger.warn(line);
        }
    }

    private handleIncomingPayload(payload: string): void {
        try {
            const parsed = JSON.parse(payload) as JsonRpcRequest | JsonRpcResponse | Array<JsonRpcRequest | JsonRpcResponse>;
            const messages = Array.isArray(parsed) ? parsed : [parsed];

            for (const message of messages) {
                this.messageQueue = this.messageQueue
                    .then(() => this.handleIncomingMessage(message))
                    .catch((error) => {
                        this.logger.warn(`Failed to process MCP message: ${error instanceof Error ? error.message : String(error)}`);
                    });
            }
        } catch (error) {
            this.logger.warn(`Ignoring unparseable MCP message: ${payload}`);
            this.logger.debug(String(error));
        }
    }

    private async handleIncomingMessage(
        message: JsonRpcRequest | JsonRpcResponse,
    ): Promise<void> {
        if ('id' in message && !('method' in message)) {
            const pending = this.pendingRequests.get(message.id);
            if (!pending) {
                return;
            }

            clearTimeout(pending.timer);
            this.pendingRequests.delete(message.id);

            if (message.error) {
                pending.reject(new Error(message.error.message));
                return;
            }

            pending.resolve(message.result);
            return;
        }

        if (!('method' in message)) {
            return;
        }

        if (message.id === undefined) {
            this.handleNotification(message.method, message.params);
            return;
        }

        try {
            const result = await this.handleServerRequest(message.method, message.params);
            this.sendRaw({
                jsonrpc: '2.0',
                id: message.id,
                result,
            });
        } catch (error) {
            this.sendRaw({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }

    private handleNotification(method: string, params: unknown): void {
        if (method === 'notifications/tools/list_changed') {
            this.toolsDirty = true;
            return;
        }

        if (method === 'notifications/prompts/list_changed') {
            this.promptsDirty = true;
            return;
        }

        if (method === 'notifications/resources/list_changed') {
            this.resourcesDirty = true;
            this.resourceTemplatesDirty = true;
            return;
        }

        if (method === 'notifications/message') {
            this.logger.info(formatNotificationMessage(params));
        }
    }

    private async handleServerRequest(method: string, _params: unknown): Promise<unknown> {
        if (method === 'roots/list') {
            return {
                roots: buildRoots(this.options.projectRoot, this.options.allowedPaths),
            };
        }

        if (method === 'ping') {
            return {};
        }

        throw new Error(`Unsupported MCP request: ${method}`);
    }

    private sendNotification(method: string, params: unknown): void {
        this.sendRaw({
            jsonrpc: '2.0',
            method,
            params,
        });
    }

    private sendRaw(message: Record<string, unknown>): void {
        if (!this.child?.stdin.writable) {
            throw new Error('MCP process not writable');
        }

        this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    private async sendRequest<T>(method: string, params: unknown): Promise<T> {
        const id = this.nextId++;
        const timeoutMs = this.config.timeoutMs ?? 15_000;

        const result = await new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`MCP request timeout: ${method}`));
            }, timeoutMs);

            this.pendingRequests.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
                timer,
            });

            try {
                this.sendRaw({
                    jsonrpc: '2.0',
                    id,
                    method,
                    params,
                });
            } catch (error) {
                clearTimeout(timer);
                this.pendingRequests.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });

        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        await this.messageQueue;
        return result;
    }

    private rejectAllPending(error: Error): void {
        for (const [id, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pendingRequests.delete(id);
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
}

class McpHttpClient implements McpClientAdapter {
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

export class McpServerManager {
    private readonly clients = new Map<string, McpClientAdapter>();
    private readonly logger: Logger;

    constructor(private readonly options: McpManagerOptions) {
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

        const client: McpClientAdapter = server.transport === 'http' || server.transport === 'sse'
            ? new McpHttpClient(server, {
                cwd: this.options.cwd,
                projectRoot: this.options.projectRoot,
                sandboxMode: this.options.sandboxMode,
                allowedPaths: this.options.allowedPaths,
                logger: this.logger,
            })
            : new McpStdioClient(server, {
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

function createStandaloneMcpClient(server: MCPServerConfig, options: McpManagerOptions): McpClientAdapter {
    if (server.transport === 'http' || server.transport === 'sse') {
        return new McpHttpClient(server, {
            cwd: options.cwd,
            projectRoot: options.projectRoot,
            sandboxMode: options.sandboxMode,
            allowedPaths: options.allowedPaths,
            logger: options.logger,
        });
    }
    return new McpStdioClient(server, {
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
