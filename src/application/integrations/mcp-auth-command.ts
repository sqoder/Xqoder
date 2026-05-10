import * as path from 'node:path';
import {
    createMcpAuthProvider,
    FileMcpTokenStore,
    oauthDisabled,
    runMcpOauth,
    type McpTokenStore,
    type StoredMcpToken,
} from '@xqoder/agent';
import {
    ConfigManager,
    configManager,
    resolveConfigWithEnvOverrides,
    type MCPServerConfig,
} from '@xqoder/shared';

export interface McpAuthCommandOptions {
    dir?: string;
    cwd?: string;
    json?: boolean;
    force?: boolean;
}

export interface McpAuthCommandDependencies {
    writeOutput?: (output: string) => void;
    store?: McpTokenStore;
    openBrowser?: (url: string) => void | Promise<void>;
    callbackPorts?: number[];
    now?: () => number;
    env?: NodeJS.ProcessEnv;
    runOauth?: typeof runMcpOauth;
}

export interface McpAuthCommandResult {
    server: string;
    refreshed: boolean;
    hasRefreshToken: boolean;
    expiresAt: number | null;
    tokenType: string;
    scope: string | null;
    message: string;
}

export async function runAuthMcpCommand(
    name: string,
    options: McpAuthCommandOptions = {},
    dependencies: McpAuthCommandDependencies = {},
    manager: Pick<ConfigManager, 'load'> = configManager,
): Promise<McpAuthCommandResult> {
    const env = dependencies.env ?? process.env;
    if (oauthDisabled(env)) {
        throw new Error('MCP OAuth is disabled via XQODER_MCP_DISABLE_OAUTH=1');
    }

    const projectRoot = path.resolve(options.dir ?? options.cwd ?? process.cwd());
    const server = findOauthServer(name, projectRoot, manager);

    const store = dependencies.store ?? new FileMcpTokenStore();

    if (!options.force) {
        const provider = createMcpAuthProvider(server, {
            store,
            ...(dependencies.now ? { now: dependencies.now } : {}),
        });
        const existing = await provider?.getAuthHeader();
        if (existing) {
            const result: McpAuthCommandResult = {
                server: name,
                refreshed: false,
                hasRefreshToken: false,
                expiresAt: null,
                tokenType: 'Bearer',
                scope: null,
                message: `MCP server "${name}" already authorized (pass --force to re-run).`,
            };
            writeAuthResult(result, options, dependencies);
            return result;
        }
    }

    const runOauth = dependencies.runOauth ?? runMcpOauth;
    const token: StoredMcpToken = await runOauth(server, {
        store,
        ...(dependencies.openBrowser ? { openBrowser: dependencies.openBrowser } : {}),
        ...(dependencies.callbackPorts ? { callbackPorts: dependencies.callbackPorts } : {}),
        ...(dependencies.now ? { now: dependencies.now } : {}),
    });

    const result: McpAuthCommandResult = {
        server: name,
        refreshed: true,
        hasRefreshToken: Boolean(token.refreshToken),
        expiresAt: token.expiresAt ?? null,
        tokenType: token.tokenType ?? 'Bearer',
        scope: token.scope ?? null,
        message: `Authorized MCP server "${name}".`,
    };
    writeAuthResult(result, options, dependencies);
    return result;
}

function findOauthServer(
    name: string,
    projectRoot: string,
    manager: Pick<ConfigManager, 'load'>,
): MCPServerConfig {
    const { config } = resolveConfigWithEnvOverrides(manager.load({ cwd: projectRoot }));
    const server = (config.mcp?.servers ?? []).find((entry) => entry.name === name);
    if (!server) {
        throw new Error(`MCP server "${name}" not found in config.`);
    }
    if (!server.oauth) {
        throw new Error(`MCP server "${name}" has no oauth configuration.`);
    }
    return server;
}

function writeAuthResult(
    result: McpAuthCommandResult,
    options: McpAuthCommandOptions,
    dependencies: McpAuthCommandDependencies,
): void {
    const write = dependencies.writeOutput ?? console.log;
    if (options.json) {
        write(JSON.stringify(result, null, 2));
        return;
    }
    const lines = [result.message];
    if (result.refreshed) {
        const expires = result.expiresAt === null
            ? 'never'
            : new Date(result.expiresAt).toISOString();
        lines.push(`  token type: ${result.tokenType}`);
        lines.push(`  refresh token: ${result.hasRefreshToken ? 'yes' : 'no'}`);
        lines.push(`  expires at: ${expires}`);
        lines.push(`  scope: ${result.scope ?? '(unspecified)'}`);
    }
    write(lines.join('\n'));
}
