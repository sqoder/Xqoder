import { Command } from 'commander';
import { runUpgrade } from './upgrade.js';

/**
 * xqoder update — Claude-compatible alias for upgrade
 */
export const updateCommand = new Command('update')
    .description('Update XQoder to the latest version (alias for upgrade)')
    .argument('[target]', 'Target version, e.g. latest or 0.2.0')
    .option('-m, --method <method>', 'Installation method: npm | pnpm | bun | brew | auto', 'auto')
    .option('--dry-run', 'Show command without executing')
    .action(runUpgrade);
