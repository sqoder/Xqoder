// P21c — `xqoder logout <provider>` / `xqoder auth status`.

import { Command } from 'commander';
import { getSharedCredentialsManager } from '../../application/config/credentials.js';
import type { CredentialsManager } from '../../shared/auth/index.js';

export interface AuthLogoutDependencies {
    credentialsManager?: CredentialsManager;
    writeOutput?: (line: string) => void;
}

function writer(dependencies: AuthLogoutDependencies): (line: string) => void {
    return dependencies.writeOutput ?? ((line) => process.stdout.write(line + '\n'));
}

export async function runLogout(
    provider: string,
    dependencies: AuthLogoutDependencies = {},
): Promise<{ provider: string; removed: boolean }> {
    const credentialsManager = dependencies.credentialsManager ?? getSharedCredentialsManager();
    const existing = await credentialsManager.load(provider);
    if (!existing) {
        writer(dependencies)('logout: no credentials stored for ' + provider);
        return { provider, removed: false };
    }
    await credentialsManager.delete(provider);
    writer(dependencies)('logout ok: ' + provider);
    return { provider, removed: true };
}

export async function runStatus(
    dependencies: AuthLogoutDependencies = {},
): Promise<Array<{ provider: string; expiresAt?: number }>> {
    const credentialsManager = dependencies.credentialsManager ?? getSharedCredentialsManager();
    const write = writer(dependencies);
    const providers = await credentialsManager.listProviders();
    if (providers.length === 0) {
        write('no providers logged in');
        return [];
    }
    const report: Array<{ provider: string; expiresAt?: number }> = [];
    for (const provider of providers.sort()) {
        const tokens = await credentialsManager.load(provider);
        if (!tokens) continue;
        if (tokens.expiresAt) {
            const iso = new Date(tokens.expiresAt).toISOString();
            write(provider + ': logged in (expires ' + iso + ')');
            report.push({ provider, expiresAt: tokens.expiresAt });
        } else {
            write(provider + ': logged in');
            report.push({ provider });
        }
    }
    return report;
}

export function createAuthLogoutCommand(dependencies: AuthLogoutDependencies = {}): Command {
    return new Command('logout')
        .description('Remove stored OAuth credentials for a provider.')
        .argument('<provider>', 'Provider name')
        .action(async (provider: string) => {
            try {
                await runLogout(provider, dependencies);
            } catch (error) {
                process.stderr.write('auth logout failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
                process.exit(1);
            }
        });
}

export function createAuthStatusCommand(dependencies: AuthLogoutDependencies = {}): Command {
    return new Command('status')
        .description('List providers with stored OAuth credentials.')
        .action(async () => {
            try {
                await runStatus(dependencies);
            } catch (error) {
                process.stderr.write('auth status failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
                process.exit(1);
            }
        });
}
