import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { ConfigManager } from '@xqoder/shared';
import {
    commandExists,
    createMcpCommand,
    runAddMcpServerCommand,
    runDoctorMcpCommand,
    runListMcpCommand,
    runRemoveMcpCommand,
    runShowMcpCommand,
    runToggleMcpCommand,
} from '../../src/commands/integrations/mcp.js';
import {
    createIdeCommand,
    createIdeSnapshot,
    runShowIdeCommand,
    runShowIdeDiagnosticsCommand,
    runShowIdeStateCommand,
} from '../../src/commands/system/ide.js';
import {
    createMemoryCommand,
    runInitMemoryCommand,
    runMemoryPathCommand,
    runMigrateMemoryCommand,
    runShowMemoryCommand,
} from '../../src/commands/system/memory.js';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('memory command compatibility surface', () => {
    it('restores root/show/path/init/migrate helpers with json and force support', () => {
        const cwd = createTempDir();
        const output: string[] = [];
        const command = createMemoryCommand();

        expect(command.commands.map((subcommand) => subcommand.name())).toEqual([
            'show',
            'path',
            'init',
            'migrate',
        ]);

        const init = runInitMemoryCommand({ cwd, json: true }, { writeOutput: (line) => output.push(line) });
        const memoryPath = runMemoryPathCommand({ cwd, json: true }, { writeOutput: (line) => output.push(line) });

        expect(init.changed).toBe(true);
        expect(memoryPath.claudePath).toBe(path.join(cwd, 'CLAUDE.md'));
        expect(JSON.parse(output[0] ?? '{}')).toMatchObject({
            changed: true,
            claudeExists: true,
        });

        fs.writeFileSync(path.join(cwd, 'XQoder.md'), '# Legacy instructions\n', 'utf-8');
        const migrate = runMigrateMemoryCommand({ cwd, force: true }, { writeOutput: (line) => output.push(line) });
        const show = runShowMemoryCommand({ cwd, json: true }, { writeOutput: (line) => output.push(line) });

        expect(migrate.changed).toBe(true);
        expect(show.content).toBe('# Legacy instructions\n');
        expect(JSON.parse(output.at(-1) ?? '{}')).toMatchObject({
            activeExists: true,
            content: '# Legacy instructions\n',
        });
    });

    it('returns the Claude compatibility path when only .claude/CLAUDE.md exists', () => {
        const cwd = createTempDir();
        const compatPath = path.join(cwd, '.claude', 'CLAUDE.md');
        const output: string[] = [];
        const initOutput: string[] = [];
        const migrateOutput: string[] = [];

        fs.mkdirSync(path.dirname(compatPath), { recursive: true });
        fs.writeFileSync(compatPath, '# Compat memory\n', 'utf-8');
        fs.writeFileSync(path.join(cwd, 'XQoder.md'), '# Legacy memory\n', 'utf-8');

        const memoryPath = runMemoryPathCommand({ cwd }, { writeOutput: (line) => output.push(line) });
        const init = runInitMemoryCommand({ cwd }, { writeOutput: (line) => initOutput.push(line) });
        const migrate = runMigrateMemoryCommand({ cwd, force: true }, { writeOutput: (line) => migrateOutput.push(line) });
        const snapshot = runShowMemoryCommand({ cwd, json: true }, { writeOutput: () => {} });

        expect(memoryPath.preferredClaudePath).toBe(compatPath);
        expect(output[0]).toBe(compatPath);
        expect(init.changed).toBe(false);
        expect(initOutput[0]).toContain(compatPath);
        expect(initOutput[0]).not.toContain(path.join(cwd, 'CLAUDE.md'));
        expect(migrate.changed).toBe(true);
        expect(migrateOutput[0]).toContain(compatPath);
        expect(migrateOutput[0]).not.toContain(path.join(cwd, 'CLAUDE.md'));
        expect(snapshot).toMatchObject({
            claudeCompatExists: true,
            activePath: compatPath,
            content: '# Legacy memory\n',
        });
    });
});

describe('mcp command compatibility surface', () => {
    it('restores management subcommands and preserves project-scoped writes', () => {
        const cwd = createTempDir();
        const manager = createConfigManager();
        const output: string[] = [];
        const command = createMcpCommand();
        const serverCwd = path.join(cwd, 'server');
        const localCommandPath = path.join(cwd, 'local-mcp-server');
        fs.writeFileSync(localCommandPath, '', 'utf-8');

        expect(command.commands.map((subcommand) => subcommand.name())).toEqual([
            'list',
            'show',
            'add',
            'remove',
            'enable',
            'disable',
            'doctor',
            'auth',
            'debug',
        ]);
        expect(commandExists(localCommandPath)).toBe(true);

        runAddMcpServerCommand('local', {
            dir: cwd,
            transport: 'stdio',
            command: 'node',
            arg: ['server.js'],
            env: ['TOKEN=abc'],
            cwd: serverCwd,
            timeoutMs: 123,
            json: true,
        }, { writeOutput: (line) => output.push(line) });
        runAddMcpServerCommand('remote', {
            dir: cwd,
            transport: 'http',
            url: 'https://mcp.example.test',
            header: ['Authorization=Bearer test'],
            disabled: true,
            timeoutMs: 456,
        }, { writeOutput: (line) => output.push(line) });

        const savedConfig = JSON.parse(fs.readFileSync(path.join(cwd, '.xqoder', 'config.json'), 'utf-8'));
        expect(savedConfig.mcp.servers).toMatchObject([
            {
                name: 'local',
                transport: 'stdio',
                command: 'node',
                args: ['server.js'],
                env: { TOKEN: 'abc' },
                cwd: serverCwd,
                enabled: true,
                timeoutMs: 123,
            },
            {
                name: 'remote',
                transport: 'http',
                url: 'https://mcp.example.test',
                headers: { Authorization: 'Bearer test' },
                enabled: false,
                timeoutMs: 456,
            },
        ]);

        const list = runListMcpCommand({ dir: cwd, json: true }, { writeOutput: (line) => output.push(line) }, manager);
        const detail = runShowMcpCommand('remote', { dir: cwd, json: true }, { writeOutput: (line) => output.push(line) }, manager);
        const disabled = runToggleMcpCommand('local', false, { dir: cwd, json: true }, { writeOutput: (line) => output.push(line) });
        const removed = runRemoveMcpCommand('remote', { dir: cwd }, { writeOutput: (line) => output.push(line) });

        expect(list.servers.map((server) => server.name)).toEqual(['local', 'remote']);
        expect(detail).toMatchObject({
            name: 'remote',
            transport: 'http',
            source: path.join(cwd, '.xqoder', 'config.json'),
        });
        expect(disabled.server).toMatchObject({
            name: 'local',
            enabled: false,
        });
        expect(removed.message).toContain('Removed MCP server "remote"');
    });

    it('runs doctor through an injectable inspection seam', async () => {
        const cwd = createTempDir();
        const manager = createConfigManager();
        const output: string[] = [];
        const inspectedServerNames: string[][] = [];

        runAddMcpServerCommand('remote', {
            dir: cwd,
            transport: 'sse',
            url: 'https://mcp.example.test/events',
        }, { writeOutput: () => {} });

        const inspections = await runDoctorMcpCommand('remote', { dir: cwd, json: true }, {
            writeOutput: (line) => output.push(line),
            inspectServers: async (options) => {
                inspectedServerNames.push(options.servers.map((server) => server.name));
                return [{
                    name: 'remote',
                    status: 'ok',
                    transport: 'sse',
                    toolCount: 0,
                    promptCount: 0,
                    resourceCount: 0,
                    resourceTemplateCount: 0,
                    tools: [],
                    prompts: [],
                    resources: [],
                    resourceTemplates: [],
                }] as any;
            },
        }, manager);

        expect(inspectedServerNames).toEqual([['remote']]);
        expect(inspections[0]?.name).toBe('remote');
        expect(JSON.parse(output[0] ?? '[]')[0]).toMatchObject({
            name: 'remote',
            status: 'ok',
        });
    });
});

describe('ide command compatibility surface', () => {
    it('restores root/status snapshot helpers and keeps bridge diagnostics injectable', async () => {
        const cwd = createTempDir();
        const output: string[] = [];
        const command = createIdeCommand();

        expect(command.commands.map((subcommand) => subcommand.name())).toEqual([
            'status',
            'state',
            'diagnostics',
        ]);

        const snapshot = createIdeSnapshot({ dir: cwd, port: '5050' }, { VSCODE_PID: '1' });
        const shown = runShowIdeCommand({ cwd, json: true }, { writeOutput: (line) => output.push(line) }, {
            CURSOR_SESSION_ID: 'cursor-session',
        });

        expect(snapshot).toMatchObject({
            cwd,
            detectedSurfaces: ['vscode'],
            port: 5050,
        });
        expect(snapshot.tuiAttachCommand).toContain('xqoder tui');
        expect(snapshot.runAttachCommand).toContain('xqoder run "<message>" --attach');
        expect(snapshot.attachCommand).toBe(snapshot.tuiAttachCommand);
        expect(snapshot.acpCommand).toBe(snapshot.runAttachCommand);
        expect(shown.detectedSurfaces).toEqual(['cursor']);
        const shownOutput = output[0] ?? '{}';
        expect(shownOutput).not.toContain('xqoder attach');
        expect(shownOutput).not.toContain('xqoder acp');
        expect(shownOutput).toContain('xqoder tui');
        const shownJson = JSON.parse(shownOutput);
        expect(shownJson.runAttachCommand).toContain('xqoder run "<message>" --attach');
        expect(shownJson).toMatchObject({
            cwd,
            detectedSurfaces: ['cursor'],
        });

        const bridge = {
            getActiveState: async () => ({
                activeFile: path.join(cwd, 'src/index.ts'),
                diagnostics: [],
            }),
            getWorkspaceDiagnostics: async () => [{
                file: path.join(cwd, 'src/index.ts'),
                line: 1,
                column: 2,
                severity: 'warning' as const,
                message: 'demo diagnostic',
            }],
        };
        const state = await runShowIdeStateCommand({ dir: cwd }, {
            writeOutput: (line) => output.push(line),
            createBridge: () => bridge,
        });
        const diagnostics = await runShowIdeDiagnosticsCommand({ dir: cwd }, {
            writeOutput: (line) => output.push(line),
            createBridge: () => bridge,
        });

        expect(state.activeFile).toBe(path.join(cwd, 'src/index.ts'));
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.message).toBe('demo diagnostic');
    });
});

function createConfigManager(): ConfigManager {
    return new ConfigManager({ homeDir: createTempDir() });
}

function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xqoder-command-compat-'));
    tempDirs.push(dir);
    return dir;
}
