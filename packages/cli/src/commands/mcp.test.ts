import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigManager } from '@xqoder/shared';
import {
    createMcpCommand,
    runDoctorMcpServersCommand,
    runListMcpServersCommand,
    runShowMcpServerCommand,
} from './mcp.js';

const tempDirs: string[] = [];

function createTempConfigPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-cli-mcp-'));
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

describe('mcp command', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    afterEach(() => {
        consoleLog.mockClear();
    });

    afterAll(() => {
        consoleLog.mockRestore();
    });

    it('adds, enables and disables MCP server configs', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        const command = createMcpCommand(manager);

        await command.parseAsync([
            'add',
            'filesystem',
            '--command',
            'node',
            '--arg',
            'server.mjs',
            '--env',
            'API_KEY=secret',
            '--cwd',
            '/workspace/demo',
            '--timeout-ms',
            '5000',
        ], { from: 'user' });

        expect(manager.load().mcp?.servers).toEqual([
            {
                name: 'filesystem',
                transport: 'stdio',
                command: 'node',
                args: ['server.mjs'],
                env: {
                    API_KEY: 'secret',
                },
                cwd: '/workspace/demo',
                enabled: true,
                timeoutMs: 5000,
            },
        ]);

        await command.parseAsync([
            'disable',
            'filesystem',
        ], { from: 'user' });
        expect(manager.load().mcp?.servers[0]?.enabled).toBe(false);

        await command.parseAsync([
            'enable',
            'filesystem',
        ], { from: 'user' });
        expect(manager.load().mcp?.servers[0]?.enabled).toBe(true);
    });

    it('lists and shows configured MCP servers', () => {
        const manager = new ConfigManager(createTempConfigPath());
        manager.load();
        manager.update({
            mcp: {
                servers: [
                    {
                        name: 'filesystem',
                        command: 'node',
                        args: ['server.mjs'],
                        enabled: true,
                        timeoutMs: 15000,
                    },
                ],
            },
        });
        manager.save();

        runListMcpServersCommand({}, {}, manager);
        runShowMcpServerCommand('filesystem', {}, {}, manager);

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('filesystem [enabled]'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('"command": "node"'));
    });

    it('runs doctor through the injected inspector', async () => {
        const manager = new ConfigManager(createTempConfigPath());
        manager.load();
        manager.update({
            mcp: {
                servers: [
                    {
                        name: 'filesystem',
                        command: 'node',
                        args: ['server.mjs'],
                        enabled: true,
                        timeoutMs: 15000,
                    },
                ],
            },
        });
        manager.save();

        await runDoctorMcpServersCommand(undefined, {
            dir: '/workspace/demo',
        }, {
            inspectServers: vi.fn().mockResolvedValue([
                {
                    name: 'filesystem',
                    enabled: true,
                    status: 'ok',
                    transport: 'stdio',
                    command: 'node',
                    args: ['server.mjs'],
                    protocolVersion: '2025-11-25',
                    serverInfo: {
                        name: 'fake-mcp',
                        version: '1.0.0',
                    },
                    toolCount: 2,
                    tools: [
                        {
                            name: 'read_file',
                        },
                        {
                            name: 'write_file',
                        },
                    ],
                    promptCount: 1,
                    prompts: [
                        {
                            name: 'review_project',
                        },
                    ],
                    resourceCount: 1,
                    resources: [
                        {
                            uri: 'docs://readme',
                            name: 'README',
                        },
                    ],
                    resourceTemplateCount: 1,
                    resourceTemplates: [
                        {
                            uriTemplate: 'docs://section/{name}',
                            name: 'Section',
                        },
                    ],
                },
            ]),
        }, manager);

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('filesystem OK transport=stdio tools=2'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('read_file, write_file'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('prompts=review_project'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('resources=docs://readme'));
        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('resourceTemplates=docs://section/{name}'));
    });
});
