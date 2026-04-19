import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { logger as defaultLogger, type Logger, type MCPServerConfig } from '@xqoder/shared';
import {
    buildRoots,
    formatNotificationMessage,
    hasCapability,
    resolveServerCwd,
} from './mcp-utils.js';
import {
    MCP_CLIENT_INFO,
    MCP_REQUEST_PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    type JsonRpcRequest,
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

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
};

export class McpStdioClient implements McpClientAdapter {
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
