import type { LSPServerConfig } from '@xqoder/shared';
import type { LspManagerOptions, LspServerInspection } from './lsp-types.js';
import { isTcpServerConfig } from './lsp-utils.js';

export interface LspInspectionClient {
    initialize(): Promise<void>;
    close(): Promise<void>;
    getInspection(): Pick<LspServerInspection, 'serverInfo' | 'capabilities'>;
}

export type LspInspectionClientFactory = (
    server: LSPServerConfig,
    options: LspManagerOptions,
) => LspInspectionClient;

const EMPTY_CAPABILITIES: LspServerInspection['capabilities'] = {
    workspaceSymbols: false,
    definition: false,
    references: false,
    diagnostics: false,
    hover: false,
    completion: false,
    completionResolve: false,
    rename: false,
};

export async function inspectLspServers(
    options: LspManagerOptions,
    createClient: LspInspectionClientFactory,
): Promise<LspServerInspection[]> {
    const inspections: LspServerInspection[] = [];

    for (const server of options.servers) {
        if (server.enabled === false) {
            inspections.push({
                ...buildBaseInspection(server),
                enabled: false,
                status: 'disabled',
                capabilities: EMPTY_CAPABILITIES,
            });
            continue;
        }

        const client = createClient(server, options);

        try {
            await client.initialize();
            const info = client.getInspection();
            inspections.push({
                ...buildBaseInspection(server),
                enabled: true,
                status: 'ok',
                serverInfo: info.serverInfo,
                capabilities: info.capabilities,
            });
        } catch (error) {
            inspections.push({
                ...buildBaseInspection(server),
                enabled: true,
                status: 'error',
                capabilities: EMPTY_CAPABILITIES,
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            await client.close();
        }
    }

    return inspections;
}

function buildBaseInspection(server: LSPServerConfig): Pick<
    LspServerInspection,
    'name' | 'transport' | 'command' | 'args' | 'host' | 'port' | 'cwd' | 'extensions' | 'languageId'
> {
    return {
        name: server.name,
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
    };
}
