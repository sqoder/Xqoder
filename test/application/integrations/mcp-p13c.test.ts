import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigManager } from '@xqoder/shared';
import {
    runAddMcpServerCommand,
    runAuthMcpCommand,
    runDebugMcpCommand,
    runDoctorMcpCommand,
} from '../../../src/commands/integrations/mcp.js';
import {
    collectMcpOAuthStatuses,
} from '../../../src/application/integrations/mcp-oauth-status.js';
import { FileMcpTokenStore, type StoredMcpToken } from '../../../src/core/agent/mcp-oauth.js';
import type {
    McpClientAdapter,
    McpServerInfo,
} from '../../../src/core/agent/mcp-types.js';
import type { MCPServerConfig } from '@xqoder/shared';

const tempDirs: string[] = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

function createTempDir(prefix = 'xqoder-p13c-'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function createManager(): ConfigManager {
    return new ConfigManager({ homeDir: createTempDir('xqoder-home-') });
}

function addOAuthServer(
    _manager: ConfigManager,
    cwd: string,
    name: string,
    overrides: Partial<MCPServerConfig> = {},
): void {
    const configPath = path.join(cwd, '.xqoder.json');
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
        existing = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    }
    const mcp = (existing['mcp'] as { servers?: MCPServerConfig[] } | undefined) ?? {};
    const servers = [...(mcp.servers ?? [])];
    servers.push({
        name,
        transport: 'http',
        url: 'https://mcp.example.test/',
        enabled: true,
        oauth: {
            authorizationUrl: 'https://auth.example.test/authorize',
            tokenUrl: 'https://auth.example.test/token',
            clientId: 'client-xyz',
        },
        ...overrides,
    });
    existing['mcp'] = { ...mcp, servers };
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');
}

function makeTokenFile(): { dir: string; file: string } {
    const dir = createTempDir('xqoder-tokens-');
    return { dir, file: path.join(dir, 'mcp-tokens.json') };
}

async function writeToken(file: string, server: string, token: StoredMcpToken): Promise<void> {
    await new FileMcpTokenStore(file).save(server, token);
}

describe('runAuthMcpCommand', () => {
    it('short-circuits when a usable token already exists (no --force)', async () => {
        const cwd = createTempDir();
        const manager = createManager();
        addOAuthServer(manager, cwd, 'auth-ok');
        const { file } = makeTokenFile();
        const now = 1_700_000_000_000;
        await writeToken(file, 'auth-ok', {
            accessToken: 'ACCESS-1',
            tokenType: 'Bearer',
            expiresAt: now + 60_000,
            obtainedAt: now - 1_000,
        });

        const output: string[] = [];
        const result = await runAuthMcpCommand('auth-ok', { dir: cwd }, {
            store: new FileMcpTokenStore(file),
            now: () => now,
            writeOutput: (line) => output.push(line),
            env: { XQODER_MCP_DISABLE_OAUTH: '0' },
            runOauth: async () => { throw new Error('should not be called'); },
        }, manager);

        expect(result.refreshed).toBe(false);
        expect(output.at(0)).toContain('already authorized');
    });

    it('runs runMcpOauth when --force is set and records token metadata', async () => {
        const cwd = createTempDir();
        const manager = createManager();
        addOAuthServer(manager, cwd, 'auth-forced');
        const { file } = makeTokenFile();
        const now = 1_700_000_100_000;
        const token: StoredMcpToken = {
            accessToken: 'ACCESS-NEW',
            refreshToken: 'REFRESH-NEW',
            tokenType: 'Bearer',
            expiresAt: now + 3600_000,
            obtainedAt: now,
            scope: 'read:tools',
        };

        const output: string[] = [];
        const result = await runAuthMcpCommand('auth-forced', {
            dir: cwd,
            force: true,
            json: true,
        }, {
            store: new FileMcpTokenStore(file),
            now: () => now,
            writeOutput: (line) => output.push(line),
            runOauth: async (server) => {
                expect(server.name).toBe('auth-forced');
                return token;
            },
        }, manager);

        expect(result).toMatchObject({
            server: 'auth-forced',
            refreshed: true,
            hasRefreshToken: true,
            scope: 'read:tools',
        });
        expect(JSON.parse(output[0] ?? '{}').refreshed).toBe(true);
    });

    it('fails fast when server is missing oauth config', async () => {
        const cwd = createTempDir();
        const manager = createManager();
        const project = manager.load({ cwd });
        manager.set({
            ...project,
            mcp: {
                servers: [{
                    name: 'no-oauth',
                    transport: 'stdio',
                    command: '/bin/true',
                    enabled: true,
                }],
            },
        });
        manager.save();

        await expect(runAuthMcpCommand('no-oauth', { dir: cwd }, {}, manager))
            .rejects.toThrow('has no oauth configuration');
    });

    it('fails fast when disabled by env', async () => {
        const cwd = createTempDir();
        const manager = createManager();
        addOAuthServer(manager, cwd, 'auth-disabled');

        await expect(runAuthMcpCommand('auth-disabled', { dir: cwd }, {
            env: { XQODER_MCP_DISABLE_OAUTH: '1' },
        }, manager)).rejects.toThrow('disabled via XQODER_MCP_DISABLE_OAUTH=1');
    });
});

describe('runDebugMcpCommand', () => {
    it('reports handshake + tool list + OAuth status for a healthy server', async () => {
        const cwd = createTempDir();
        const manager = createManager();
        addOAuthServer(manager, cwd, 'debug-ok');
        const { file } = makeTokenFile();
        const now = 1_700_000_200_000;
        await writeToken(file, 'debug-ok', {
            accessToken: 'ACCESS-D',
            tokenType: 'Bearer',
            expiresAt: now + 60_000,
            obtainedAt: now - 100,
        });

        const output: string[] = [];
        const result = await runDebugMcpCommand('debug-ok', { dir: cwd, json: true }, {
            store: new FileMcpTokenStore(file),
            tokenFilePath: file,
            now: () => now,
            writeOutput: (line) => output.push(line),
            createClient: () => createFakeClient([
                { name: 'alpha' }, { name: 'beta' },
            ], { serverInfo: { name: 'debug-fixture', version: '9.9.9' } }),
        }, manager);

        expect(result.handshake.status).toBe('ok');
        expect(result.handshake.toolCount).toBe(2);
        expect(result.tools).toEqual(['alpha', 'beta']);
        expect(result.oauth.configured).toBe(true);
        expect(result.oauth.tokenPresent).toBe(true);
        expect(result.oauth.tokenExpired).toBe(false);
        const parsed = JSON.parse(output[0] ?? '{}');
        expect(parsed.handshake.serverName).toBe('debug-fixture');
    });

    it('records handshake error when client throws', async () => {
        const cwd = createTempDir();
        const manager = createManager();
        addOAuthServer(manager, cwd, 'debug-fail');

        const result = await runDebugMcpCommand('debug-fail', { dir: cwd }, {
            writeOutput: () => { /* discard */ },
            createClient: () => ({
                supportsPrompts: () => false,
                supportsResources: () => false,
                async listTools(): Promise<never> { throw new Error('boom'); },
                async listPrompts() { return []; },
                async listResources() { return []; },
                async listResourceTemplates() { return []; },
                async getPrompt() { return {}; },
                async readResource() { return {}; },
                async callTool() { return {}; },
                async close() { /* noop */ },
            } as McpClientAdapter),
        }, manager);

        expect(result.handshake.status).toBe('error');
        expect(result.handshake.error).toBe('boom');
    });

    it('throws when server name is unknown', async () => {
        const cwd = createTempDir();
        const manager = createManager();
        await expect(runDebugMcpCommand('does-not-exist', { dir: cwd }, {}, manager))
            .rejects.toThrow('not found');
    });
});

describe('runDoctorMcpCommand (OAuth-enriched)', () => {
    it('attaches oauth status to each doctor entry and serializes JSON', async () => {
        const cwd = createTempDir();
        const manager = createManager();
        addOAuthServer(manager, cwd, 'doctor-auth');
        runAddMcpServerCommand('doctor-plain', {
            dir: cwd,
            transport: 'stdio',
            command: '/bin/true',
        }, { writeOutput: () => { /* discard */ } });

        const { file } = makeTokenFile();
        const now = 1_700_000_300_000;
        // Expired token (should render tokenExpired=true)
        await writeToken(file, 'doctor-auth', {
            accessToken: 'STALE',
            tokenType: 'Bearer',
            expiresAt: now - 10_000,
            obtainedAt: now - 1_000_000,
        });

        const output: string[] = [];
        const entries = await runDoctorMcpCommand('doctor-auth', { dir: cwd, json: true }, {
            tokenFilePath: file,
            now: () => now,
            inspectServers: async (opts) => opts.servers.map((s) => ({
                name: s.name,
                status: 'ok',
                transport: s.transport ?? 'stdio',
                command: s.command ?? '-',
                args: s.args ?? [],
                toolCount: 0,
                promptCount: 0,
                resourceCount: 0,
                resourceTemplateCount: 0,
                tools: [],
                prompts: [],
                resources: [],
                resourceTemplates: [],
                enabled: true,
            })),
            writeOutput: (line) => output.push(line),
        }, manager);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.oauth).toMatchObject({
            configured: true,
            tokenPresent: true,
            tokenExpired: true,
            refreshTokenPresent: false,
        });
        const json = JSON.parse(output[0] ?? '[]');
        expect(json[0].oauth.tokenExpired).toBe(true);
    });
});

describe('collectMcpOAuthStatuses', () => {
    it('flags world-readable token files via mode bits', async () => {
        const { file } = makeTokenFile();
        await writeToken(file, 's1', {
            accessToken: 'T',
            tokenType: 'Bearer',
            expiresAt: Date.now() + 60_000,
            obtainedAt: Date.now(),
        });
        fs.chmodSync(file, 0o644); // deliberately insecure

        const statuses = await collectMcpOAuthStatuses({
            servers: [{
                name: 's1',
                transport: 'http',
                url: 'https://x',
                oauth: {
                    authorizationUrl: 'https://a',
                    tokenUrl: 'https://t',
                    clientId: 'c',
                },
            }],
            tokenFilePath: file,
            env: {},
        });

        const s1 = statuses.get('s1');
        expect(s1?.tokenFileMode).toBe('0644');
        expect(s1?.tokenFileWorldReadable).toBe(true);
    });
});

type FakeClientInit = {
    serverInfo?: McpServerInfo;
};

function createFakeClient(
    tools: Array<{ name: string; description?: string }>,
    init: FakeClientInit = {},
): McpClientAdapter {
    return {
        protocolVersion: '2025-11-25',
        serverInfo: init.serverInfo,
        supportsPrompts: () => false,
        supportsResources: () => false,
        async listTools() { return tools; },
        async listPrompts() { return []; },
        async listResources() { return []; },
        async listResourceTemplates() { return []; },
        async getPrompt() { return {}; },
        async readResource() { return {}; },
        async callTool() { return {}; },
        async close() { /* noop */ },
    };
}
