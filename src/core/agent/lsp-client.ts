import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { type Readable, type Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import {
    logger as defaultLogger,
    type Logger,
    type LSPServerConfig,
    type LSPTcpServerConfig,
} from '@xqoder/shared';
import type {
    CompletionMatch,
    DiagnosticMatch,
    HoverMatch,
    LocationMatch,
    LspManagerOptions,
    LspServerInspection,
    RenameMatch,
    WorkspaceSymbolMatch,
} from './lsp-types.js';
import {
    applyWorkspaceEdits,
    connectTcpSocket,
    containsUnsupportedWorkspaceChanges,
    delay,
    extractCompletionItems,
    formatServerMessage,
    isTcpServerConfig,
    parseContentLength,
    parseDiagnosticReport,
    parseHoverResult,
    parseLocationResult,
    parseWorkspaceEditResult,
    resolveLanguageId,
    resolveServerCwd,
    supportsProvider,
    toCompletionMatch,
    toDiagnosticMatch,
    toFilePath,
    toLspPosition,
    toWorkspaceSymbolMatch,
} from './lsp-utils.js';

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

export class StdioLanguageServerClient {
    private child?: ChildProcessWithoutNullStreams;
    private bootstrapChild?: ChildProcessWithoutNullStreams;
    private socket?: net.Socket;
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
            this.rejectAllPending(new Error(`LSP process failed to start: ${error.message}`));
        });
        child.once('exit', (code, signal) => {
            const reason = code !== null
                ? `Exit code ${code}`
                : `Signal ${signal ?? 'unknown'}`;
            this.rejectAllPending(new Error(`LSP process exited (${reason})`));
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
                this.logger.warn(`TCP LSP bootstrap failed: ${error.message}`);
            });
            child.once('exit', (code, signal) => {
                const reason = code !== null
                    ? `Exit code ${code}`
                    : `Signal ${signal ?? 'unknown'}`;
                this.logger.debug(`TCP LSP bootstrap exited (${reason})`);
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
            this.rejectAllPending(new Error(`LSP TCP connection error: ${error.message}`));
        });
        socket.on('close', () => {
            this.rejectAllPending(new Error(`LSP TCP connection closed: ${host}:${port}`));
        });
    }

    private attachTransport(input: Readable, output: Writable): void {
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
                throw new Error('Current position cannot be renamed');
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
                throw new Error(`Invalid LSP header: ${header}`);
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
            this.logger.warn(`Ignoring unparseable LSP message: ${payload}`);
            this.logger.debug(String(error));
            return;
        }

        this.messageQueue = this.messageQueue
            .then(() => this.handleIncomingMessage(message))
            .catch((error) => {
                this.logger.warn(`Failed to process LSP message: ${error instanceof Error ? error.message : String(error)}`);
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
                failureReason: 'workspace/applyEdit missing params',
            };
        }

        const candidate = params as Record<string, unknown>;
        if (!candidate['edit'] || typeof candidate['edit'] !== 'object') {
            return {
                applied: false,
                failureReason: 'workspace/applyEdit missing edit',
            };
        }

        const edit = candidate['edit'] as Record<string, unknown>;
        if (containsUnsupportedWorkspaceChanges(edit)) {
            return {
                applied: false,
                failureReason: 'Only text edit types are currently supported for workspace/applyEdit',
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
            throw new Error('LSP transport not writable');
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
                reject(new Error(`LSP request timeout: ${method}`));
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

export function createStdioLanguageServerClient(
    server: LSPServerConfig,
    options: Omit<LspManagerOptions, 'servers'> & { logger?: Logger },
): StdioLanguageServerClient {
    return new StdioLanguageServerClient(server, options);
}
