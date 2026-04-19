import { describe, expect, it } from 'bun:test';
import type { LSPServerConfig } from '../../src/infra/shared/index.js';
import {
    inspectLspServers,
    type LspInspectionClient,
} from '../../src/core/agent/lsp-inspection.js';
import type { LspManagerOptions, LspServerInspection } from '../../src/core/agent/lsp.js';

const CAPABILITIES: LspServerInspection['capabilities'] = {
    workspaceSymbols: true,
    definition: true,
    references: false,
    diagnostics: true,
    hover: true,
    completion: false,
    completionResolve: false,
    rename: false,
};

describe('lsp server inspection', () => {
    it('inspects enabled servers and reports disabled servers without opening a client', async () => {
        const createdClients: string[] = [];
        const closedClients: string[] = [];
        const options: LspManagerOptions = {
            cwd: '/repo',
            projectRoot: '/repo',
            servers: [
                {
                    name: 'disabled-ts',
                    enabled: false,
                    command: 'typescript-language-server',
                    args: ['--stdio'],
                    extensions: ['.ts'],
                },
                {
                    name: 'tcp-go',
                    transport: 'tcp',
                    host: '127.0.0.1',
                    port: 4389,
                    extensions: ['.go'],
                },
            ],
        };

        const inspections = await inspectLspServers(options, (server) => {
            createdClients.push(server.name);
            return createClient(server, closedClients);
        });

        expect(createdClients).toEqual(['tcp-go']);
        expect(closedClients).toEqual(['tcp-go']);
        expect(inspections).toEqual([
            {
                name: 'disabled-ts',
                enabled: false,
                status: 'disabled',
                transport: 'stdio',
                command: 'typescript-language-server',
                args: ['--stdio'],
                cwd: undefined,
                extensions: ['.ts'],
                languageId: undefined,
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
            },
            {
                name: 'tcp-go',
                enabled: true,
                status: 'ok',
                transport: 'tcp',
                args: [],
                host: '127.0.0.1',
                port: 4389,
                cwd: undefined,
                extensions: ['.go'],
                languageId: undefined,
                serverInfo: { name: 'tcp-go-lsp', version: '1.0.0' },
                capabilities: CAPABILITIES,
            },
        ]);
    });

    it('returns error inspections and still closes failed clients', async () => {
        const closedClients: string[] = [];
        const options: LspManagerOptions = {
            cwd: '/repo',
            projectRoot: '/repo',
            servers: [
                {
                    name: 'broken',
                    command: 'broken-lsp',
                    extensions: ['.broken'],
                    languageId: 'broken',
                },
            ],
        };

        const inspections = await inspectLspServers(options, (server) => createClient(server, closedClients, {
            failInitialize: true,
        }));

        expect(closedClients).toEqual(['broken']);
        expect(inspections).toEqual([
            {
                name: 'broken',
                enabled: true,
                status: 'error',
                transport: 'stdio',
                command: 'broken-lsp',
                args: [],
                cwd: undefined,
                extensions: ['.broken'],
                languageId: 'broken',
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
                error: 'broken failed to initialize',
            },
        ]);
    });

    it('keeps the lsp.ts facade export available', async () => {
        const lspModule = await import('../../src/core/agent/lsp.js');

        expect(typeof lspModule.inspectLspServers).toBe('function');
    });

});

function createClient(
    server: LSPServerConfig,
    closedClients: string[],
    options: { failInitialize?: boolean } = {},
): LspInspectionClient {
    return {
        async initialize() {
            if (options.failInitialize) {
                throw new Error(`${server.name} failed to initialize`);
            }
        },
        async close() {
            closedClients.push(server.name);
        },
        getInspection() {
            return {
                serverInfo: { name: `${server.name}-lsp`, version: '1.0.0' },
                capabilities: CAPABILITIES,
            };
        },
    };
}
