// ============================================================
// GitHub Copilot Token Auto-Loader
// 参考 OpenCode: internal/config/config.go LoadGitHubToken()
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

interface CopilotHostEntry {
    oauth_token?: string;
}

/**
 * Attempt to load a GitHub Copilot OAuth token from the standard
 * VS Code / GitHub Copilot config locations.
 *
 * Search order:
 *   1. ~/.config/github-copilot/hosts.json
 *   2. ~/.config/github-copilot/apps.json
 *   3. $GITHUB_TOKEN env var
 */
export function loadGitHubCopilotToken(): string | undefined {
    // 1. Environment variable
    if (process.env.GITHUB_TOKEN) {
        return process.env.GITHUB_TOKEN;
    }

    // 2. Copilot config files
    const configBase = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
    const copilotDir = path.join(configBase, 'github-copilot');
    const candidates = ['hosts.json', 'apps.json'];

    for (const filename of candidates) {
        const filePath = path.join(copilotDir, filename);
        const token = extractTokenFromFile(filePath);
        if (token) return token;
    }

    return undefined;
}

function extractTokenFromFile(filePath: string): string | undefined {
    try {
        if (!fs.existsSync(filePath)) return undefined;
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, CopilotHostEntry>;

        for (const [host, entry] of Object.entries(data)) {
            if (host.includes('github.com') && entry.oauth_token) {
                return entry.oauth_token;
            }
        }
    } catch { /* ignore */ }
    return undefined;
}
