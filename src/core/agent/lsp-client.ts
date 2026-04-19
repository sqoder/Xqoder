import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    logger as defaultLogger,
    type Logger,
    type LSPServerConfig,
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
    containsUnsupportedWorkspaceChanges,
    delay,
    extractCompletionItems,
    formatServerMessage,
    parseDiagnosticReport,
    parseHoverResult,
    parseLocationResult,
    parseWorkspaceEditResult,
    resolveLanguageId,
    supportsProvider,
    toCompletionMatch,
    toDiagnosticMatch,
    toFilePath,
    toLspPosition,
    toWorkspaceSymbolMatch,
} from './lsp-utils.js';
import {
    LspClientTransportController,
    startLspClientTransport,
} from './lsp-client-transport.js';
import {
    type JsonRpcMessage,
    LspRpcMessagePipeline,
} from './lsp-rpc-pipeline.js';

const LSP_CLIENT_INFO = {
    name: 'xqoder',
    version: '0.1.0',
};

interface LspInitializeResult {
    capabilities?: Record<string, unknown>;
    serverInfo?: {
        name: string;
        version?: string;
    };
}

interface TrackedDocument {
    uri: string;
    version: number;
    text: string;
    languageId: string;
}

export class StdioLanguageServerClient {
    private transport?: LspClientTransportController;
    private readonly diagnosticsCache = new Map<string, DiagnosticMatch[]>();
    private readonly documents = new Map<string, TrackedDocument>();
    private readonly logger: Logger;
    private readonly rpc: LspRpcMessagePipeline;
    private initialized = false;
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
        this.rpc = new LspRpcMessagePipeline({
            logger: this.logger,
            getTimeoutMs: () => this.config.timeoutMs ?? 15_000,
            handleMessage: (message) => this.handleIncomingMessage(message),
        });
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
        if (!this.transport) {
            return;
        }

        const transport = this.transport;

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

        this.transport = undefined;
        this.rpc.clearTransport();
        this.initialized = false;
        this.capabilities = {};
        this.documents.clear();
        this.diagnosticsCache.clear();

        await transport.close();
    }

    private async startTransport(): Promise<void> {
        const transport = await startLspClientTransport(this.config, {
            cwd: this.options.cwd,
            projectRoot: this.options.projectRoot,
            logger: this.logger,
            onData: (chunk) => this.rpc.handleIncomingChunk(chunk),
            onTransportError: (error) => this.rpc.rejectAllPending(error),
        });
        this.transport = transport;
        this.rpc.setOutput(transport.output);
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

    private async handleIncomingMessage(message: JsonRpcMessage): Promise<void> {
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
        this.rpc.sendNotification(method, params);
    }

    private sendRaw(message: JsonRpcMessage): void {
        this.rpc.sendRaw(message);
    }

    private async sendRequest<T>(method: string, params: unknown): Promise<T> {
        return this.rpc.sendRequest<T>(method, params);
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
        await this.rpc.drainMessages();
    }
}

export function createStdioLanguageServerClient(
    server: LSPServerConfig,
    options: Omit<LspManagerOptions, 'servers'> & { logger?: Logger },
): StdioLanguageServerClient {
    return new StdioLanguageServerClient(server, options);
}
