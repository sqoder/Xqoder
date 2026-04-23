import { Command } from 'commander';
import { runAuthLoginCommand } from '../core/auth.js';
import { logger } from '@xqoder/shared';

/**
 * xqoder login — Claude-compatible top-level login command
 */
export const loginCommand = new Command('login')
    .description('Authenticate with a provider (defaults to anthropic)')
    .argument('[provider]', 'Provider name (e.g. anthropic, openai)', 'anthropic')
    .option('--api-key <key>', 'API Key')
    .option('--base-url <url>', 'Custom Base URL')
    .action(async (provider, opts) => {
        if (!opts.apiKey) {
            logger.error('API key is required. Use --api-key <key>');
            process.exit(1);
        }
        try {
            runAuthLoginCommand(provider, {
                apiKey: opts.apiKey,
                baseUrl: opts.baseUrl
            });
        } catch (error) {
            logger.error(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
            process.exit(1);
        }
    });
