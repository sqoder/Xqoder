import type { ToolDefinition, ToolResult, MCPServerConfig } from '@xqoder/shared';
import type { ITool, ToolApprovalRequest, ToolContext } from './tool.js';
import {
    createMcpAuthProvider,
    FileMcpTokenStore,
    oauthDisabled,
    runMcpOauth,
    type McpTokenStore,
    type RunMcpOauthOptions,
    type StoredMcpToken,
} from '../mcp-oauth.js';

export interface McpAuthToolOptions {
    servers: MCPServerConfig[];
    openBrowser?: (url: string) => void | Promise<void>;
    callbackPorts?: number[];
    store?: McpTokenStore;
    now?: () => number;
    env?: NodeJS.ProcessEnv;
}

export class McpAuthTool implements ITool {
    readonly definition: ToolDefinition = {
        name: 'mcp_auth',
        description: [
            'Run the OAuth 2.1 PKCE flow for a configured MCP server and store the resulting tokens.',
            'Use when an MCP server returns 401 or when refreshing authorization ahead of time.',
            'Set XQODER_MCP_DISABLE_OAUTH=1 to disable this tool entirely (e.g. in CI).',
        ].join('\n'),
        parameters: [
            {
                name: 'server',
                type: 'string',
                description: 'Name of the MCP server (as configured in MCP settings) to authorize.',
                required: true,
            },
            {
                name: 'force',
                type: 'boolean',
                description: 'Re-run the authorization flow even if a usable token is already stored.',
                required: false,
                default: false,
            },
        ],
    };

    constructor(private readonly options: McpAuthToolOptions) { }

    buildApprovalRequest(args: Record<string, unknown>): ToolApprovalRequest {
        const server = String(args['server'] ?? '').trim() || '<unknown>';
        return {
            toolCallId: String(args['toolCallId'] ?? ''),
            toolName: this.definition.name,
            summary: `Run OAuth flow for MCP server: ${server}`,
            reason: 'Opens a browser to an external authorization server and writes tokens to ~/.xqoder/data/mcp-tokens.json',
            risk: 'medium',
        };
    }

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const toolCallId = String(args['toolCallId'] ?? '');
        const name = String(args['server'] ?? '').trim();
        const force = args['force'] === true;

        if (!name) {
            return { toolCallId, success: false, output: '', error: 'server parameter is required' };
        }

        const env = this.options.env ?? process.env;
        if (oauthDisabled(env)) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: 'MCP OAuth is disabled via XQODER_MCP_DISABLE_OAUTH=1',
            };
        }

        const server = this.options.servers.find((entry) => entry.name === name);
        if (!server) {
            return { toolCallId, success: false, output: '', error: `Unknown MCP server: ${name}` };
        }
        if (!server.oauth) {
            return {
                toolCallId,
                success: false,
                output: '',
                error: `MCP server ${name} has no oauth configuration`,
            };
        }

        const store = this.options.store ?? new FileMcpTokenStore();

        if (!force) {
            const provider = createMcpAuthProvider(server, {
                store,
                ...(this.options.now ? { now: this.options.now } : {}),
            });
            const header = await provider?.getAuthHeader();
            if (header) {
                return {
                    toolCallId,
                    success: true,
                    output: `MCP server ${name} already authorized (pass force=true to re-run).`,
                    metadata: { mcpServer: name, refreshed: false },
                };
            }
        }

        const runOptions: RunMcpOauthOptions = {
            store,
            ...(this.options.openBrowser ? { openBrowser: this.options.openBrowser } : {}),
            ...(this.options.callbackPorts ? { callbackPorts: this.options.callbackPorts } : {}),
            ...(this.options.now ? { now: this.options.now } : {}),
        };
        const token: StoredMcpToken = await runMcpOauth(server, runOptions);

        return {
            toolCallId,
            success: true,
            output: summarizeToken(name, token),
            metadata: {
                mcpServer: name,
                refreshed: true,
                hasRefreshToken: Boolean(token.refreshToken),
                expiresAt: token.expiresAt ?? null,
            },
        };
    }
}

function summarizeToken(server: string, token: StoredMcpToken): string {
    const type = token.tokenType ?? 'Bearer';
    const expiresAt = typeof token.expiresAt === 'number'
        ? new Date(token.expiresAt).toISOString()
        : 'never';
    const scope = token.scope ?? '(unspecified)';
    return [
        `MCP server: ${server}`,
        `Token type: ${type}`,
        `Refresh token: ${token.refreshToken ? 'yes' : 'no'}`,
        `Expires at: ${expiresAt}`,
        `Scope: ${scope}`,
    ].join('\n');
}
