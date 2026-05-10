import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    FileMcpTokenStore,
    oauthDisabled,
    type McpTokenStore,
    type StoredMcpToken,
} from '@xqoder/agent';
import { getXQoderPaths, type MCPServerConfig } from '@xqoder/shared';

export interface McpOAuthStatus {
    configured: boolean;
    disabledByEnv: boolean;
    tokenPresent: boolean;
    tokenExpiresAt?: number;
    tokenExpired: boolean;
    refreshTokenPresent: boolean;
    tokenFilePath?: string;
    tokenFileMode?: string;
    tokenFileWorldReadable?: boolean;
    error?: string;
}

export interface CollectOAuthStatusOptions {
    servers: MCPServerConfig[];
    store?: McpTokenStore;
    tokenFilePath?: string;
    now?: () => number;
    clockSkewMs?: number;
    env?: NodeJS.ProcessEnv;
}

export async function collectMcpOAuthStatuses(
    options: CollectOAuthStatusOptions,
): Promise<Map<string, McpOAuthStatus>> {
    const tokenFilePath = options.tokenFilePath ?? defaultTokenStorePath();
    const store = options.store ?? new FileMcpTokenStore(tokenFilePath);
    const now = options.now ?? Date.now;
    const skewMs = options.clockSkewMs ?? 30_000;
    const disabledByEnv = oauthDisabled(options.env ?? process.env);

    const fileStatsPromise = statTokenFile(tokenFilePath);
    const results = new Map<string, McpOAuthStatus>();

    for (const server of options.servers) {
        const status: McpOAuthStatus = {
            configured: Boolean(server.oauth),
            disabledByEnv,
            tokenPresent: false,
            tokenExpired: false,
            refreshTokenPresent: false,
        };

        if (!server.oauth) {
            results.set(server.name, status);
            continue;
        }

        try {
            const token = await store.load(server.name);
            if (token) {
                Object.assign(status, describeToken(token, now(), skewMs));
            }
        } catch (error) {
            status.error = error instanceof Error ? error.message : String(error);
        }

        results.set(server.name, status);
    }

    const fileStats = await fileStatsPromise;
    if (fileStats) {
        for (const status of results.values()) {
            if (status.configured) {
                status.tokenFilePath = fileStats.path;
                status.tokenFileMode = fileStats.mode;
                status.tokenFileWorldReadable = fileStats.worldReadable;
            }
        }
    }

    return results;
}

function describeToken(
    token: StoredMcpToken,
    nowMs: number,
    skewMs: number,
): Partial<McpOAuthStatus> {
    const out: Partial<McpOAuthStatus> = {
        tokenPresent: true,
        refreshTokenPresent: Boolean(token.refreshToken),
    };
    if (typeof token.expiresAt === 'number') {
        out.tokenExpiresAt = token.expiresAt;
        out.tokenExpired = nowMs >= token.expiresAt - skewMs;
    }
    return out;
}

interface TokenFileStats {
    path: string;
    mode: string;
    worldReadable: boolean;
}

async function statTokenFile(filePath: string): Promise<TokenFileStats | undefined> {
    try {
        const stats = await fs.stat(filePath);
        const modeOctal = (stats.mode & 0o777).toString(8).padStart(3, '0');
        return {
            path: filePath,
            mode: `0${modeOctal}`,
            worldReadable: Boolean(stats.mode & 0o004),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

export function defaultTokenStorePath(): string {
    const paths = getXQoderPaths(os.homedir());
    return path.join(paths.dataDir, 'mcp-tokens.json');
}
