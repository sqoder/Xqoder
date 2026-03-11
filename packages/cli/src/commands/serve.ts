// ============================================================
// xqoder serve — 无头 HTTP 服务（OpenCode 风格）
// ============================================================

import * as path from 'node:path';
import { Command } from 'commander';
import { configManager, logger, resolveConfigWithEnvOverrides } from '@xqoder/shared';
import { createServer } from '../server/index.js';

export const serveCommand = new Command('serve')
    .description('启动无头 HTTP 服务，供 attach/web 使用')
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
            cors,
            password,
            username,
        });

        server.on('listening', () => {
            const addr = server.address();
            const portNum = typeof addr === 'object' && addr ? addr.port : port;
            logger.success(`XQoder serve 已启动: http://${hostname}:${portNum}`);
            logger.info(`  /global/health — 健康检查`);
            logger.info(`  /doc — API 文档`);
        });

        const shutdown = () => {
            logger.info('正在关闭服务...');
            server.close(() => {
                logger.success('服务已安全关闭');
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
