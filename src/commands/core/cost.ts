// P15b — xqoder cost CLI command.
import { Command } from 'commander';
import {
    runCostCommand,
    type CostCommandDependencies,
    type CostCommandOptions,
    type CostReport,
} from '../../application/integrations/cost.js';

export {
    runCostCommand,
    type CostCommandDependencies,
    type CostCommandOptions,
    type CostReport,
};

export function createCostCommand(dependencies: CostCommandDependencies = {}): Command {
    return new Command('cost')
        .description('Report token usage and cost per session, per project, or across all sessions')
        .option('-d, --dir <dir>', 'Project directory (default: cwd)')
        .option('--session <id>', 'Explicit session id to report on')
        .option('--total', 'Aggregate across all sessions, all projects')
        .option('--json', 'Output in JSON format')
        .action((options: CostCommandOptions) => {
            try {
                runCostCommand(options, dependencies);
            } catch (error) {
                process.stderr.write(`cost failed: ${error instanceof Error ? error.message : String(error)}\n`);
                process.exit(1);
            }
        });
}

export const costCommand = createCostCommand();
