import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    logger as defaultLogger,
    type Logger,
    type MCPServerConfig,
    type SandboxMode,
    type ToolDefinition,
    type ToolParameter,
    type ToolResult,
} from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tools/tool.js';

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

interface McpServerInfo {
    name: string;
    version: string;
    title?: string;
}

interface McpToolDescriptor {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
}

interface McpPromptArgumentDescriptor {
    name: string;
    title?: string;
    description?: string;
    required?: boolean;
}

interface McpPromptDescriptor {
    name: string;
    title?: string;
    description?: string;
    arguments?: McpPromptArgumentDescriptor[];
}

interface McpResourceDescriptor {
    uri: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
    size?: number;
}

interface McpResourceTemplateDescriptor {
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

interface McpCallToolResult {
    content?: Array<Record<string, unknown>>;
    structuredContent?: unknown;
    isError?: boolean;
}

interface McpReadResourceResult {
    contents?: Array<Record<string, unknown>>;
}

interface McpGetPromptResult {
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

export interface McpServerInspection {
    name: string;
    enabled: boolean;
    status: 'ok' | 'error' | 'disabled';
    command: string;
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

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
};

type JsonSchemaLike = {
    type?: unknown;
    description?: unknown;
    properties?: Record<string, JsonSchemaLike>;
    required?: unknown;
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

        this.child = spawn(this.config.command, this.config.args ?? [], {
            cwd: resolveServerCwd(this.config.cwd, this.options.projectRoot, this.options.cwd),
            env: {
                ...process.env,
                ...(this.config.env ?? {}),
            },
            stdio: 'pipe',
        });

        this.child.stdout.setEncoding('utf-8');
        this.child.stderr.setEncoding('utf-8');
        this.child.stdout.on('data', (chunk: string) => {
            this.handleStdoutChunk(chunk);
        });
        this.child.stderr.on('data', (chunk: string) => {
            this.handleStderrChunk(chunk);
        });
        this.child.once('error', (error) => {
            this.rejectAllPending(new Error(`MCP 进程启动失败: ${error.message}`));
        });
        this.child.once('exit', (code, signal) => {
            const reason = code !== null
                ? `退出码 ${code}`
                : `信号 ${signal ?? 'unknown'}`;
            this.rejectAllPending(new Error(`MCP 进程已退出 (${reason})`));
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
            throw new Error(`MCP 协议版本不受支持: ${result.protocolVersion}`);
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
                        this.logger.warn(`处理 MCP 消息失败: ${error instanceof Error ? error.message : String(error)}`);
                    });
            }
        } catch (error) {
            this.logger.warn(`忽略无法解析的 MCP 消息: ${payload}`);
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

        throw new Error(`不支持的 MCP 请求: ${method}`);
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
            throw new Error('MCP 进程不可写');
        }

        this.child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    private async sendRequest<T>(method: string, params: unknown): Promise<T> {
        const id = this.nextId++;
        const timeoutMs = this.config.timeoutMs ?? 15_000;

        const result = await new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`MCP 请求超时: ${method}`));
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

class McpRemoteTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly aliasName: string,
        private readonly serverName: string,
        private readonly remoteTool: McpToolDescriptor,
        private readonly client: McpStdioClient,
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
            summary: `调用 MCP 工具 ${this.remoteTool.name} @ ${this.serverName}`,
            reason: 'MCP 工具由外部进程提供，执行前需要显式确认。',
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

class McpListPromptsTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly serverName: string,
        private readonly aliasName: string,
        private readonly client: McpStdioClient,
    ) {
        this.definition = {
            name: aliasName,
            description: `[MCP:${serverName}] 列出可用 prompts`,
            parameters: [],
        };
    }

    buildApprovalRequest(_args: Record<string, unknown>, _context: ToolContext): ToolApprovalRequest {
        return buildSyntheticApproval(this.aliasName, this.serverName, '列出 MCP prompts');
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

class McpGetPromptTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly serverName: string,
        private readonly aliasName: string,
        private readonly client: McpStdioClient,
    ) {
        this.definition = {
            name: aliasName,
            description: `[MCP:${serverName}] 获取 prompt 模板和消息`,
            parameters: [
                {
                    name: 'name',
                    type: 'string',
                    description: 'prompt 名称',
                    required: true,
                },
                {
                    name: 'arguments',
                    type: 'object',
                    description: 'prompt 参数对象，value 建议为字符串',
                },
            ],
        };
    }

    buildApprovalRequest(args: Record<string, unknown>, _context: ToolContext): ToolApprovalRequest {
        return buildSyntheticApproval(
            this.aliasName,
            this.serverName,
            '读取 MCP prompt',
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

class McpListResourcesTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly serverName: string,
        private readonly aliasName: string,
        private readonly client: McpStdioClient,
    ) {
        this.definition = {
            name: aliasName,
            description: `[MCP:${serverName}] 列出可读 resources`,
            parameters: [],
        };
    }

    buildApprovalRequest(_args: Record<string, unknown>, _context: ToolContext): ToolApprovalRequest {
        return buildSyntheticApproval(this.aliasName, this.serverName, '列出 MCP resources');
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

class McpReadResourceTool implements ITool {
    readonly definition: ToolDefinition;

    constructor(
        private readonly serverName: string,
        private readonly aliasName: string,
        private readonly client: McpStdioClient,
    ) {
        this.definition = {
            name: aliasName,
            description: `[MCP:${serverName}] 读取指定 resource`,
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
            '读取 MCP resource',
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

export class McpServerManager {
    private readonly clients = new Map<string, McpStdioClient>();
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
                this.logger.warn(`MCP server ${server.name} 不可用: ${error instanceof Error ? error.message : String(error)}`);
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

    private getClient(server: MCPServerConfig): McpStdioClient {
        const existing = this.clients.get(server.name);
        if (existing) {
            return existing;
        }

        const client = new McpStdioClient(server, {
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

export async function inspectMcpServers(options: McpManagerOptions): Promise<McpServerInspection[]> {
    const inspections: McpServerInspection[] = [];

    for (const server of options.servers) {
        if (server.enabled === false) {
            inspections.push({
                name: server.name,
                enabled: false,
                status: 'disabled',
                command: server.command,
                args: server.args ?? [],
                cwd: server.cwd,
                toolCount: 0,
                tools: [],
                promptCount: 0,
                prompts: [],
                resourceCount: 0,
                resources: [],
                resourceTemplateCount: 0,
                resourceTemplates: [],
            });
            continue;
        }

        const client = new McpStdioClient(server, {
            cwd: options.cwd,
            projectRoot: options.projectRoot,
            sandboxMode: options.sandboxMode,
            allowedPaths: options.allowedPaths,
            logger: options.logger,
        });

        try {
            const tools = await client.listTools();
            const [prompts, resources, resourceTemplates] = await Promise.all([
                client.supportsPrompts() ? client.listPrompts() : Promise.resolve([]),
                client.supportsResources() ? client.listResources() : Promise.resolve([]),
                client.supportsResources() ? client.listResourceTemplates() : Promise.resolve([]),
            ]);
            inspections.push({
                name: server.name,
                enabled: true,
                status: 'ok',
                command: server.command,
                args: server.args ?? [],
                cwd: server.cwd,
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
                name: server.name,
                enabled: true,
                status: 'error',
                command: server.command,
                args: server.args ?? [],
                cwd: server.cwd,
                toolCount: 0,
                tools: [],
                promptCount: 0,
                prompts: [],
                resourceCount: 0,
                resources: [],
                resourceTemplateCount: 0,
                resourceTemplates: [],
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            await client.close();
        }
    }

    return inspections;
}

function buildRoots(projectRoot: string, allowedPaths: string[] = []): Array<{ uri: string; name: string }> {
    const roots = [projectRoot, ...allowedPaths];
    const unique = Array.from(new Set(roots.map((entry) => path.resolve(entry))));

    return unique.map((entry) => ({
        uri: pathToFileURL(entry).toString(),
        name: path.basename(entry) || entry,
    }));
}

function resolveServerCwd(
    configuredCwd: string | undefined,
    projectRoot: string,
    fallbackCwd: string,
): string {
    if (!configuredCwd) {
        return fallbackCwd;
    }

    return path.isAbsolute(configuredCwd)
        ? configuredCwd
        : path.resolve(projectRoot, configuredCwd);
}

function createToolAlias(serverName: string, toolName: string, existing: Set<string>): string {
    const base = `mcp.${sanitizeAliasSegment(serverName)}.${sanitizeAliasSegment(toolName)}`;
    let alias = base;
    let suffix = 2;
    while (existing.has(alias)) {
        alias = `${base}_${suffix}`;
        suffix += 1;
    }
    existing.add(alias);
    return alias;
}

function createReservedAlias(serverName: string, suffix: string, existing: Set<string>): string {
    let alias = `mcp.${sanitizeAliasSegment(serverName)}.${suffix}`;
    let counter = 2;
    while (existing.has(alias)) {
        alias = `mcp.${sanitizeAliasSegment(serverName)}.${suffix}_${counter}`;
        counter += 1;
    }
    existing.add(alias);
    return alias;
}

function sanitizeAliasSegment(value: string): string {
    const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.length > 0 ? normalized : 'tool';
}

function convertJsonSchemaToParameters(schema: unknown): ToolParameter[] {
    if (!schema || typeof schema !== 'object') {
        return [];
    }

    const objectSchema = schema as JsonSchemaLike;
    if (objectSchema.type !== 'object' || !objectSchema.properties) {
        return [];
    }

    const required = Array.isArray(objectSchema.required)
        ? new Set(objectSchema.required.filter((value): value is string => typeof value === 'string'))
        : new Set<string>();

    return Object.entries(objectSchema.properties).map(([name, property]) => ({
        name,
        type: resolveToolParameterType(property),
        description: typeof property.description === 'string' ? property.description : '',
        required: required.has(name),
    }));
}

function resolveToolParameterType(schema: JsonSchemaLike): ToolParameter['type'] {
    switch (schema.type) {
        case 'number':
        case 'boolean':
        case 'object':
        case 'array':
            return schema.type;
        default:
            return 'string';
    }
}

function hasCapability(
    capabilities: Record<string, unknown> | undefined,
    capabilityName: string,
): boolean {
    if (!capabilities) {
        return false;
    }

    const capability = capabilities[capabilityName];
    return Boolean(capability && typeof capability === 'object');
}

function buildSyntheticApproval(
    toolName: string,
    serverName: string,
    summary: string,
    preview?: string,
): ToolApprovalRequest {
    return {
        toolCallId: '',
        toolName,
        summary: `${summary} @ ${serverName}`,
        reason: '该调用会访问外部 MCP server。',
        preview,
        risk: 'medium',
    };
}

function requireStringArgument(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`缺少必填参数: ${key}`);
    }
    return value;
}

function normalizePromptArguments(value: unknown): Record<string, string> {
    if (value === undefined) {
        return {};
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('arguments 必须是对象');
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]),
    );
}

function formatToolCallResult(result: McpCallToolResult): string {
    const sections: string[] = [];

    if (Array.isArray(result.content)) {
        for (const item of result.content) {
            if (item.type === 'text' && typeof item.text === 'string') {
                sections.push(item.text);
                continue;
            }

            if (item.type === 'resource_link' || item.type === 'resource') {
                sections.push(safeStringify(item));
                continue;
            }

            sections.push(safeStringify(item));
        }
    }

    if (result.structuredContent !== undefined) {
        sections.push(safeStringify(result.structuredContent));
    }

    return sections.filter(Boolean).join('\n\n') || '(empty MCP result)';
}

function formatPromptList(prompts: McpPromptDescriptor[]): string {
    if (prompts.length === 0) {
        return 'No MCP prompts available.';
    }

    return prompts.map((prompt) => {
        const args = (prompt.arguments ?? [])
            .map((argument) => `${argument.name}${argument.required ? '*' : ''}`)
            .join(', ');
        return [
            `Prompt: ${prompt.name}`,
            prompt.title ? `Title: ${prompt.title}` : '',
            prompt.description ? `Description: ${prompt.description}` : '',
            `Arguments: ${args || '(none)'}`,
        ].filter(Boolean).join('\n');
    }).join('\n\n');
}

function formatPromptResult(promptName: string, result: McpGetPromptResult): string {
    const sections: string[] = [`Prompt: ${promptName}`];
    if (result.description) {
        sections.push(`Description: ${result.description}`);
    }

    const messages = (result.messages ?? []).map((message, index) => {
        const role = typeof message.role === 'string' ? message.role : `message_${index + 1}`;
        return `${role}: ${formatPromptMessageContent(message.content)}`;
    });

    if (messages.length > 0) {
        sections.push('Messages:');
        sections.push(messages.join('\n\n'));
    }

    return sections.join('\n\n');
}

function formatPromptMessageContent(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content.map((entry) => formatPromptMessageContent(entry)).join('\n');
    }

    if (!content || typeof content !== 'object') {
        return safeStringify(content);
    }

    const candidate = content as Record<string, unknown>;
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
        return candidate.text;
    }

    if (candidate.type === 'resource' || candidate.type === 'resource_link') {
        return safeStringify(candidate);
    }

    return safeStringify(candidate);
}

function formatResourceIndex(
    resources: McpResourceDescriptor[],
    templates: McpResourceTemplateDescriptor[],
): string {
    const sections: string[] = [];

    sections.push(resources.length > 0
        ? resources.map((resource) => [
            `Resource: ${resource.name}`,
            `URI: ${resource.uri}`,
            resource.description ? `Description: ${resource.description}` : '',
            resource.mimeType ? `MIME: ${resource.mimeType}` : '',
        ].filter(Boolean).join('\n')).join('\n\n')
        : 'Resources: (none)');

    sections.push(templates.length > 0
        ? templates.map((template) => [
            `Template: ${template.name}`,
            `URI Template: ${template.uriTemplate}`,
            template.description ? `Description: ${template.description}` : '',
            template.mimeType ? `MIME: ${template.mimeType}` : '',
        ].filter(Boolean).join('\n')).join('\n\n')
        : 'Resource Templates: (none)');

    return sections.join('\n\n');
}

function formatReadResourceResult(uri: string, result: McpReadResourceResult): string {
    const contents = result.contents ?? [];
    if (contents.length === 0) {
        return `Resource: ${uri}\n\n(empty resource)`;
    }

    return contents.map((entry) => {
        const parts = [
            `Resource: ${typeof entry.uri === 'string' ? entry.uri : uri}`,
            typeof entry.mimeType === 'string' ? `MIME: ${entry.mimeType}` : '',
        ].filter(Boolean);

        if (typeof entry.text === 'string') {
            parts.push(entry.text);
        } else if (typeof entry.blob === 'string') {
            parts.push(`[blob:${entry.blob.length} bytes]`);
        } else {
            parts.push(safeStringify(entry));
        }

        return parts.join('\n\n');
    }).join('\n\n');
}

function formatNotificationMessage(params: unknown): string {
    if (!params || typeof params !== 'object') {
        return safeStringify(params);
    }

    const candidate = params as Record<string, unknown>;
    if (typeof candidate.data === 'string') {
        return candidate.data;
    }

    return safeStringify(params);
}

function safeStringify(value: unknown, maxLength = 2_000): string {
    const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (raw.length <= maxLength) {
        return raw;
    }

    return `${raw.slice(0, maxLength)}…`;
}
