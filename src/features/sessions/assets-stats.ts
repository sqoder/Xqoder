import type { PersistedSessionSummary } from '@xqoder/storage-sqlite';
import type { SessionStatsReport } from './assets-types.js';
import { formatSessionUsageCost, formatSessionUsageSummary } from '../../core/agent/session/session-usage.js';

export function buildSessionStatsReport(
    summaries: PersistedSessionSummary[],
    scope: {
        allProjects: boolean;
        projectRoot?: string;
    },
): SessionStatsReport {
    const sortedByCreatedAt = summaries
        .slice()
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const sortedByUpdatedAt = summaries
        .slice()
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const modelTotals = new Map<string, { count: number; totalTokens: number; cost?: number }>();
    const projectTotals = new Map<string, { count: number; totalTokens: number; cost?: number }>();

    for (const summary of summaries) {
        const modelEntry = modelTotals.get(summary.model) ?? {
            count: 0,
            totalTokens: 0,
        };
        modelEntry.count += 1;
        modelEntry.totalTokens += summary.usage.totalTokens;
        modelEntry.cost = addOptionalUsageValue(modelEntry.cost, summary.usage.cost);
        modelTotals.set(summary.model, modelEntry);

        const projectEntry = projectTotals.get(summary.projectRoot) ?? {
            count: 0,
            totalTokens: 0,
        };
        projectEntry.count += 1;
        projectEntry.totalTokens += summary.usage.totalTokens;
        projectEntry.cost = addOptionalUsageValue(projectEntry.cost, summary.usage.cost);
        projectTotals.set(summary.projectRoot, projectEntry);
    }

    return {
        scope,
        sessionCount: summaries.length,
        messageCount: summaries.reduce((total, summary) => total + summary.messageCount, 0),
        usage: {
            promptTokens: summaries.reduce((total, summary) => total + summary.usage.promptTokens, 0),
            completionTokens: summaries.reduce((total, summary) => total + summary.usage.completionTokens, 0),
            totalTokens: summaries.reduce((total, summary) => total + summary.usage.totalTokens, 0),
            ...aggregateOptionalUsageSummary(summaries),
        },
        commandCount: summaries.reduce((total, summary) => total + summary.commandCount, 0),
        fileChangeCount: summaries.reduce((total, summary) => total + summary.fileChangeCount, 0),
        compactionCount: summaries.reduce((total, summary) => total + summary.compactionCount, 0),
        topModels: Array.from(modelTotals.entries())
            .map(([model, stats]) => ({
                model,
                count: stats.count,
                totalTokens: stats.totalTokens,
                ...(stats.cost !== undefined ? { cost: stats.cost } : {}),
            }))
            .sort(compareStatsRowsDescending),
        topProjects: Array.from(projectTotals.entries())
            .map(([projectRoot, stats]) => ({
                projectRoot,
                count: stats.count,
                totalTokens: stats.totalTokens,
                ...(stats.cost !== undefined ? { cost: stats.cost } : {}),
            }))
            .sort(compareStatsRowsDescending),
        ...(sortedByCreatedAt[0]
            ? { oldestCreatedAt: sortedByCreatedAt[0].createdAt.toISOString() }
            : {}),
        ...(sortedByUpdatedAt[0]
            ? { newestUpdatedAt: sortedByUpdatedAt[0].updatedAt.toISOString() }
            : {}),
    };
}

export function formatSessionStatsReport(report: SessionStatsReport): string {
    return [
        `Scope: ${report.scope.allProjects ? 'all-projects' : report.scope.projectRoot ?? '.'}`,
        `Sessions: ${report.sessionCount}`,
        `Messages: ${report.messageCount}`,
        `Usage: ${formatSessionUsageSummary(report.usage)}`,
        `Commands: ${report.commandCount}`,
        `File Changes: ${report.fileChangeCount}`,
        `Compactions: ${report.compactionCount}`,
        report.oldestCreatedAt ? `Oldest: ${report.oldestCreatedAt}` : undefined,
        report.newestUpdatedAt ? `Newest: ${report.newestUpdatedAt}` : undefined,
        '',
        'Top Models:',
        ...(report.topModels.length > 0
            ? report.topModels.slice(0, 5).map((entry) => [
                `- ${entry.model}`,
                `sessions=${entry.count}`,
                `tokens=${entry.totalTokens}`,
                ...(entry.cost !== undefined ? [`cost=${formatSessionUsageCost(entry.cost)}`] : []),
            ].join('  '))
            : ['- None']),
        '',
        'Top Projects:',
        ...(report.topProjects.length > 0
            ? report.topProjects.slice(0, 5).map((entry) => [
                `- ${entry.projectRoot}`,
                `sessions=${entry.count}`,
                `tokens=${entry.totalTokens}`,
                ...(entry.cost !== undefined ? [`cost=${formatSessionUsageCost(entry.cost)}`] : []),
            ].join('  '))
            : ['- None']),
    ].filter((line): line is string => line !== undefined).join('\n');
}

function compareStatsRowsDescending(
    left: { count: number; totalTokens: number; cost?: number },
    right: { count: number; totalTokens: number; cost?: number },
): number {
    const countDiff = right.count - left.count;
    if (countDiff !== 0) {
        return countDiff;
    }

    return right.totalTokens - left.totalTokens;
}

function aggregateOptionalUsageSummary(summaries: PersistedSessionSummary[]): {
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    cost?: number;
} {
    const cacheReadTokens = summaries.reduce<number | undefined>(
        (total, summary) => addOptionalUsageValue(total, summary.usage.cacheReadTokens),
        undefined,
    );
    const cacheCreationTokens = summaries.reduce<number | undefined>(
        (total, summary) => addOptionalUsageValue(total, summary.usage.cacheCreationTokens),
        undefined,
    );
    const cost = summaries.reduce<number | undefined>(
        (total, summary) => addOptionalUsageValue(total, summary.usage.cost),
        undefined,
    );

    return {
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
        ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
        ...(cost !== undefined ? { cost } : {}),
    };
}

function addOptionalUsageValue(current: number | undefined, incoming: number | undefined): number | undefined {
    if (typeof incoming !== 'number' || !Number.isFinite(incoming)) {
        return current;
    }

    return (current ?? 0) + incoming;
}
