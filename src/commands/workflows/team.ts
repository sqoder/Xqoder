import * as path from 'node:path';
import { Command } from 'commander';
import { logger } from '@xqoder/shared';
import { TeamManager, type TeamConfig } from '../../application/teams/manager.js';
import { createDefaultChatSessionStore } from '../../infrastructure/storage/index.js';

interface TeamCommandOptions {
    dir: string;
    parallel?: number;
}

export function createTeamCommand(): Command {
    return new Command('team')
        .description('Parallel agent teams: execute complex goals with multiple coordinated agents')
        .addCommand(createTeamRunCommand());
}

function createTeamRunCommand(): Command {
    return new Command('run')
        .description('Run a team workflow for a specific goal')
        .argument('<goal>', 'The goal for the team to achieve')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-p, --parallel <number>', 'Maximum parallel agents', (val) => parseInt(val, 10), 2)
        .action(async (goal: string, options: TeamCommandOptions) => {
            try {
                const resolvedDir = path.resolve(options.dir);
                const config: TeamConfig = {
                    members: [
                        { role: 'planner', agentName: 'plan' },
                        { role: 'explorer', agentName: 'explorer' },
                        { role: 'executor', agentName: 'coder' },
                        { role: 'reviewer', agentName: 'reviewer' },
                        { role: 'verifier', agentName: 'verifier' },
                    ],
                    parallelLimit: options.parallel || 2,
                };

                const manager = new TeamManager(config, {
                    createSessionStore: createDefaultChatSessionStore,
                });

                await manager.runTeamWorkflow(goal, resolvedDir);
            } catch (error) {
                logger.error(`team run failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export const teamCommand = createTeamCommand();
