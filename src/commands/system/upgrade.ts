// xqoder upgrade — Upgrade XQoder (XQoder style)
// ============================================================

import { execSync } from 'node:child_process';
import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import { getXQoderVersion } from '../../cli/version.js';

type InstallMethod = 'npm' | 'pnpm' | 'bun' | 'brew' | 'auto';

const INSTALL_COMMANDS: Record<Exclude<InstallMethod, 'auto'>, string[]> = {
    npm: ['npm', 'install', '-g', 'xqoder'],
    pnpm: ['pnpm', 'add', '-g', 'xqoder'],
    bun: ['bun', 'add', '-g', 'xqoder'],
    brew: ['brew', 'upgrade', 'xqoder'],
};

function detectMethod(): Exclude<InstallMethod, 'auto'> {
    const execPath = process.argv[1] ?? '';

    if (execPath.includes('pnpm')) return 'pnpm';
    if (execPath.includes('bun')) return 'bun';
    if (execPath.includes('brew') || execPath.includes('Cellar')) return 'brew';

    try {
        execSync('pnpm --version', { stdio: 'ignore' });
        return 'pnpm';
    } catch { /* fallback */ }

    return 'npm';
}

export async function runUpgrade(target: string | undefined, opts: { method: string; dryRun?: boolean }) {
    const currentVersion = getXQoderVersion();
    logger.info(`Current version: ${currentVersion}`);

    const method: Exclude<InstallMethod, 'auto'> =
        opts.method === 'auto' ? detectMethod() : (opts.method as Exclude<InstallMethod, 'auto'>);

    const cmd = INSTALL_COMMANDS[method];
    if (!cmd) {
        logger.error(`Unsupported installation method: ${opts.method}`);
        logger.info('Supported: npm, pnpm, bun, brew, auto');
        process.exit(1);
    }

    const fullCmd = [...cmd];
    if (target && method !== 'brew') {
        fullCmd[fullCmd.length - 1] = `xqoder@${target}`;
    }

    const cmdStr = fullCmd.join(' ');

    if (opts.dryRun) {
        logger.info(`[dry-run] Will execute: ${cmdStr}`);
        return;
    }

    logger.info(`Executing: ${cmdStr}`);

    try {
        execSync(cmdStr, { stdio: 'inherit' });
        logger.success('Upgrade completed');

        try {
            const newVersion = execSync('xqoder --version', { encoding: 'utf8' }).trim();
            if (newVersion !== currentVersion) {
                logger.success(`${currentVersion} → ${newVersion}`);
            } else {
                logger.info('Version unchanged, might already be latest');
            }
        } catch {
            logger.info('Run xqoder --version to check new version');
        }
    } catch (err) {
        logger.error(`Upgrade failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

export const upgradeCommand = new Command('upgrade')
    .description('Upgrade XQoder to the latest or specific version')
    .argument('[target]', 'Target version, e.g. latest or 0.2.0')
    .option('-m, --method <method>', 'Installation method: npm | pnpm | bun | brew | auto', 'auto')
    .option('--dry-run', 'Show command without executing')
    .action(runUpgrade);
