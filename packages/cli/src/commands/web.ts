// ============================================================
// xqoder web — 带 Web UI 的 HTTP 服务（OpenCode 风格）
// ============================================================

import { execSync } from 'node:child_process';
import { Command } from 'commander';
import { configManager, logger, resolveConfigWithEnvOverrides } from '@xqoder/shared';
import { createServer } from '../server/index.js';

export const webCommand = new Command('web')
    .description('启动带 Web 界面的 HTTP 服务（当前为 serve + 占位页）')
    .option('-p, --port <port>', '监听端口', '4096')
    .option('--hostname <host>', '监听地址', '127.0.0.1')
    .option('--mdns', '启用 mDNS 发现')
    .option('--cors <origins>', '允许的 CORS 来源，逗号分隔')
    .action(async (options: { port: string; hostname: string; mdns?: boolean; cors?: string }) => {
        const { config } = resolveConfigWithEnvOverrides(
            configManager.load({ cwd: process.cwd() }),
        );
        const serverConfig = config.server ?? {};
        const port = parseInt(options.port, 10) || (serverConfig.port ?? 4096);
        const hostname = options.hostname || (serverConfig.hostname ?? '127.0.0.1');
        const cors = options.cors
            ? options.cors.split(',').map((s) => s.trim()).filter(Boolean)
            : (serverConfig.cors ?? []);

        const password = process.env.XQODER_SERVER_PASSWORD;
        const username = process.env.XQODER_SERVER_USERNAME ?? 'xqoder';

        const server = createServer({
            port,
            hostname,
            cors: [...cors, `http://${hostname}:${port}`],
            password,
            username,
        });

        server.on('listening', () => {
            const addr = server.address();
            const portNum = typeof addr === 'object' && addr ? addr.port : port;
            const url = `http://${hostname}:${portNum}`;
            logger.success(`XQoder web 已启动: ${url}`);
            logger.info('  Web UI 占位页，完整实现敬请期待');
            try {
                execSync(`open "${url}"`, { stdio: 'ignore' });
            } catch {
                // ignore open failure
            }
        });

        const shutdown = () => {
            logger.info('正在关闭 Web 服务...');
            server.close(() => {
                logger.success('Web 服务已安全关闭');
                process.exit(0);
            });
            setTimeout(() => {
                logger.warn('关闭超时，强制退出');
                process.exit(1);
            }, 5000).unref();
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    });
