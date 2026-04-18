import * as path from 'node:path';
import { Command } from 'commander';
import {
    getXQoderPaths,
    logger,
} from '@xqoder/shared';
import {
    SQLiteSessionStore,
    type AgentSessionStore,
} from '@xqoder/storage-sqlite';
import {
    buildSessionStatsReport,
    formatSessionStatsReport,
    type SessionStatsReport,
} from '../../features/sessions/assets.js';

interface StatsCommandDependencies {
    sessionStore?: Pick<AgentSessionStore, 'listSessions'>;
}

interface StatsCommandOptions {
    dir: string;
    all?: boolean;
    json?: boolean;
    /** XQoder --days: last N days */
    days?: string;
    /** XQoder --tools: show top N tools */
    tools?: string;
    /** XQoder --models: show model usage, pass a number for top N */
    models?: string;
    /** XQoder --project: filter by project, empty string = current project */
    project?: string;
}

export function createStatsCommand(
    dependencies: StatsCommandDependencies = {},
): Command {
    return new Command('stats')
        .description('Summarize session usage for the current project or globally (XQoder style)')
        .option('-d, --dir <dir>', 'Project directory', '.')
        .option('-a, --all', 'Stat sessions across all projects')
        .option('--json', 'Output in JSON format')
        .option('--days <n>', 'Statistics for the last N days')
        .option('--tools <n>', 'Show top N tools')
        .option('--models <n>', 'Show model usage; pass a number for top N')
        .option('--project <path>', 'Filter by project')
        .action((options: StatsCommandOptions) => {
            try {
                runStatsCommand(options, dependencies);
            } catch (error) {
                logger.error(`stats failed: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export function runStatsCommand(
    options: StatsCommandOptions,
    dependencies: StatsCommandDependencies = {},
): SessionStatsReport {
    const sessionStore = dependencies.sessionStore ?? createDefaultSessionStore();
    const resolvedDir = path.resolve(options.dir);
    const projectFilter = options.project === undefined
        ? (options.all ? undefined : resolvedDir)
        : (options.project === '' ? resolvedDir : path.resolve(options.project));
    let summaries = sessionStore.listSessions(projectFilter, 100000);
    if (options.days) {
        const days = parseInt(options.days, 10);
        if (Number.isFinite(days) && days > 0) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            summaries = summaries.filter(s => s.updatedAt >= cutoff);
        }
    }
    const report = buildSessionStatsReport(summaries, {
        allProjects: Boolean(options.all),
        ...(options.all ? {} : { projectRoot: projectFilter as string }),
    });

    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return report;
    }

    if (report.sessionCount === 0) {
        logger.info(options.all
            ? 'No persisted sessions found.'
            : `No persisted sessions found for project ${resolvedDir}.`);
        return report;
    }

    console.log(formatSessionStatsReport(report));
    return report;
}

export const statsCommand = createStatsCommand();

function createDefaultSessionStore(): AgentSessionStore {
    return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}
