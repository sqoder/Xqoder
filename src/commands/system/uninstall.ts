// xqoder uninstall — Uninstall XQoder (XQoder style)
// ============================================================

import { Command } from 'commander';
import { logger, getXQoderPaths } from '@xqoder/shared';
import * as fs from 'node:fs';

export const uninstallCommand = new Command('uninstall')
    .description('Uninstall XQoder and remove related files')
    .option('-c, --keep-config', 'Keep configuration files')
    .option('-d, --keep-data', 'Keep session and snapshot data')
    .option('--dry-run', 'Show content to be removed without deleting')
    .option('-f, --force', 'Skip confirmation prompt')
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
            logger.info('dry-run mode, will remove:');
            for (const p of toRemove) {
                logger.info(`  - ${p}`);
            }
            return;
        }

        if (!options.force) {
            logger.warn('uninstall will remove the paths listed above; use --force to confirm');
            logger.info('or use --dry-run to view what would be removed');
            return;
        }

        for (const p of toRemove) {
            if (fs.existsSync(p)) {
                fs.rmSync(p, { recursive: true });
                logger.success(`Removed: ${p}`);
            }
        }
    });
