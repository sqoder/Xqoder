// ============================================================
// xqoder uninstall — 卸载 XQoder（OpenCode 风格）
// ============================================================

import * as path from 'node:path';
import { Command } from 'commander';
import { logger, getXQoderPaths } from '@xqoder/shared';
import * as fs from 'node:fs';

export const uninstallCommand = new Command('uninstall')
    .description('卸载 XQoder 并移除相关文件')
    .option('-c, --keep-config', '保留配置文件')
    .option('-d, --keep-data', '保留 session 和快照数据')
    .option('--dry-run', '仅显示将要移除的内容，不实际删除')
    .option('-f, --force', '跳过确认提示')
    .action(async (options: { keepConfig?: boolean; keepData?: boolean; dryRun?: boolean; force?: boolean }) => {
        const paths = getXQoderPaths();
        const toRemove: string[] = [];

        if (!options.keepConfig && paths.configFile) {
            if (fs.existsSync(paths.configFile)) {
                toRemove.push(paths.configFile);
            }
        }

        if (!options.keepData && paths.dataDir) {
            if (fs.existsSync(paths.dataDir)) {
                toRemove.push(paths.dataDir);
            }
        }

        if (options.dryRun) {
            logger.info('dry-run 模式，将要移除:');
            for (const p of toRemove) {
                logger.info(`  - ${p}`);
            }
            return;
        }

        if (!options.force) {
            logger.warn('uninstall 将移除上述路径，请确认后使用 --force 执行');
            logger.info('或使用 --dry-run 查看将要移除的内容');
            return;
        }

        for (const p of toRemove) {
            if (fs.existsSync(p)) {
                fs.rmSync(p, { recursive: true });
                logger.success(`已移除: ${p}`);
            }
        }
    });
