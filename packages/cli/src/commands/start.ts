// ============================================================
// xqoder start — 启动项目（XQoder 工作流，原 run）
// ============================================================

import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import { ProjectRuntime } from '@xqoder/runtime';

export const startCommand = new Command('start')
    .description('启动项目 — 自动检测项目类型并运行')
    .option('-d, --dir <dir>', '项目目录', '.')
    .option('-p, --port <port>', '指定端口', parseInt)
    .option('-c, --command <cmd>', '自定义启动命令')
    .action(async (options: { dir: string; port?: number; command?: string }) => {
        logger.info('▶️  XQoder Start — 项目启动');
        logger.info(`📁 目录: ${options.dir}`);

        try {
            const runtime = new ProjectRuntime();
            const result = await runtime.start(options.dir, {
                command: options.command,
                port: options.port,
            });

            if (result.url) {
                logger.success(`🌐 项目运行中: ${result.url}`);
            }

            if (result.errors.length > 0) {
                logger.warn(`⚠️  检测到 ${result.errors.length} 个错误:`);
                for (const err of result.errors) {
                    logger.error(`  ${err.message}`);
                }
            }

            // 保持进程运行
            logger.info('按 Ctrl+C 停止项目');
            let stopping = false;
            const shutdown = async () => {
                if (stopping) return;
                stopping = true;
                logger.info('正在停止项目...');
                const timeout = setTimeout(() => {
                    logger.warn('停止超时，强制退出');
                    process.exit(1);
                }, 10000);
                timeout.unref();
                try {
                    await runtime.stop();
                    logger.success('项目已安全停止');
                } catch (e) {
                    logger.error(`停止出错: ${e instanceof Error ? e.message : String(e)}`);
                }
                clearTimeout(timeout);
                process.exit(0);
            };
            process.on('SIGINT', () => void shutdown());
            process.on('SIGTERM', () => void shutdown());
        } catch (err) {
            logger.error(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
