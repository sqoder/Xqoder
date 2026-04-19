import * as path from 'node:path';
import { logger as defaultLogger, type Logger, type LSPServerConfig } from '@xqoder/shared';
import type {
    CompletionMatch,
    DiagnosticMatch,
    HoverMatch,
    LocationMatch,
    LspManagerOptions,
    RenameMatch,
    WorkspaceSymbolMatch,
} from './lsp-types.js';
import { createStdioLanguageServerClient } from './lsp.js';

interface ManagedLanguageServerClient {
    findWorkspaceSymbols(query: string, limit: number): Promise<WorkspaceSymbolMatch[]>;
    getFileDiagnostics(filePath: string): Promise<DiagnosticMatch[]>;
    findDefinitions(filePath: string, line: number, character: number): Promise<LocationMatch[]>;
    findReferences(filePath: string, line: number, character: number, limit: number): Promise<LocationMatch[]>;
    getHover(filePath: string, line: number, character: number): Promise<HoverMatch | null>;
    getCompletions(
        filePath: string,
        line: number,
        character: number,
        limit: number,
        resolveDetails?: boolean,
        resolveLimit?: number,
    ): Promise<CompletionMatch[]>;
    renameSymbol(
        filePath: string,
        line: number,
        character: number,
        newName: string,
    ): Promise<RenameMatch | null>;
    notify(method: string, params: unknown): void;
    close(): Promise<void>;
}

export type LspClientFactory = (
    server: LSPServerConfig,
    options: Omit<LspManagerOptions, 'servers'> & { logger: Logger },
) => ManagedLanguageServerClient;

export class ExternalLanguageServerManager {
    private readonly clients = new Map<string, ManagedLanguageServerClient>();
    private readonly logger: Logger;

    constructor(
        private readonly options: LspManagerOptions,
        private readonly createClient: LspClientFactory = createStdioLanguageServerClient,
    ) {
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
                this.logger.warn(`LSP server ${server.name} workspace symbol failed: ${error instanceof Error ? error.message : String(error)}`);
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

    private getClientForFile(filePath: string): ManagedLanguageServerClient | undefined {
        const server = this.getEnabledServers().find((entry) => entry.extensions.some((ext) => ext.toLowerCase() === path.extname(filePath).toLowerCase()));
        return server ? this.getClient(server) : undefined;
    }

    private getClient(server: LSPServerConfig): ManagedLanguageServerClient {
        const existing = this.clients.get(server.name);
        if (existing) {
            return existing;
        }

        const client = this.createClient(server, {
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
