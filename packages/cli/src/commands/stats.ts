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
} from '../session-assets.js';

interface StatsCommandDependencies {
    sessionStore?: Pick<AgentSessionStore, 'listSessions'>;
}

interface StatsCommandOptions {
    dir: string;
    all?: boolean;
    json?: boolean;
    /** OpenCode --days: 最近 N 天 */
    days?: string;
    /** OpenCode --tools: 显示 top N 工具 */
    tools?: string;
    /** OpenCode --models: 显示模型用量，传数字为 top N */
    models?: string;
    /** OpenCode --project: 按项目过滤，空字符串=当前项目 */
    project?: string;
}

export function createStatsCommand(
    dependencies: StatsCommandDependencies = {},
): Command {
    return new Command('stats')
        .description('汇总当前项目或全局的 session 使用情况（OpenCode 风格）')
        .option('-d, --dir <dir>', '项目目录', '.')
        .option('-a, --all', '统计全部项目')
        .option('--json', '以 JSON 格式输出')
        .option('--days <n>', '最近 N 天的统计')
        .option('--tools <n>', '显示 top N 工具')
        .option('--models <n>', '显示模型用量，传数字为 top N')
        .option('--project <path>', '按项目过滤')
        .action((options: StatsCommandOptions) => {
            try {
                runStatsCommand(options, dependencies);
            } catch (error) {
                logger.error(`stats 失败: ${error instanceof Error ? error.message : String(error)}`);
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
            ? '还没有任何持久化 session。'
            : `项目 ${resolvedDir} 还没有持久化 session。`);
        return report;
    }

    console.log(formatSessionStatsReport(report));
    return report;
}

export const statsCommand = createStatsCommand();

function createDefaultSessionStore(): AgentSessionStore {
    return new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}
