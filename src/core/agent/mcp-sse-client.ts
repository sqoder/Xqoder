import { logger as defaultLogger, type Logger, type MCPServerConfig } from '@xqoder/shared';
import { buildRoots, hasCapability } from './mcp-utils.js';
import { handleElicitation, type ElicitationRequest } from './mcp-elicitation.js';
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
    timer: ReturnType<typeof setTimeout>;
};

const RECONNECT_BACKOFFS_MS = [250, 500, 1000];

export class McpSseClient implements McpClientAdapter {
    private readonly logger: Logger;
    private readonly pendingRequests = new Map<string | number, PendingRequest>();
    private initialized = false;
    private closed = false;
    private nextId = 1;
    private protocolVersionValue?: string;
    private serverInfoValue?: McpServerInfo;
    private capabilitiesValue?: Record<string, unknown>;
    private toolsCache?: McpToolDescriptor[];
    private promptsCache?: McpPromptDescriptor[];
    private resourcesCache?: McpResourceDescriptor[];
    private resourceTemplatesCache?: McpResourceTemplateDescriptor[];
    private streamAbort?: AbortController;
    private streamError?: Error;

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
        const templates = await this.collectCursorPages<McpResourceTemplateDescriptor, McpResourceTemplatesListResult>(
            'resources/templates/list',
            'resourceTemplates',
        );
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
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.initialized = false;
        this.toolsCache = undefined;
        this.promptsCache = undefined;
        this.resourcesCache = undefined;
        this.resourceTemplatesCache = undefined;

        if (this.streamAbort) {
            this.streamAbort.abort();
            this.streamAbort = undefined;
        }

        for (const [id, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('MCP SSE client closed'));
            this.pendingRequests.delete(id);
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.closed) {
            throw new Error(`MCP SSE client ${this.config.name} is closed`);
        }
        if (this.streamError) {
            throw this.streamError;
        }
        if (this.initialized) {
            return;
        }

        const result = await this.sendRequest<McpInitializeResult>('initialize', {
            protocolVersion: MCP_REQUEST_PROTOCOL_VERSION,
            capabilities: {
                roots: { listChanged: false },
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
            this.logger.debug(`MCP SSE initialized notification failed: ${String(error)}`);
        }

        void this.runStreamLoop();
    }

    private async runStreamLoop(): Promise<void> {
        for (let attempt = 0; attempt <= RECONNECT_BACKOFFS_MS.length; attempt += 1) {
            if (this.closed) {
                return;
            }
            try {
                await this.openStreamOnce();
                return;
            } catch (error) {
                if (this.closed) {
                    return;
                }
                this.logger.debug(`MCP SSE stream failed (attempt ${attempt + 1}): ${String(error)}`);
                if (attempt >= RECONNECT_BACKOFFS_MS.length) {
                    this.streamError = error instanceof Error ? error : new Error(String(error));
                    return;
                }
                await this.delay(RECONNECT_BACKOFFS_MS[attempt]);
            }
        }
    }

    private async openStreamOnce(): Promise<void> {
        const endpoint = this.requireEndpoint();
        const controller = new AbortController();
        this.streamAbort = controller;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                accept: 'text/event-stream',
                'content-type': 'application/json',
                ...(this.config.headers ?? {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'stream/open', params: {} }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`SSE stream HTTP ${response.status}`);
        }
        if (!response.body) {
            throw new Error('SSE stream response missing body');
        }

        await consumeSseStream(response.body, (payload) => {
            this.handleIncomingPayload(payload);
        });
    }

    private handleIncomingPayload(payload: string): void {
        let parsed: JsonRpcRequest | JsonRpcResponse;
        try {
            parsed = JSON.parse(payload) as JsonRpcRequest | JsonRpcResponse;
        } catch {
            this.logger.warn(`Ignoring unparseable MCP SSE payload: ${payload.slice(0, 200)}`);
            return;
        }
        void this.handleIncomingMessage(parsed);
    }

    private async handleIncomingMessage(message: JsonRpcRequest | JsonRpcResponse): Promise<void> {
        if ('id' in message && !('method' in message)) {
            this.settlePending(message);
            return;
        }

        if (!('method' in message)) {
            return;
        }

        if (message.id === undefined) {
            return;
        }

        try {
            const result = await this.handleServerRequest(message.method, message.params);
            await this.sendRaw({ jsonrpc: '2.0', id: message.id, result });
        } catch (error) {
            await this.sendRaw({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }

    private async handleServerRequest(method: string, params: unknown): Promise<unknown> {
        if (method === 'roots/list') {
            return {
                roots: buildRoots(this.options.projectRoot, this.options.allowedPaths),
            };
        }
        if (method === 'ping') {
            return {};
        }
        if (method === 'elicitation/create') {
            return handleElicitation(params as ElicitationRequest, this.options.elicit);
        }
        throw new Error(`Unsupported MCP request: ${method}`);
    }

    private settlePending(message: JsonRpcResponse): void {
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
                items.push(...(chunk as TItem[]));
            }
            cursor = result.nextCursor;
        } while (cursor);
        return items;
    }

    private async sendNotification(method: string, params: unknown): Promise<void> {
        await this.sendRaw({ jsonrpc: '2.0', method, params });
    }

    private async sendRequest<T>(method: string, params: unknown): Promise<T> {
        if (this.closed) {
            throw new Error(`MCP SSE client ${this.config.name} is closed`);
        }
        const id = this.nextId++;
        const timeoutMs = this.config.timeoutMs ?? 15_000;

        const result = new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`MCP request timeout: ${method}`));
            }, timeoutMs);

            this.pendingRequests.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
                timer,
            });
        });

        try {
            const envelope: Record<string, unknown> = { jsonrpc: '2.0', id, method, params };
            const immediate = await this.sendRaw(envelope);
            if (immediate) {
                this.settlePending(immediate);
            }
        } catch (error) {
            const pending = this.pendingRequests.get(id);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(id);
                pending.reject(error instanceof Error ? error : new Error(String(error)));
            }
        }

        return result;
    }

    private async sendRaw(payload: Record<string, unknown>): Promise<JsonRpcResponse | undefined> {
        const endpoint = this.requireEndpoint();
        const timeoutMs = this.config.timeoutMs ?? 15_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const expectsResponse = typeof payload.method === 'string' && typeof payload.id !== 'undefined';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    accept: 'application/json, text/event-stream',
                    'content-type': 'application/json',
                    ...(this.config.headers ?? {}),
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            if (!expectsResponse) {
                // Notification or outbound response — drain and ignore body.
                try { await response.text(); } catch { /* ignore */ }
                return undefined;
            }

            const contentType = response.headers.get('content-type') ?? '';
            if (contentType.includes('text/event-stream')) {
                return await readFirstSseFrame(response);
            }
            const raw = await response.json();
            if (!raw || typeof raw !== 'object') {
                throw new Error('Invalid MCP SSE response');
            }
            return raw as JsonRpcResponse;
        } finally {
            clearTimeout(timer);
        }
    }

    private requireEndpoint(): string {
        const endpoint = this.config.url?.trim();
        if (!endpoint) {
            throw new Error(`MCP server ${this.config.name} missing url for sse transport`);
        }
        return endpoint;
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

async function readFirstSseFrame(response: Response): Promise<JsonRpcResponse> {
    if (!response.body) {
        throw new Error('SSE response missing body');
    }
    let captured: JsonRpcResponse | undefined;
    const abort = new AbortController();
    try {
        await consumeSseStream(
            response.body,
            (payload) => {
                if (captured) {
                    return;
                }
                try {
                    captured = JSON.parse(payload) as JsonRpcResponse;
                } catch {
                    throw new Error('Invalid JSON in SSE frame');
                }
                abort.abort();
            },
            abort.signal,
        );
    } catch (error) {
        if (!captured) {
            throw error instanceof Error ? error : new Error(String(error));
        }
    }
    if (!captured) {
        throw new Error('SSE response produced no data frame');
    }
    return captured;
}

async function consumeSseStream(
    body: ReadableStream<Uint8Array>,
    onData: (payload: string) => void,
    signal?: AbortSignal,
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let dataLines: string[] = [];

    const flush = () => {
        if (dataLines.length === 0) {
            return;
        }
        const payload = dataLines.join('\n');
        dataLines = [];
        onData(payload);
    };

    try {
        while (true) {
            if (signal?.aborted) {
                return;
            }
            const { done, value } = await reader.read();
            if (done) {
                flush();
                return;
            }
            buffer += decoder.decode(value, { stream: true });

            let newlineIndex = buffer.indexOf('\n');
            while (newlineIndex >= 0) {
                const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, '');
                buffer = buffer.slice(newlineIndex + 1);

                if (rawLine === '') {
                    flush();
                } else if (rawLine.startsWith(':')) {
                    // comment line — ignore
                } else if (rawLine.startsWith('data:')) {
                    dataLines.push(rawLine.slice(5).replace(/^ /, ''));
                } else {
                    // event:/id:/retry: — accepted but ignored at this layer
                }

                newlineIndex = buffer.indexOf('\n');
            }
        }
    } catch (error) {
        if (signal?.aborted) {
            return;
        }
        throw error instanceof Error ? error : new Error(String(error));
    } finally {
        try { reader.releaseLock(); } catch { /* ignore */ }
    }
}
