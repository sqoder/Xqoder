import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { type Readable, type Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    logger as defaultLogger,
    type Logger,
    type LSPServerConfig,
    type LSPTcpServerConfig,
} from '@xqoder/shared';

const LSP_CLIENT_INFO = {
    name: 'xqoder',
    version: '0.1.0',
};

interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: string | number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

interface LspInitializeResult {
    capabilities?: Record<string, unknown>;
    serverInfo?: {
        name: string;
        version?: string;
    };
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

interface TrackedDocument {
    uri: string;
    version: number;
    text: string;
    languageId: string;
}

interface LspManagerOptions {
    servers: LSPServerConfig[];
    cwd: string;
    projectRoot: string;
    logger?: Logger;
}

export interface WorkspaceSymbolMatch {
    kind: string;
    name: string;
    filePath: string;
    line: number;
    character: number;
    preview: string;
    containerName?: string;
}

export interface DiagnosticMatch {
    severity: string;
    code: string;
    filePath: string;
    line: number;
    character: number;
    message: string;
}

export interface LocationMatch {
    filePath: string;
    line: number;
    character: number;
    preview: string;
    kind?: string;
}

export interface HoverMatch {
    contents: string;
    range?: {
        line: number;
        character: number;
        endLine: number;
        endCharacter: number;
    };
}

export interface CompletionMatch {
    label: string;
    kind?: string;
    detail?: string;
    documentation?: string;
    insertText?: string;
    sortText?: string;
    resolved?: boolean;
}

export interface TextEditMatch {
    filePath: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
    newText: string;
}

export interface RenameMatch {
    filePaths: string[];
    edits: TextEditMatch[];
    totalEdits: number;
    placeholder?: string;
}

export interface LspServerInspection {
    name: string;
    enabled: boolean;
    status: 'ok' | 'error' | 'disabled';
    transport: 'stdio' | 'tcp';
    command?: string;
    args: string[];
    host?: string;
    port?: number;
    cwd?: string;
    extensions: string[];
    languageId?: string;
    serverInfo?: {
        name: string;
        version?: string;
    };
    capabilities: {
        workspaceSymbols: boolean;
        definition: boolean;
        references: boolean;
        diagnostics: boolean;
        hover: boolean;
        completion: boolean;
        completionResolve: boolean;
        rename: boolean;
    };
    error?: string;
}

class StdioLanguageServerClient {
    private child?: ChildProcessWithoutNullStreams;
    private bootstrapChild?: ChildProcessWithoutNullStreams;
    private socket?: net.Socket;
    private input?: Readable;
    private output?: Writable;
    private readonly pendingRequests = new Map<string | number, PendingRequest>();
    private readonly diagnosticsCache = new Map<string, DiagnosticMatch[]>();
    private readonly documents = new Map<string, TrackedDocument>();
    private readonly logger: Logger;
    private stdoutBuffer = Buffer.alloc(0);
    private nextId = 1;
    private initialized = false;
    private messageQueue: Promise<void> = Promise.resolve();
    private capabilities: Record<string, unknown> = {};
    private serverInfo?: {
        name: string;
        version?: string;
    };

    constructor(
        private readonly config: LSPServerConfig,
        private readonly options: Omit<LspManagerOptions, 'servers'>,
    ) {
        this.logger = (options.logger ?? defaultLogger).child(`LSP:${config.name}`);
    }

    getInspection(): Pick<LspServerInspection, 'serverInfo' | 'capabilities'> {
        return {
            serverInfo: this.serverInfo,
            capabilities: {
                workspaceSymbols: this.supportsWorkspaceSymbols(),
                definition: this.supportsDefinition(),
                references: this.supportsReferences(),
                diagnostics: this.supportsDiagnostics(),
                hover: this.supportsHover(),
                completion: this.supportsCompletion(),
                completionResolve: this.supportsCompletionResolve(),
                rename: this.supportsRename(),
            },
        };
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        await this.startTransport();

        const result = await this.sendRequest<LspInitializeResult>('initialize', {
            processId: process.pid,
            clientInfo: LSP_CLIENT_INFO,
            rootUri: pathToFileURL(this.options.projectRoot).toString(),
            workspaceFolders: [
                {
                    uri: pathToFileURL(this.options.projectRoot).toString(),
                    name: path.basename(this.options.projectRoot),
                },
            ],
            capabilities: {
                workspace: {
                    applyEdit: true,
                    workspaceEdit: {
                        documentChanges: true,
                    },
                    symbol: {},
                },
                textDocument: {
                    definition: {},
                    references: {},
                    diagnostic: {},
                    publishDiagnostics: {},
                    hover: {
                        contentFormat: ['markdown', 'plaintext'],
                    },
                    completion: {
                        completionItem: {
                            documentationFormat: ['markdown', 'plaintext'],
                            resolveSupport: {
                                properties: ['detail', 'documentation', 'additionalTextEdits'],
                            },
                            snippetSupport: false,
                        },
                    },
                    rename: {
                        prepareSupport: true,
                    },
                },
            },
            initializationOptions: this.config.initializationOptions,
        });

        this.capabilities = result.capabilities ?? {};
        this.serverInfo = result.serverInfo;
        this.initialized = true;
        this.sendNotification('initialized', {});
        await this.drainMessages();
    }

    async close(): Promise<void> {
        if (!this.child && !this.socket) {
            return;
        }

        const child = this.child;
        const bootstrapChild = this.bootstrapChild;
        const socket = this.socket;

        try {
            if (this.initialized) {
                try {
                    await this.sendRequest('shutdown', null);
                } catch {
                    // ignore
                }
                this.sendNotification('exit', null);
            }
        } catch {
            // ignore
        }

        this.child = undefined;
        this.bootstrapChild = undefined;
        this.socket = undefined;
        this.input = undefined;
        this.output = undefined;
        this.initialized = false;
        this.capabilities = {};
        this.documents.clear();
        this.diagnosticsCache.clear();

        if (child) {
            child.stdout.removeAllListeners();
            child.stderr.removeAllListeners();
            if (!child.killed) {
                child.kill();
            }
        }

        if (socket) {
            socket.removeAllListeners();
            socket.destroy();
        }

        if (bootstrapChild) {
            bootstrapChild.stdout.removeAllListeners();
            bootstrapChild.stderr.removeAllListeners();
            if (!bootstrapChild.killed) {
                bootstrapChild.kill();
            }
        }

        if (child && child.exitCode === null && child.signalCode === null) {
            try {
                await once(child, 'exit');
            } catch {
                // ignore
            }
        }

        if (bootstrapChild && bootstrapChild.exitCode === null && bootstrapChild.signalCode === null) {
            try {
                await once(bootstrapChild, 'exit');
            } catch {
                // ignore
            }
        }
    }

    private async startTransport(): Promise<void> {
        if (isTcpServerConfig(this.config)) {
            await this.startTcpTransport();
            return;
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
        this.attachTransport(child.stdout, child.stdin);
        child.stderr.setEncoding('utf-8');
        child.stderr.on('data', (chunk: string) => {
            this.logTransportLines(chunk);
        });
        child.once('error', (error) => {
            this.rejectAllPending(new Error(`LSP 进程启动失败: ${error.message}`));
        });
        child.once('exit', (code, signal) => {
            const reason = code !== null
                ? `退出码 ${code}`
                : `信号 ${signal ?? 'unknown'}`;
            this.rejectAllPending(new Error(`LSP 进程已退出 (${reason})`));
        });
    }

    private async startTcpTransport(): Promise<void> {
        const tcpConfig = this.config as LSPTcpServerConfig;
        if (this.config.command) {
            const child = spawn(this.config.command, this.config.args ?? [], {
                cwd: resolveServerCwd(this.config.cwd, this.options.projectRoot, this.options.cwd),
                env: {
                    ...process.env,
                    ...(this.config.env ?? {}),
                },
                stdio: 'pipe',
            });
            this.bootstrapChild = child;
            child.stdout.setEncoding('utf-8');
            child.stderr.setEncoding('utf-8');
            child.stdout.on('data', (chunk: string) => {
                this.logTransportLines(chunk);
            });
            child.stderr.on('data', (chunk: string) => {
                this.logTransportLines(chunk);
            });
            child.once('error', (error) => {
                this.logger.warn(`TCP LSP bootstrap 失败: ${error.message}`);
            });
            child.once('exit', (code, signal) => {
                const reason = code !== null
                    ? `退出码 ${code}`
                    : `信号 ${signal ?? 'unknown'}`;
                this.logger.debug(`TCP LSP bootstrap 退出 (${reason})`);
            });
        }

        const host = tcpConfig.host;
        const port = tcpConfig.port;
        const socket = await connectTcpSocket({
            host,
            port,
            timeoutMs: tcpConfig.timeoutMs ?? 15_000,
        });

        this.socket = socket;
        this.attachTransport(socket, socket);
        socket.on('error', (error) => {
            this.rejectAllPending(new Error(`LSP TCP 连接异常: ${error.message}`));
        });
        socket.on('close', () => {
            this.rejectAllPending(new Error(`LSP TCP 连接已关闭: ${host}:${port}`));
        });
    }

    private attachTransport(input: Readable, output: Writable): void {
        this.input = input;
        this.output = output;
        input.on('data', (chunk: Buffer | string) => {
            this.handleStdoutChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
        });
    }

    private logTransportLines(chunk: string): void {
        for (const line of chunk.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
            this.logger.warn(line);
        }
    }

    supportsWorkspaceSymbols(): boolean {
        return supportsProvider(this.capabilities['workspaceSymbolProvider']);
    }

    supportsDefinition(): boolean {
        return supportsProvider(this.capabilities['definitionProvider']);
    }

    supportsReferences(): boolean {
        return supportsProvider(this.capabilities['referencesProvider']);
    }

    supportsDiagnostics(): boolean {
        return supportsProvider(this.capabilities['diagnosticProvider']);
    }

    supportsHover(): boolean {
        return supportsProvider(this.capabilities['hoverProvider']);
    }

    supportsCompletion(): boolean {
        return supportsProvider(this.capabilities['completionProvider']);
    }

    supportsCompletionResolve(): boolean {
        const completionProvider = this.capabilities['completionProvider'];
        return typeof completionProvider === 'object'
            && completionProvider !== null
            && (completionProvider as Record<string, unknown>)['resolveProvider'] === true;
    }

    supportsRename(): boolean {
        return supportsProvider(this.capabilities['renameProvider']);
    }

    supportsPrepareRename(): boolean {
        const renameProvider = this.capabilities['renameProvider'];
        return typeof renameProvider === 'object'
            && renameProvider !== null
            && (renameProvider as Record<string, unknown>)['prepareProvider'] === true;
    }

    matchesFile(filePath: string): boolean {
        const extension = path.extname(filePath).toLowerCase();
        return this.config.extensions.some((entry) => entry.toLowerCase() === extension);
    }

    async findWorkspaceSymbols(query: string, limit: number): Promise<WorkspaceSymbolMatch[]> {
        await this.initialize();
        if (!this.supportsWorkspaceSymbols()) {
            return [];
        }

        const result = await this.sendRequest<unknown[]>('workspace/symbol', { query });
        return (Array.isArray(result) ? result : [])
            .map((item) => toWorkspaceSymbolMatch(item))
            .filter((entry): entry is WorkspaceSymbolMatch => entry !== null)
            .slice(0, limit);
    }

    async getFileDiagnostics(filePath: string): Promise<DiagnosticMatch[]> {
        await this.initialize();
        const tracked = await this.syncDocument(filePath);

        if (this.supportsDiagnostics()) {
            try {
                const report = await this.sendRequest<Record<string, unknown>>('textDocument/diagnostic', {
                    textDocument: {
                        uri: tracked.uri,
                    },
                });
                const diagnostics = parseDiagnosticReport(filePath, report);
                if (diagnostics.length > 0) {
                    this.diagnosticsCache.set(tracked.uri, diagnostics);
                }
                return diagnostics;
            } catch (error) {
                if (!(error instanceof Error) || !error.message.includes('-32601')) {
                    throw error;
                }
            }
        }

        await this.waitForPublishedDiagnostics(tracked.uri);
        return this.diagnosticsCache.get(tracked.uri) ?? [];
    }

    async findDefinitions(filePath: string, line: number, character: number): Promise<LocationMatch[]> {
        await this.initialize();
        const tracked = await this.syncDocument(filePath);

        if (!this.supportsDefinition()) {
            return [];
        }

        const result = await this.sendRequest<unknown>('textDocument/definition', {
            textDocument: {
                uri: tracked.uri,
            },
            position: toLspPosition(line, character),
        });

        return parseLocationResult(result);
    }

    async findReferences(
        filePath: string,
        line: number,
        character: number,
        limit: number,
    ): Promise<LocationMatch[]> {
        await this.initialize();
        const tracked = await this.syncDocument(filePath);

        if (!this.supportsReferences()) {
            return [];
        }

        const result = await this.sendRequest<unknown[]>('textDocument/references', {
            textDocument: {
                uri: tracked.uri,
            },
            position: toLspPosition(line, character),
            context: {
                includeDeclaration: true,
            },
        });

        return parseLocationResult(result).slice(0, limit);
    }

    async getHover(filePath: string, line: number, character: number): Promise<HoverMatch | null> {
        await this.initialize();
        const tracked = await this.syncDocument(filePath);

        if (!this.supportsHover()) {
            return null;
        }

        const result = await this.sendRequest<unknown>('textDocument/hover', {
            textDocument: {
                uri: tracked.uri,
            },
            position: toLspPosition(line, character),
        });

        return parseHoverResult(result);
    }

    async getCompletions(
        filePath: string,
        line: number,
        character: number,
        limit: number,
        resolveDetails = false,
        resolveLimit = Math.min(limit, 5),
    ): Promise<CompletionMatch[]> {
        await this.initialize();
        const tracked = await this.syncDocument(filePath);

        if (!this.supportsCompletion()) {
            return [];
        }

        const result = await this.sendRequest<unknown>('textDocument/completion', {
            textDocument: {
                uri: tracked.uri,
            },
            position: toLspPosition(line, character),
        });

        const completionItems = extractCompletionItems(result).slice(0, limit);
        const matches = completionItems
            .map((entry) => toCompletionMatch(entry))
            .filter((entry): entry is CompletionMatch => entry !== null);

        if (resolveDetails && this.supportsCompletionResolve()) {
            const cappedResolveLimit = Math.min(matches.length, Math.max(0, resolveLimit));
            for (let index = 0; index < cappedResolveLimit; index += 1) {
                const resolved = await this.sendRequest<unknown>('completionItem/resolve', completionItems[index]);
                const resolvedMatch = toCompletionMatch(resolved);
                if (resolvedMatch) {
                    matches[index] = {
                        ...matches[index],
                        ...resolvedMatch,
                        resolved: true,
                    };
                }
            }
        }

        return matches;
    }

    async renameSymbol(
        filePath: string,
        line: number,
        character: number,
        newName: string,
    ): Promise<RenameMatch | null> {
        await this.initialize();
        const tracked = await this.syncDocument(filePath);

        if (!this.supportsRename()) {
            return null;
        }

        if (this.supportsPrepareRename()) {
            const prepared = await this.sendRequest<unknown>('textDocument/prepareRename', {
                textDocument: {
                    uri: tracked.uri,
                },
                position: toLspPosition(line, character),
            });

            if (!prepared) {
                throw new Error('当前位置不可重命名');
            }
        }

        const result = await this.sendRequest<unknown>('textDocument/rename', {
            textDocument: {
                uri: tracked.uri,
            },
            position: toLspPosition(line, character),
            newName,
        });

        return parseWorkspaceEditResult(result);
    }

    private async syncDocument(filePath: string): Promise<TrackedDocument> {
        const resolvedPath = path.resolve(filePath);
        const uri = pathToFileURL(resolvedPath).toString();
        const text = fs.readFileSync(resolvedPath, 'utf-8');
        const existing = this.documents.get(uri);

        if (!existing) {
            const tracked: TrackedDocument = {
                uri,
                version: 1,
                text,
                languageId: resolveLanguageId(this.config, resolvedPath),
            };
            this.documents.set(uri, tracked);
            this.sendNotification('textDocument/didOpen', {
                textDocument: {
                    uri,
                    languageId: tracked.languageId,
                    version: tracked.version,
                    text,
                },
            });
            await this.drainMessages();
            return tracked;
        }

        if (existing.text !== text) {
            const next = {
                ...existing,
                version: existing.version + 1,
                text,
            };
            this.documents.set(uri, next);
            this.sendNotification('textDocument/didChange', {
                textDocument: {
                    uri,
                    version: next.version,
                },
                contentChanges: [
                    { text },
                ],
            });
            await this.drainMessages();
            return next;
        }

        return existing;
    }

    private handleStdoutChunk(chunk: Buffer): void {
        this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

        while (true) {
            const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
                return;
            }

            const header = this.stdoutBuffer.slice(0, headerEnd).toString('utf8');
            const contentLength = parseContentLength(header);
            if (contentLength === null) {
                throw new Error(`无效的 LSP 头部: ${header}`);
            }

            const messageStart = headerEnd + 4;
            const messageEnd = messageStart + contentLength;
            if (this.stdoutBuffer.length < messageEnd) {
                return;
            }

            const payload = this.stdoutBuffer.slice(messageStart, messageEnd).toString('utf8');
            this.stdoutBuffer = this.stdoutBuffer.slice(messageEnd);
            this.handleIncomingPayload(payload);
        }
    }

    private handleIncomingPayload(payload: string): void {
        let message: JsonRpcMessage;

        try {
            message = JSON.parse(payload) as JsonRpcMessage;
        } catch (error) {
            this.logger.warn(`忽略无法解析的 LSP 消息: ${payload}`);
            this.logger.debug(String(error));
            return;
        }

        this.messageQueue = this.messageQueue
            .then(() => this.handleIncomingMessage(message))
            .catch((error) => {
                this.logger.warn(`处理 LSP 消息失败: ${error instanceof Error ? error.message : String(error)}`);
            });
    }

    private async handleIncomingMessage(message: JsonRpcMessage): Promise<void> {
        if (message.id !== undefined && message.method === undefined) {
            const pending = this.pendingRequests.get(message.id);
            if (!pending) {
                return;
            }

            clearTimeout(pending.timer);
            this.pendingRequests.delete(message.id);

            if (message.error) {
                pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
                return;
            }

            pending.resolve(message.result);
            return;
        }

        if (!message.method) {
            return;
        }

        if (message.id !== undefined) {
            await this.handleServerRequest(message);
            return;
        }

        if (message.method === 'textDocument/publishDiagnostics') {
            this.recordPublishedDiagnostics(message.params);
            return;
        }

        if (message.method === 'window/logMessage' || message.method === 'window/showMessage') {
            this.logger.info(formatServerMessage(message.params));
            return;
        }
    }

    private async handleServerRequest(message: JsonRpcMessage): Promise<void> {
        try {
            switch (message.method) {
                case 'workspace/applyEdit': {
                    const result = this.applyWorkspaceEditRequest(message.params);
                    this.sendRaw({
                        jsonrpc: '2.0',
                        id: message.id,
                        result,
                    });
                    return;
                }
                default:
                    this.sendRaw({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: {
                            code: -32601,
                            message: `Method not found: ${message.method}`,
                        },
                    });
            }
        } catch (error) {
            this.sendRaw({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                    applied: false,
                    failureReason: error instanceof Error ? error.message : String(error),
                },
            });
        }
    }

    private recordPublishedDiagnostics(params: unknown): void {
        if (!params || typeof params !== 'object') {
            return;
        }

        const candidate = params as Record<string, unknown>;
        if (typeof candidate.uri !== 'string' || !Array.isArray(candidate.diagnostics)) {
            return;
        }

        const filePath = toFilePath(candidate.uri);
        if (!filePath) {
            return;
        }

        const diagnostics = candidate.diagnostics
            .map((entry) => toDiagnosticMatch(entry, filePath))
            .filter((match): match is DiagnosticMatch => match !== null);

        this.diagnosticsCache.set(candidate.uri, diagnostics);
    }

    private applyWorkspaceEditRequest(params: unknown): {
        applied: boolean;
        failureReason?: string;
    } {
        if (!params || typeof params !== 'object') {
            return {
                applied: false,
                failureReason: 'workspace/applyEdit 缺少 params',
            };
        }

        const candidate = params as Record<string, unknown>;
        if (!candidate['edit'] || typeof candidate['edit'] !== 'object') {
            return {
                applied: false,
                failureReason: 'workspace/applyEdit 缺少 edit',
            };
        }

        const edit = candidate['edit'] as Record<string, unknown>;
        if (containsUnsupportedWorkspaceChanges(edit)) {
            return {
                applied: false,
                failureReason: '当前仅支持 text edit 类型的 workspace/applyEdit',
            };
        }

        const renameMatch = parseWorkspaceEditResult(edit);
        if (!renameMatch || renameMatch.edits.length === 0) {
            return { applied: true };
        }

        applyWorkspaceEdits(renameMatch.edits);

        for (const filePath of renameMatch.filePaths) {
            const uri = pathToFileURL(filePath).toString();
            const tracked = this.documents.get(uri);
            if (!tracked) {
                continue;
            }

            this.documents.set(uri, {
                ...tracked,
                version: tracked.version + 1,
                text: fs.readFileSync(filePath, 'utf-8'),
            });
        }

        return {
            applied: true,
        };
    }

    notify(method: string, params: unknown): void {
        this.sendNotification(method, params);
    }

    private sendNotification(method: string, params: unknown): void {
        this.sendRaw({
            jsonrpc: '2.0',
            method,
            params,
        });
    }

    private sendRaw(message: JsonRpcMessage): void {
        if (!this.output || !this.output.writable) {
            throw new Error('LSP transport 不可写');
        }

        const payload = JSON.stringify(message);
        const bytes = Buffer.byteLength(payload, 'utf8');
        this.output.write(`Content-Length: ${bytes}\r\n\r\n${payload}`, 'utf8');
    }

    private async sendRequest<T>(method: string, params: unknown): Promise<T> {
        const id = this.nextId++;
        const timeoutMs = this.config.timeoutMs ?? 15_000;

        const result = await new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`LSP 请求超时: ${method}`));
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

        await this.drainMessages();
        return result;
    }

    private rejectAllPending(error: Error): void {
        for (const [id, pending] of this.pendingRequests.entries()) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pendingRequests.delete(id);
        }
    }

    private async waitForPublishedDiagnostics(uri: string): Promise<void> {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            await this.drainMessages();
            if (this.diagnosticsCache.has(uri)) {
                return;
            }
            await delay(25);
        }
    }

    private async drainMessages(): Promise<void> {
        await this.messageQueue;
    }
}

export class ExternalLanguageServerManager {
    private readonly clients = new Map<string, StdioLanguageServerClient>();
    private readonly logger: Logger;

    constructor(private readonly options: LspManagerOptions) {
        this.logger = (options.logger ?? defaultLogger).child('LSP');
    }

    async listWorkspaceSymbols(query: string, limit: number): Promise<WorkspaceSymbolMatch[]> {
        const matches: WorkspaceSymbolMatch[] = [];

        for (const server of this.getEnabledServers()) {
            try {
                const client = this.getClient(server);
                const result = await client.findWorkspaceSymbols(query, limit);
                matches.push(...result);
                if (matches.length >= limit) {
                    break;
                }
            } catch (error) {
                this.logger.warn(`LSP server ${server.name} workspace symbol 失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        return matches.slice(0, limit);
    }

    async getFileDiagnostics(filePath: string): Promise<DiagnosticMatch[]> {
        const client = this.getClientForFile(filePath);
        if (!client) {
            return [];
        }
        return client.getFileDiagnostics(filePath);
    }

    async findDefinitions(filePath: string, line: number, character: number): Promise<LocationMatch[]> {
        const client = this.getClientForFile(filePath);
        if (!client) {
            return [];
        }
        return client.findDefinitions(filePath, line, character);
    }

    async findReferences(filePath: string, line: number, character: number, limit: number): Promise<LocationMatch[]> {
        const client = this.getClientForFile(filePath);
        if (!client) {
            return [];
        }
        return client.findReferences(filePath, line, character, limit);
    }

    async getHover(filePath: string, line: number, character: number): Promise<HoverMatch | null> {
        const client = this.getClientForFile(filePath);
        if (!client) {
            return null;
        }
        return client.getHover(filePath, line, character);
    }

    async getCompletions(
        filePath: string,
        line: number,
        character: number,
        limit: number,
        resolveDetails = false,
        resolveLimit = Math.min(limit, 5),
    ): Promise<CompletionMatch[]> {
        const client = this.getClientForFile(filePath);
        if (!client) {
            return [];
        }
        return client.getCompletions(
            filePath,
            line,
            character,
            limit,
            resolveDetails,
            resolveLimit,
        );
    }

    async renameSymbol(
        filePath: string,
        line: number,
        character: number,
        newName: string,
    ): Promise<RenameMatch | null> {
        const client = this.getClientForFile(filePath);
        if (!client) {
            return null;
        }
        return client.renameSymbol(filePath, line, character, newName);
    }

    hasServerForFile(filePath: string): boolean {
        return this.getEnabledServers().some((server) => server.extensions.some((entry) => entry.toLowerCase() === path.extname(filePath).toLowerCase()));
    }

    notifyFileChanged(filePath: string): void {
        for (const [, client] of this.clients) {
            try {
                client.notify(
                    'workspace/didChangeWatchedFiles',
                    { changes: [{ uri: `file://${filePath}`, type: 2 }] },
                );
            } catch { /* ignore */ }
        }
    }

    async dispose(): Promise<void> {
        await Promise.all(
            Array.from(this.clients.values(), (client) => client.close()),
        );
        this.clients.clear();
    }

    private getClientForFile(filePath: string): StdioLanguageServerClient | undefined {
        const server = this.getEnabledServers().find((entry) => entry.extensions.some((ext) => ext.toLowerCase() === path.extname(filePath).toLowerCase()));
        return server ? this.getClient(server) : undefined;
    }

    private getClient(server: LSPServerConfig): StdioLanguageServerClient {
        const existing = this.clients.get(server.name);
        if (existing) {
            return existing;
        }

        const client = new StdioLanguageServerClient(server, {
            cwd: this.options.cwd,
            projectRoot: this.options.projectRoot,
            logger: this.logger,
        });
        this.clients.set(server.name, client);
        return client;
    }

    private getEnabledServers(): LSPServerConfig[] {
        return this.options.servers.filter((server) => server.enabled !== false);
    }
}

export async function inspectLspServers(options: LspManagerOptions): Promise<LspServerInspection[]> {
    const inspections: LspServerInspection[] = [];

    for (const server of options.servers) {
        if (server.enabled === false) {
            inspections.push({
                name: server.name,
                enabled: false,
                status: 'disabled',
                transport: server.transport ?? 'stdio',
                ...(server.command ? { command: server.command } : {}),
                args: server.args ?? [],
                ...(isTcpServerConfig(server)
                    ? {
                        host: server.host,
                        port: server.port,
                    }
                    : {}),
                cwd: server.cwd,
                extensions: server.extensions,
                languageId: server.languageId,
                capabilities: {
                    workspaceSymbols: false,
                    definition: false,
                    references: false,
                    diagnostics: false,
                    hover: false,
                    completion: false,
                    completionResolve: false,
                    rename: false,
                },
            });
            continue;
        }

        const client = new StdioLanguageServerClient(server, {
            cwd: options.cwd,
            projectRoot: options.projectRoot,
            logger: options.logger,
        });

        try {
            await client.initialize();
            const info = client.getInspection();
            inspections.push({
                name: server.name,
                enabled: true,
                status: 'ok',
                transport: server.transport ?? 'stdio',
                ...(server.command ? { command: server.command } : {}),
                args: server.args ?? [],
                ...(isTcpServerConfig(server)
                    ? {
                        host: server.host,
                        port: server.port,
                    }
                    : {}),
                cwd: server.cwd,
                extensions: server.extensions,
                languageId: server.languageId,
                serverInfo: info.serverInfo,
                capabilities: info.capabilities,
            });
        } catch (error) {
            inspections.push({
                name: server.name,
                enabled: true,
                status: 'error',
                transport: server.transport ?? 'stdio',
                ...(server.command ? { command: server.command } : {}),
                args: server.args ?? [],
                ...(isTcpServerConfig(server)
                    ? {
                        host: server.host,
                        port: server.port,
                    }
                    : {}),
                cwd: server.cwd,
                extensions: server.extensions,
                languageId: server.languageId,
                capabilities: {
                    workspaceSymbols: false,
                    definition: false,
                    references: false,
                    diagnostics: false,
                    hover: false,
                    completion: false,
                    completionResolve: false,
                    rename: false,
                },
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            await client.close();
        }
    }

    return inspections;
}

function parseContentLength(header: string): number | null {
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
        return null;
    }
    return Number.parseInt(match[1] ?? '', 10);
}

function supportsProvider(value: unknown): boolean {
    return value === true || (typeof value === 'object' && value !== null);
}

function isTcpServerConfig(config: LSPServerConfig): config is LSPTcpServerConfig {
    return config.transport === 'tcp';
}

function resolveServerCwd(configuredCwd: string | undefined, projectRoot: string, fallbackCwd: string): string {
    if (!configuredCwd) {
        return fallbackCwd;
    }
    return path.isAbsolute(configuredCwd)
        ? configuredCwd
        : path.resolve(projectRoot, configuredCwd);
}

async function connectTcpSocket(input: {
    host: string;
    port: number;
    timeoutMs: number;
}): Promise<net.Socket> {
    const startedAt = Date.now();
    let lastError: Error | undefined;

    while (Date.now() - startedAt < input.timeoutMs) {
        try {
            return await new Promise<net.Socket>((resolve, reject) => {
                const socket = net.createConnection({
                    host: input.host,
                    port: input.port,
                });
                const attemptTimeout = Math.max(150, Math.min(1_000, input.timeoutMs));
                const timer = setTimeout(() => {
                    socket.destroy(new Error('TCP 连接超时'));
                }, attemptTimeout);

                const cleanup = () => {
                    clearTimeout(timer);
                    socket.off('connect', handleConnect);
                    socket.off('error', handleError);
                };
                const handleConnect = () => {
                    cleanup();
                    socket.setNoDelay(true);
                    resolve(socket);
                };
                const handleError = (error: Error) => {
                    cleanup();
                    socket.destroy();
                    reject(error);
                };

                socket.once('connect', handleConnect);
                socket.once('error', handleError);
            });
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            await delay(75);
        }
    }

    throw new Error(`无法连接到 TCP LSP ${input.host}:${input.port}: ${lastError?.message ?? '未知错误'}`);
}

function resolveLanguageId(config: LSPServerConfig, filePath: string): string {
    if (config.languageId) {
        return config.languageId;
    }
    const extension = path.extname(filePath).replace(/^\./, '');
    return extension || 'plaintext';
}

function toLspPosition(line: number, character: number): { line: number; character: number } {
    return {
        line: Math.max(0, Math.floor(line) - 1),
        character: Math.max(0, Math.floor(character) - 1),
    };
}

function toWorkspaceSymbolMatch(value: unknown): WorkspaceSymbolMatch | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const location = extractLocation(candidate['location']);
    if (!location || typeof candidate['name'] !== 'string') {
        return null;
    }

    return {
        kind: String(candidate['kind'] ?? 'symbol'),
        name: candidate['name'],
        filePath: location.filePath,
        line: location.line,
        character: location.character,
        preview: location.preview,
        ...(typeof candidate['containerName'] === 'string' ? { containerName: candidate['containerName'] } : {}),
    };
}

function parseLocationResult(value: unknown): LocationMatch[] {
    if (Array.isArray(value)) {
        return value
            .map((entry) => extractLocation(entry))
            .filter((location): location is LocationMatch => location !== null);
    }

    const single = extractLocation(value);
    return single ? [single] : [];
}

function parseHoverResult(value: unknown): HoverMatch | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const contents = extractMarkedText(candidate['contents']);
    if (!contents) {
        return null;
    }

    const range = extractLspRange(candidate['range']);

    return {
        contents,
        ...(range ? {
            range: {
                line: range.start.line + 1,
                character: range.start.character + 1,
                endLine: range.end.line + 1,
                endCharacter: range.end.character + 1,
            },
        } : {}),
    };
}

function extractCompletionItems(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
    }

    if (!value || typeof value !== 'object') {
        return [];
    }

    const candidate = value as Record<string, unknown>;
    if (!Array.isArray(candidate['items'])) {
        return [];
    }

    return candidate['items']
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

function toCompletionMatch(value: unknown): CompletionMatch | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate['label'] !== 'string') {
        return null;
    }

    return {
        label: candidate['label'],
        ...(candidate['kind'] !== undefined ? { kind: String(candidate['kind']) } : {}),
        ...(typeof candidate['detail'] === 'string' ? { detail: candidate['detail'] } : {}),
        ...(typeof candidate['insertText'] === 'string' ? { insertText: candidate['insertText'] } : {}),
        ...(typeof candidate['sortText'] === 'string' ? { sortText: candidate['sortText'] } : {}),
        ...(typeof candidate['detail'] === 'string' || extractMarkedText(candidate['documentation']) ? { resolved: true } : {}),
        ...(extractMarkedText(candidate['documentation']) ? { documentation: extractMarkedText(candidate['documentation']) ?? undefined } : {}),
    };
}

function parseWorkspaceEditResult(value: unknown): RenameMatch | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const edits: TextEditMatch[] = [];
    let placeholder: string | undefined;

    if (candidate['changes'] && typeof candidate['changes'] === 'object') {
        for (const [uri, fileEdits] of Object.entries(candidate['changes'] as Record<string, unknown>)) {
            edits.push(...toTextEditMatches(uri, fileEdits));
        }
    }

    if (Array.isArray(candidate['documentChanges'])) {
        for (const change of candidate['documentChanges']) {
            if (!change || typeof change !== 'object') {
                continue;
            }

            const changeRecord = change as Record<string, unknown>;
            if (changeRecord['textDocument'] && Array.isArray(changeRecord['edits'])) {
                const textDocument = changeRecord['textDocument'] as Record<string, unknown>;
                if (typeof textDocument['uri'] === 'string') {
                    edits.push(...toTextEditMatches(textDocument['uri'], changeRecord['edits']));
                }
            }

            if (typeof changeRecord['placeholder'] === 'string') {
                placeholder = changeRecord['placeholder'];
            }
        }
    }

    if (edits.length === 0) {
        return null;
    }

    return {
        filePaths: Array.from(new Set(edits.map((edit) => edit.filePath))),
        edits,
        totalEdits: edits.length,
        ...(placeholder ? { placeholder } : {}),
    };
}

function toTextEditMatches(uri: string, value: unknown): TextEditMatch[] {
    const filePath = toFilePath(uri);
    if (!filePath || !Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }

            const candidate = entry as Record<string, unknown>;
            const range = extractLspRange(candidate['range']);
            if (!range || typeof candidate['newText'] !== 'string') {
                return null;
            }

            return {
                filePath,
                startLine: range.start.line + 1,
                startCharacter: range.start.character + 1,
                endLine: range.end.line + 1,
                endCharacter: range.end.character + 1,
                newText: candidate['newText'],
            };
        })
        .filter((entry): entry is TextEditMatch => entry !== null);
}

function containsUnsupportedWorkspaceChanges(edit: Record<string, unknown>): boolean {
    if (!Array.isArray(edit['documentChanges'])) {
        return false;
    }

    return edit['documentChanges'].some((change) => {
        if (!change || typeof change !== 'object') {
            return true;
        }

        const changeRecord = change as Record<string, unknown>;
        return !(changeRecord['textDocument'] && Array.isArray(changeRecord['edits']));
    });
}

function applyWorkspaceEdits(edits: TextEditMatch[]): void {
    const grouped = new Map<string, TextEditMatch[]>();

    for (const edit of edits) {
        const existing = grouped.get(edit.filePath) ?? [];
        existing.push(edit);
        grouped.set(edit.filePath, existing);
    }

    for (const [filePath, fileEdits] of grouped.entries()) {
        const currentContent = fs.existsSync(filePath)
            ? fs.readFileSync(filePath, 'utf-8')
            : '';
        const nextContent = applyTextEditsToContent(currentContent, fileEdits);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, nextContent, 'utf-8');
    }
}

function applyTextEditsToContent(content: string, edits: TextEditMatch[]): string {
    const normalized = edits
        .map((edit) => ({
            ...edit,
            startOffset: positionToOffset(content, edit.startLine, edit.startCharacter),
            endOffset: positionToOffset(content, edit.endLine, edit.endCharacter),
        }))
        .sort((left, right) => {
            if (left.startOffset !== right.startOffset) {
                return right.startOffset - left.startOffset;
            }
            return right.endOffset - left.endOffset;
        });

    let nextContent = content;
    let lastStart = Number.POSITIVE_INFINITY;

    for (const edit of normalized) {
        if (edit.endOffset > lastStart) {
            throw new Error(`检测到重叠 edit: ${edit.filePath}:${edit.startLine}:${edit.startCharacter}`);
        }
        nextContent = `${nextContent.slice(0, edit.startOffset)}${edit.newText}${nextContent.slice(edit.endOffset)}`;
        lastStart = edit.startOffset;
    }

    return nextContent;
}

function positionToOffset(content: string, line: number, character: number): number {
    const normalizedLine = Math.max(1, Math.floor(line));
    const normalizedCharacter = Math.max(1, Math.floor(character));
    const lines = content.split('\n');
    let offset = 0;

    for (let index = 0; index < normalizedLine - 1 && index < lines.length; index += 1) {
        offset += lines[index].length + 1;
    }

    const targetLine = lines[Math.min(normalizedLine - 1, lines.length - 1)] ?? '';
    return offset + Math.min(targetLine.length, normalizedCharacter - 1);
}

function extractLocation(value: unknown): LocationMatch | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const uriValue = typeof candidate['uri'] === 'string'
        ? candidate['uri']
        : typeof candidate['targetUri'] === 'string'
            ? candidate['targetUri']
            : null;

    const rangeValue = candidate['range'] ?? candidate['targetSelectionRange'];
    if (!uriValue || !rangeValue || typeof rangeValue !== 'object') {
        return null;
    }

    const range = rangeValue as Record<string, unknown>;
    const start = range['start'];
    if (!start || typeof start !== 'object') {
        return null;
    }

    const position = start as Record<string, unknown>;
    const filePath = toFilePath(uriValue);
    if (!filePath) {
        return null;
    }

    const line = Number(position['line']);
    const character = Number(position['character']);

    return {
        filePath,
        line: Number.isFinite(line) ? line + 1 : 1,
        character: Number.isFinite(character) ? character + 1 : 1,
        preview: getLinePreview(filePath, Number.isFinite(line) ? line + 1 : 1),
    };
}

function parseDiagnosticReport(filePath: string, report: Record<string, unknown>): DiagnosticMatch[] {
    const items = Array.isArray(report['items'])
        ? report['items']
        : isRelatedFullReport(report)
            ? (Array.isArray((report['relatedDocuments'] as Record<string, unknown>)?.[pathToFileURL(filePath).toString()]) ? [] : [])
            : [];

    if (Array.isArray(items) && items.length > 0) {
        return items
            .map((entry) => toDiagnosticMatch(entry, filePath))
            .filter((match): match is DiagnosticMatch => match !== null);
    }

    return [];
}

function isRelatedFullReport(report: Record<string, unknown>): boolean {
    return typeof report['kind'] === 'string' && report['kind'] === 'full';
}

function extractLspRange(value: unknown): {
    start: {
        line: number;
        character: number;
    };
    end: {
        line: number;
        character: number;
    };
} | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const start = extractLspPosition(candidate['start']);
    const end = extractLspPosition(candidate['end']);
    if (!start || !end) {
        return null;
    }

    return {
        start,
        end,
    };
}

function extractLspPosition(value: unknown): {
    line: number;
    character: number;
} | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const line = Number(candidate['line']);
    const character = Number(candidate['character']);
    if (!Number.isFinite(line) || !Number.isFinite(character)) {
        return null;
    }

    return {
        line,
        character,
    };
}

function extractMarkedText(value: unknown): string | null {
    if (typeof value === 'string') {
        return value.trim() || null;
    }

    if (Array.isArray(value)) {
        const parts = value
            .map((entry) => extractMarkedText(entry))
            .filter((entry): entry is string => Boolean(entry));
        return parts.length > 0 ? parts.join('\n\n') : null;
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate['value'] === 'string') {
        const prefix = typeof candidate['language'] === 'string'
            ? `\`\`\`${candidate['language']}\n${candidate['value']}\n\`\`\``
            : candidate['value'];
        return prefix.trim() || null;
    }

    return null;
}

function toDiagnosticMatch(value: unknown, filePath: string): DiagnosticMatch | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const range = candidate['range'];
    if (!range || typeof range !== 'object') {
        return null;
    }

    const start = (range as Record<string, unknown>)['start'];
    if (!start || typeof start !== 'object') {
        return null;
    }

    const line = Number((start as Record<string, unknown>)['line']);
    const character = Number((start as Record<string, unknown>)['character']);

    return {
        severity: toDiagnosticSeverity(candidate['severity']),
        code: String(candidate['code'] ?? 'LSP'),
        filePath,
        line: Number.isFinite(line) ? line + 1 : 1,
        character: Number.isFinite(character) ? character + 1 : 1,
        message: String(candidate['message'] ?? ''),
    };
}

function toDiagnosticSeverity(value: unknown): string {
    switch (value) {
        case 1:
            return 'ERROR';
        case 2:
            return 'WARNING';
        case 3:
            return 'INFORMATION';
        case 4:
            return 'HINT';
        default:
            return 'UNKNOWN';
    }
}

function toFilePath(uri: string): string | null {
    try {
        return path.resolve(fileURLToPath(uri));
    } catch {
        return null;
    }
}

function getLinePreview(filePath: string, lineNumber: number): string {
    try {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        return lines[lineNumber - 1]?.trim() ?? '';
    } catch {
        return '';
    }
}

function formatServerMessage(params: unknown): string {
    if (!params || typeof params !== 'object') {
        return String(params ?? '');
    }

    const candidate = params as Record<string, unknown>;
    if (typeof candidate['message'] === 'string') {
        return candidate['message'];
    }

    return JSON.stringify(candidate);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
