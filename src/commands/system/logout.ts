import { Command } from 'commander';
import { runAuthLogoutCommand } from '../core/auth.js';
import { logger } from '@xqoder/shared';

/**
 * xqoder logout — Claude-compatible top-level logout command
 */
export const logoutCommand = new Command('logout')
    .description('Clear authentication for a provider (defaults to anthropic)')
    .argument('[provider]', 'Provider name (e.g. anthropic, openai)', 'anthropic')
    .action(async (provider) => {
        try {
            runAuthLogoutCommand(provider);
        } catch (error) {
            logger.error(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    });
