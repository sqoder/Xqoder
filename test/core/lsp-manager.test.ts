import { describe, expect, it } from 'bun:test';
import type { LSPServerConfig } from '@xqoder/shared';
import { ExternalLanguageServerManager } from '../../src/core/agent/lsp-manager.js';
import { ExternalLanguageServerManager as ReExportedManager } from '../../src/core/agent/index.js';

describe('ExternalLanguageServerManager', () => {
    it('routes file-scoped requests to matching servers and memoizes clients', async () => {
        const created: string[] = [];
        let closed = 0;

        const manager = new ExternalLanguageServerManager({
            servers: [
                createServer('typescript', ['.ts']),
                createServer('javascript', ['.js']),
            ],
            cwd: '/workspace',
            projectRoot: '/workspace',
            logger: createLogger([]),
        }, (server) => {
            created.push(server.name);
            return server.name === 'typescript'
                ? createClient({
                    getFileDiagnostics: async () => [{
                        severity: 'warning',
                        code: 'TS1000',
                        filePath: '/workspace/example.ts',
                        line: 1,
                        character: 1,
                        message: 'demo',
                    }],
                    close: async () => {
                        closed += 1;
                    },
                })
                : createClient();
        });

        const diagnostics = await manager.getFileDiagnostics('/workspace/example.ts');
        const diagnosticsAgain = await manager.getFileDiagnostics('/workspace/example.ts');

        expect(diagnostics).toHaveLength(1);
        expect(diagnosticsAgain).toEqual(diagnostics);
        expect(created).toEqual(['typescript']);
        expect(await manager.getFileDiagnostics('/workspace/example.py')).toEqual([]);

        await manager.dispose();
        expect(closed).toBe(1);
    });

    it('aggregates workspace symbols across enabled servers and logs failures', async () => {
        const warnings: string[] = [];
        const manager = new ExternalLanguageServerManager({
            servers: [
                createServer('broken', ['.ts']),
                createServer('healthy', ['.js']),
                {
                    ...createServer('disabled', ['.py']),
                    enabled: false,
                },
            ],
            cwd: '/workspace',
            projectRoot: '/workspace',
            logger: createLogger(warnings),
        }, (server) => {
            if (server.name === 'broken') {
                return createClient({
                    findWorkspaceSymbols: async () => {
                        throw new Error('workspace symbol failure');
                    },
                });
            }

            return createClient({
                findWorkspaceSymbols: async () => [
                    {
                        kind: 'function',
                        name: 'alpha',
                        filePath: '/workspace/a.js',
                        line: 1,
                        character: 1,
                        preview: 'function alpha() {}',
                    },
                    {
                        kind: 'function',
                        name: 'beta',
                        filePath: '/workspace/b.js',
                        line: 2,
                        character: 1,
                        preview: 'function beta() {}',
                    },
                ],
            });
        });

        const matches = await manager.listWorkspaceSymbols('a', 1);

        expect(matches).toEqual([
            {
                kind: 'function',
                name: 'alpha',
                filePath: '/workspace/a.js',
                line: 1,
                character: 1,
                preview: 'function alpha() {}',
            },
        ]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('workspace symbol failed');
    });

    it('keeps the extracted manager exported through the package index', () => {
        expect(ReExportedManager).toBe(ExternalLanguageServerManager);
    });
});

function createServer(name: string, extensions: string[]): LSPServerConfig {
    return {
        name,
        command: 'node',
        args: [],
        extensions,
    } as LSPServerConfig;
}

function createClient(overrides: Record<string, unknown> = {}) {
    return {
        findWorkspaceSymbols: async () => [],
        getFileDiagnostics: async () => [],
        findDefinitions: async () => [],
        findReferences: async () => [],
        getHover: async () => null,
        getCompletions: async () => [],
        renameSymbol: async () => null,
        notify: () => {},
        close: async () => {},
        ...overrides,
    };
}

function createLogger(warnings: string[]) {
    const logger = {
        child: () => logger,
        warn: (message: string) => {
            warnings.push(message);
        },
    };

    return logger;
}
