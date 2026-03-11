import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigManager } from '@xqoder/shared';
import {
    createLspCommand,
    runDoctorLspServersCommand,
    runListLspServersCommand,
    runShowLspServerCommand,
} from './lsp.js';

const tempDirs: string[] = [];

function createTempConfigPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-cli-lsp-'));
    tempDirs.push(dir);
    return path.join(dir, 'config.json');
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('lsp command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('adds, enables and disables LSP server configs', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        const command = createLspCommand(manager);

        await command.parseAsync([
            'add',
            'pyright',
            '--command',
            'node',
            '--arg',
            'server.mjs',
            '--extension',
            'py',
            '--language-id',
            'python',
            '--env',
            'API_KEY=secret',
            '--cwd',
            '/workspace/demo',
            '--timeout-ms',
            '5000',
            '--init-json',
            '{"python":{"analysis":{"typeCheckingMode":"basic"}}}',
        ], { from: 'user' });

        expect(manager.load().lsp?.servers).toEqual([
            {
                name: 'pyright',
                transport: 'stdio',
                command: 'node',
                args: ['server.mjs'],
                extensions: ['.py'],
                languageId: 'python',
                env: {
                    API_KEY: 'secret',
                },
                cwd: '/workspace/demo',
                enabled: true,
                timeoutMs: 5000,
                initializationOptions: {
                    python: {
                        analysis: {
                            typeCheckingMode: 'basic',
                        },
                    },
                },
            },
        ]);

        await command.parseAsync([
            'disable',
            'pyright',
        ], { from: 'user' });
        expect(manager.load().lsp?.servers[0]?.enabled).toBe(false);

        await command.parseAsync([
            'enable',
            'pyright',
        ], { from: 'user' });
        expect(manager.load().lsp?.servers[0]?.enabled).toBe(true);
    });

    it('lists and shows configured LSP servers', () => {
        const manager = new ConfigManager(createTempConfigPath());
        manager.load();
        manager.update({
            lsp: {
                servers: [
                    {
                        name: 'pyright',
                        transport: 'stdio',
                        command: 'node',
                        args: ['server.mjs'],
                        extensions: ['.py'],
                        languageId: 'python',
                        enabled: true,
                        timeoutMs: 15000,
                    },
                ],
            },
        });
        manager.save();

        runListLspServersCommand({}, {}, manager);
        runShowLspServerCommand('pyright', {}, {}, manager);

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('pyright [enabled]'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('transport=stdio'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('extensions=.py'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('"languageId": "python"'));
    });

    it('adds TCP LSP server configs', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        const command = createLspCommand(manager);

        await command.parseAsync([
            'add',
            'ruby-lsp',
            '--transport',
            'tcp',
            '--host',
            '127.0.0.1',
            '--port',
            '7658',
            '--command',
            'bundle',
            '--arg',
            'exec',
            '--arg',
            'ruby-lsp',
            '--extension',
            'rb',
            '--language-id',
            'ruby',
        ], { from: 'user' });

        expect(manager.load().lsp?.servers).toEqual([
            {
                name: 'ruby-lsp',
                transport: 'tcp',
                host: '127.0.0.1',
                port: 7658,
                command: 'bundle',
                args: ['exec', 'ruby-lsp'],
                extensions: ['.rb'],
                languageId: 'ruby',
                env: {},
                cwd: undefined,
                enabled: true,
                timeoutMs: 15000,
                initializationOptions: undefined,
            },
        ]);
    });

    it('runs doctor through the injected inspector', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        manager.load();
        manager.update({
            lsp: {
                servers: [
                    {
                        name: 'pyright',
                        command: 'node',
                        args: ['server.mjs'],
                        extensions: ['.py'],
                        languageId: 'python',
                        enabled: true,
                        timeoutMs: 15000,
                    },
                ],
            },
        });
        manager.save();

        await runDoctorLspServersCommand(undefined, {
            dir: '/workspace/demo',
        }, {
            inspectServers: vi.fn().mockResolvedValue([
                {
                    name: 'pyright',
                    transport: 'stdio',
                    enabled: true,
                    status: 'ok',
                    command: 'node',
                    args: ['server.mjs'],
                    extensions: ['.py'],
                    languageId: 'python',
                    serverInfo: {
                        name: 'fake-pyright',
                        version: '1.0.0',
                    },
                    capabilities: {
                        workspaceSymbols: true,
                        definition: true,
                        references: true,
                        diagnostics: true,
                        hover: true,
                        completion: true,
                        completionResolve: true,
                        rename: true,
                    },
                },
            ]),
        }, manager);

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('pyright OK'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('transport=stdio'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('symbols=yes'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('hover=yes'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('completionResolve=yes'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('rename=yes'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('server=fake-pyright@1.0.0'));
    });
});
