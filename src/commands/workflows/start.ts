// ============================================================
// xqoder start — Start project (XQoder workflow)
// ============================================================

import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import { ProjectRuntime } from '@xqoder/runtime';

export const startCommand = new Command('start')
    .description('Start project — auto-detect project type and run')
    .option('-d, --dir <dir>', 'Project directory', '.')
    .option('-p, --port <port>', 'Specify port', parseInt)
    .option('-c, --command <cmd>', 'Custom start command')
    .action(async (options: { dir: string; port?: number; command?: string }) => {
        logger.info('▶️  XQoder Start — Project Startup');
        logger.info(`📁 Directory: ${options.dir}`);

        try {
            const runtime = new ProjectRuntime();
            const result = await runtime.start(options.dir, {
                command: options.command,
                port: options.port,
            });

            if (result.url) {
                logger.success(`🌐 Project running at: ${result.url}`);
            }

            if (result.errors.length > 0) {
                logger.warn(`⚠️  Detected ${result.errors.length} error(s):`);
                for (const err of result.errors) {
                    logger.error(`  ${err.message}`);
                }
            }

            // Keep process running
            logger.info('Press Ctrl+C to stop the project');
            let stopping = false;
            const shutdown = async () => {
                if (stopping) return;
                stopping = true;
                logger.info('Stopping project...');
                const timeout = setTimeout(() => {
                    logger.warn('Stop timed out, forcing exit');
                    process.exit(1);
                }, 10000);
                timeout.unref();
                try {
                    await runtime.stop();
                    logger.success('Project stopped safely');
                } catch (e) {
                    logger.error(`Stop error: ${e instanceof Error ? e.message : String(e)}`);
                }
                clearTimeout(timeout);
                process.exit(0);
            };
            process.on('SIGINT', () => void shutdown());
            process.on('SIGTERM', () => void shutdown());
        } catch (err) {
            logger.error(`Start failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
