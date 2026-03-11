// ============================================================
// xqoder upgrade — 升级 XQoder（OpenCode 风格）
// ============================================================

import { execSync } from 'node:child_process';
import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import { getXQoderVersion } from '../version.js';

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

export const upgradeCommand = new Command('upgrade')
    .description('升级 XQoder 到最新版本或指定版本')
    .argument('[target]', '目标版本，如 latest 或 0.2.0')
    .option('-m, --method <method>', '安装方式: npm | pnpm | bun | brew | auto', 'auto')
    .option('--dry-run', '仅显示将执行的命令，不实际执行')
    .action(async (target: string | undefined, opts: { method: string; dryRun?: boolean }) => {
        const currentVersion = getXQoderVersion();
        logger.info(`当前版本: ${currentVersion}`);

        const method: Exclude<InstallMethod, 'auto'> =
            opts.method === 'auto' ? detectMethod() : (opts.method as Exclude<InstallMethod, 'auto'>);

        const cmd = INSTALL_COMMANDS[method];
        if (!cmd) {
            logger.error(`不支持的安装方式: ${opts.method}`);
            logger.info('支持: npm, pnpm, bun, brew, auto');
            process.exit(1);
        }

        const fullCmd = [...cmd];
        if (target && method !== 'brew') {
            fullCmd[fullCmd.length - 1] = `xqoder@${target}`;
        }

        const cmdStr = fullCmd.join(' ');

        if (opts.dryRun) {
            logger.info(`[dry-run] 将执行: ${cmdStr}`);
            return;
        }

        logger.info(`执行: ${cmdStr}`);

        try {
            execSync(cmdStr, { stdio: 'inherit' });
            logger.success('升级完成');

            try {
                const newVersion = execSync('xqoder --version', { encoding: 'utf8' }).trim();
                if (newVersion !== currentVersion) {
                    logger.success(`${currentVersion} → ${newVersion}`);
                } else {
                    logger.info('版本未变化，可能已是最新');
                }
            } catch {
                logger.info('请运行 xqoder --version 确认新版本');
            }
        } catch (err) {
            logger.error(`升级失败: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
