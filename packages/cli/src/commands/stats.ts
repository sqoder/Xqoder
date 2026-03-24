import * as path from 'node:path';
import { Command } from 'commander';
import {
    logger,
} from '@xqoder/shared';
import {
    buildSessionStatsReport,
    formatSessionStatsReport,
    type SessionStatsReport,
} from '../session-assets.js';
import { openDefaultRuntimeSessionKernel } from '../services/runtime-session-kernel.js';
import {
    readProjectBenchmarkInsights,
    renderBenchmarkPrSummary,
} from '../services/benchmark-insights.js';
import {
    createRuntimeSessionResolveStoreAdapter,
    listResolvedSessionSummaries,
    loadRuntimeSessionSnapshotRecord,
    type SessionResolveStore,
} from '../services/session-resolve.js';
import {
    createFileWorkflowHistoryStore,
    summarizeWorkflowHistory,
    type WorkflowHistoryStore,
} from '../services/workflow-history.js';

interface StatsCommandDependencies {
    sessionStore?: SessionResolveStore;
    workflowHistoryStore?: WorkflowHistoryStore;
    now?: Date;
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
    /** 项目级记忆查询 */
    search?: string;
    /** 最近 N 条修复记录 */
    fixes?: string;
    /** 最近 N 条 workflow 运行记录 */
    workflows?: string;
    /** benchmark 趋势 */
    benchmarks?: boolean;
    /** 生成 PR 可读摘要 */
    prSummary?: boolean;
}

interface ToolUsageRow {
    name: string;
    count: number;
    successCount: number;
    failureCount: number;
}

function parsePositiveIntegerOption(value: string | undefined, flagName: string): number | undefined {
    if (value === undefined) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${flagName} 必须是正整数`);
    }

    return parsed;
}

function readToolUsageRows(record: { metadata?: Record<string, unknown> }): ToolUsageRow[] {
    const toolHistory = Array.isArray(record.metadata?.['toolHistory'])
        ? record.metadata['toolHistory']
        : [];
    const totals = new Map<string, ToolUsageRow>();

    for (const entry of toolHistory) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }

        const toolName = typeof (entry as Record<string, unknown>)['name'] === 'string'
            ? (entry as Record<string, unknown>)['name'] as string
            : undefined;
        if (!toolName?.trim()) {
            continue;
        }

        const row = totals.get(toolName) ?? {
            name: toolName,
            count: 0,
            successCount: 0,
            failureCount: 0,
        };
        row.count += 1;
        if ((entry as Record<string, unknown>)['success'] === true) {
            row.successCount += 1;
        } else {
            row.failureCount += 1;
        }
        totals.set(toolName, row);
    }

    return [...totals.values()];
}

function compareToolUsageRowsDescending(left: ToolUsageRow, right: ToolUsageRow): number {
    const countDiff = right.count - left.count;
    if (countDiff !== 0) {
        return countDiff;
    }

    const successDiff = right.successCount - left.successCount;
    if (successDiff !== 0) {
        return successDiff;
    }

    return left.name.localeCompare(right.name);
}

async function collectTopTools(
    sessionStore: SessionResolveStore,
    sessionIds: string[],
): Promise<ToolUsageRow[]> {
    const runtimeStore = createRuntimeSessionResolveStoreAdapter(sessionStore);
    const totals = new Map<string, ToolUsageRow>();

    for (const sessionId of sessionIds) {
        const record = await loadRuntimeSessionSnapshotRecord(runtimeStore, sessionId);
        if (!record) {
            continue;
        }

        for (const row of readToolUsageRows(record as { metadata?: Record<string, unknown> })) {
            const aggregate = totals.get(row.name) ?? {
                name: row.name,
                count: 0,
                successCount: 0,
                failureCount: 0,
            };
            aggregate.count += row.count;
            aggregate.successCount += row.successCount;
            aggregate.failureCount += row.failureCount;
            totals.set(row.name, aggregate);
        }
    }

    return [...totals.values()].sort(compareToolUsageRowsDescending);
}

function matchesSessionSummaryQuery(
    summary: {
        id: string;
        title: string;
        projectRoot: string;
        model: string;
        lastUserMessage?: string;
    },
    query: string,
): boolean {
    return [
        summary.id,
        summary.title,
        summary.projectRoot,
        summary.model,
        summary.lastUserMessage ?? '',
    ].some((value) => value.toLowerCase().includes(query));
}

function matchesRuntimeRecordQuery(
    record: {
        metadata?: Record<string, unknown>;
        messages?: Array<{ content?: string }>;
    },
    query: string,
): boolean {
    const metadataText = JSON.stringify(record.metadata ?? {});
    const messageText = JSON.stringify((record.messages ?? []).slice(-8).map((message) => message.content ?? ''));
    return `${metadataText}\n${messageText}`.toLowerCase().includes(query);
}

async function filterSessionSummariesBySearch(
    sessionStore: SessionResolveStore,
    summaries: Awaited<ReturnType<typeof listResolvedSessionSummaries>>,
    query: string,
): Promise<Awaited<ReturnType<typeof listResolvedSessionSummaries>>> {
    const runtimeStore = createRuntimeSessionResolveStoreAdapter(sessionStore);
    const matched = [];

    for (const summary of summaries) {
        if (matchesSessionSummaryQuery(summary, query)) {
            matched.push(summary);
            continue;
        }

        const record = await loadRuntimeSessionSnapshotRecord(runtimeStore, summary.id);
        if (record && matchesRuntimeRecordQuery(record as { metadata?: Record<string, unknown>; messages?: Array<{ content?: string }> }, query)) {
            matched.push(summary);
        }
    }

    return matched;
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
        .option('--search <query>', '搜索 session 标题、最近消息与历史元数据')
        .option('--fixes <n>', '显示最近 N 条修复记录')
        .option('--workflows <n>', '显示最近 N 条 workflow 运行记录')
        .option('--benchmarks', '显示 docs/benchmarks 与 docs/evals 的趋势概览')
        .option('--pr-summary', '输出 benchmark/workflow 的 PR 摘要 Markdown')
        .action(async (options: StatsCommandOptions) => {
            try {
                await runStatsCommand(options, dependencies);
            } catch (error) {
                logger.error(`stats 失败: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}

export async function runStatsCommand(
    options: StatsCommandOptions,
    dependencies: StatsCommandDependencies = {},
): Promise<SessionStatsReport> {
    const resolvedDir = path.resolve(options.dir);
    const modelLimit = parsePositiveIntegerOption(options.models, '--models');
    const toolLimit = parsePositiveIntegerOption(options.tools, '--tools');
    const workflowLimit = parsePositiveIntegerOption(options.workflows, '--workflows');
    const fixLimit = parsePositiveIntegerOption(options.fixes, '--fixes');
    const searchQuery = options.search?.trim().toLowerCase();
    const projectFilter = options.project === undefined
        ? (options.all ? undefined : resolvedDir)
        : (options.project === '' ? resolvedDir : path.resolve(options.project));

    const kernelHandle = dependencies.sessionStore
        ? null
        : openDefaultRuntimeSessionKernel({
            projectRoot: resolvedDir,
            model: 'unknown',
        });

    try {
        const sessionStore = dependencies.sessionStore ?? kernelHandle!.kernel;
        let workflowHistorySummary: SessionStatsReport['workflowHistory'] | undefined;
        let summaries = await listResolvedSessionSummaries(sessionStore, projectFilter, 100000);
        if (options.days) {
            const days = parseInt(options.days, 10);
            if (Number.isFinite(days) && days > 0) {
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - days);
                summaries = summaries.filter(s => s.updatedAt >= cutoff);
            }
        }
        if (searchQuery) {
            summaries = await filterSessionSummariesBySearch(sessionStore, summaries, searchQuery);
        }
        let report: SessionStatsReport = buildSessionStatsReport(summaries, {
            allProjects: Boolean(options.all),
            ...(options.all ? {} : { projectRoot: projectFilter as string }),
        });
        if (searchQuery) {
            report = {
                ...report,
                matchingSessions: summaries.slice(0, 20).map((summary) => ({
                    id: summary.id,
                    title: summary.title,
                    projectRoot: summary.projectRoot,
                    model: summary.model,
                    updatedAt: summary.updatedAt.toISOString(),
                    messageCount: summary.messageCount,
                    ...(summary.lastUserMessage ? { lastUserMessage: summary.lastUserMessage } : {}),
                })),
            };
        }
        if (modelLimit !== undefined) {
            report = {
                ...report,
                topModels: report.topModels.slice(0, modelLimit),
            };
        }
        if (toolLimit !== undefined) {
            report = {
                ...report,
                topTools: (await collectTopTools(sessionStore, summaries.map((summary) => summary.id))).slice(0, toolLimit),
            };
        }
        if (workflowLimit !== undefined || fixLimit !== undefined || options.prSummary) {
            const workflowHistoryStore = dependencies.workflowHistoryStore ?? createFileWorkflowHistoryStore();
            const allWorkflowRuns = workflowHistoryStore.list({
                ...(projectFilter ? { projectRoot: projectFilter } : {}),
                ...(searchQuery ? { query: searchQuery } : {}),
            });
            const recentWorkflowRuns = workflowHistoryStore.list({
                ...(projectFilter ? { projectRoot: projectFilter } : {}),
                ...(searchQuery ? { query: searchQuery } : {}),
                limit: workflowLimit ?? 10,
            });
            workflowHistorySummary = summarizeWorkflowHistory(
                recentWorkflowRuns,
                allWorkflowRuns,
                dependencies.now,
            );
            if (workflowLimit !== undefined) {
                report = {
                    ...report,
                    workflowHistory: workflowHistorySummary,
                };
            }
            if (fixLimit !== undefined) {
                report = {
                    ...report,
                    recentFixes: workflowHistoryStore.list({
                        ...(projectFilter ? { projectRoot: projectFilter } : {}),
                        flow: 'fix',
                        ...(searchQuery ? { query: searchQuery } : {}),
                        limit: fixLimit,
                    }),
                };
            }
        }
        if (options.benchmarks || options.prSummary) {
            const insights = readProjectBenchmarkInsights(resolvedDir);
            report = {
                ...report,
                benchmarkTrends: insights.reports,
                ...(options.prSummary
                    ? {
                        prSummaryMarkdown: renderBenchmarkPrSummary(insights, {
                            projectLabel: path.basename(resolvedDir),
                            workflowHistory: workflowHistorySummary,
                        }),
                    }
                    : {}),
            };
        }

        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
            return report;
        }

        if (options.prSummary && report.prSummaryMarkdown) {
            console.log(report.prSummaryMarkdown);
            return report;
        }

        const hasExtendedSections = Boolean(
            report.matchingSessions
            || report.workflowHistory
            || report.recentFixes
            || report.benchmarkTrends,
        );

        if (report.sessionCount === 0 && !hasExtendedSections) {
            logger.info(options.all
                ? '还没有任何持久化 session。'
                : `项目 ${resolvedDir} 还没有持久化 session。`);
            return report;
        }

        console.log(formatSessionStatsReport(report));
        return report;
    } finally {
        kernelHandle?.close();
    }
}

export const statsCommand = createStatsCommand();
