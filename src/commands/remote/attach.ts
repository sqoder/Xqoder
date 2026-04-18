// xqoder attach — connect to remote xqoder serve backend (XQoder style)

import * as path from 'node:path';
import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import { runTuiInterface as runTuiCommand } from '../../interfaces/tui/index.js';

export const attachCommand = new Command('attach')
    .description('Connect to a running xqoder serve backend')
    .argument('[url]', 'Backend URL (e.g., http://localhost:4096)')
    .option('-d, --dir <dir>', 'TUI working directory', '.')
    .option('-s, --session <id>', 'Resume specific session ID')
    .action(async (url: string | undefined, options: { dir: string; session?: string }) => {
        const baseUrl = url?.trim();
        if (baseUrl) {
            logger.info(`Attaching to ${baseUrl}`);
        }
        try {
            await runTuiCommand({
                dir: path.resolve(options.dir),
                session: options.session,
                ...(baseUrl ? { attachBaseUrl: baseUrl } : {}),
            });
        } catch (err) {
            logger.error(`Attach failed: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    });
