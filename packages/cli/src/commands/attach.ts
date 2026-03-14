// ============================================================
// xqoder attach — 连接远程 xqoder serve 后端（OpenCode 风格）
// ============================================================

import * as path from 'node:path';
import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import { runTuiCommand } from './tui.js';

export const attachCommand = new Command('attach')
    .description('连接运行中的 xqoder serve 后端')
    .argument('[url]', '后端 URL，如 http://localhost:4096')
    .option('-d, --dir <dir>', 'TUI 工作目录', '.')
    .option('-s, --session <id>', '指定 session ID 继续')
    .action(async (url: string | undefined, options: { dir: string; session?: string }) => {
        const baseUrl = url?.trim();
        if (baseUrl) {
            logger.info(`attach 到 ${baseUrl}`);
        }
        try {
            await runTuiCommand({
                dir: path.resolve(options.dir),
                session: options.session,
                ...(baseUrl ? { attachBaseUrl: baseUrl } : {}),
            });
        } catch (err) {
            logger.error(`attach 失败: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
