// P15b — `xqoder cost` application service.
//
// Reads session usage from the SQLite session store (or an injected fake)
// and produces a cost report for the current session, an explicit session id,
// or a cross-session total. Uses the existing AgentSessionUsage shape —
// NormalizedUsage is not threaded through the store yet; P15c handles that.
//
// Design note: this file lives in src/application/integrations/ to keep
// @xqoder/storage-sqlite imports out of the strict-lint scope, same split
// pattern P13c + P14c used.

import * as path from 'node:path';
import { getXQoderPaths } from '@xqoder/shared';
import {
    SQLiteSessionStore,
    type AgentSessionStore,
    type PersistedSessionSummary,
} from '@xqoder/storage-sqlite';
import { calculateCost, formatCost, formatTokens } from '@xqoder/shared';
import {
    CacheStatsTracker,
    formatCacheHitRate,
    mergeCacheStatsSummaries,
    type CacheStatsSummary,
} from '../../shared/telemetry/cache-stats.js';
import type { NormalizedUsage } from '../../shared/telemetry/normalized-usage.js';

export interface CostCommandDependencies {
    sessionStore?: Pick<AgentSessionStore, 'listSessions' | 'getSessionSummary'>;
    now?: () => Date;
    writeOutput?: (output: string) => void;
}

export interface CostCommandOptions {
    /** Project directory; defaults to cwd when --total is not set. */
    dir?: string;
    /** Explicit session id to report on. */
    session?: string;
    /** Aggregate across all sessions, all projects. */
    total?: boolean;
    /** Output as JSON. */
    json?: boolean;
}

export interface SessionCostRow {
    readonly sessionId: string;
    readonly projectRoot: string;
    readonly model: string;
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreate: number;
    readonly totalTokens: number;
    readonly costUsd: number;
    readonly durationMs: number;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface CostReport {
    readonly scope: 'session' | 'project' | 'total';
    readonly sessions: readonly SessionCostRow[];
    readonly aggregate: {
        readonly sessions: number;
        readonly input: number;
        readonly output: number;
        readonly cacheRead: number;
        readonly cacheCreate: number;
        readonly totalTokens: number;
        readonly costUsd: number;
        readonly durationMs: number;
    };
    readonly cacheStats: CacheStatsSummary;
}

function resolveSessionStore(
    dependencies: CostCommandDependencies,
): Pick<AgentSessionStore, 'listSessions' | 'getSessionSummary'> {
    return dependencies.sessionStore ?? new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}

function summaryToCostRow(summary: PersistedSessionSummary): SessionCostRow {
    const usage = summary.usage;
    const cacheRead = usage.cacheReadTokens ?? 0;
    const cacheCreate = usage.cacheCreationTokens ?? 0;
    const regularInput = Math.max(usage.promptTokens - cacheRead, 0);
    const recordedCost = usage.cost;
    const computedCost = calculateCost(summary.model, {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
        ...(cacheCreate > 0 ? { cacheCreationTokens: cacheCreate } : {}),
    });
    const costUsd = typeof recordedCost === 'number' && Number.isFinite(recordedCost) && recordedCost > 0
        ? recordedCost
        : computedCost;
    const durationMs = Math.max(summary.updatedAt.getTime() - summary.createdAt.getTime(), 0);

    return {
        sessionId: summary.id,
        projectRoot: summary.projectRoot,
        model: summary.model,
        input: regularInput,
        output: usage.completionTokens,
        cacheRead,
        cacheCreate,
        totalTokens: usage.totalTokens,
        costUsd,
        durationMs,
        createdAt: summary.createdAt.toISOString(),
        updatedAt: summary.updatedAt.toISOString(),
    };
}

function accumulate(rows: readonly SessionCostRow[]): CostReport['aggregate'] {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheCreate = 0;
    let totalTokens = 0;
    let costUsd = 0;
    let durationMs = 0;
    for (const row of rows) {
        input += row.input;
        output += row.output;
        cacheRead += row.cacheRead;
        cacheCreate += row.cacheCreate;
        totalTokens += row.totalTokens;
        costUsd += row.costUsd;
        durationMs += row.durationMs;
    }
    return {
        sessions: rows.length,
        input,
        output,
        cacheRead,
        cacheCreate,
        totalTokens,
        costUsd,
        durationMs,
    };
}

function rowToNormalizedUsage(row: SessionCostRow): NormalizedUsage {
    return {
        provider: 'session',
        model: row.model,
        input: row.input,
        output: row.output,
        ...(row.cacheRead > 0 ? { cacheRead: row.cacheRead } : {}),
        ...(row.cacheCreate > 0 ? { cacheCreate: row.cacheCreate } : {}),
        costUsd: row.costUsd,
    };
}

function computeCacheStats(rows: readonly SessionCostRow[]): CacheStatsSummary {
    const tracker = new CacheStatsTracker();
    for (const row of rows) {
        tracker.record(rowToNormalizedUsage(row));
    }
    return tracker.summary();
}

export function runCostCommand(
    options: CostCommandOptions = {},
    dependencies: CostCommandDependencies = {},
): CostReport {
    const store = resolveSessionStore(dependencies);

    let rows: SessionCostRow[] = [];
    let scope: CostReport['scope'] = 'project';

    if (options.session) {
        const summary = store.getSessionSummary(options.session);
        if (!summary) {
            throw new Error(`session not found: ${options.session}`);
        }
        rows = [summaryToCostRow(summary)];
        scope = 'session';
    } else if (options.total) {
        rows = store.listSessions(undefined, Number.MAX_SAFE_INTEGER).map(summaryToCostRow);
        scope = 'total';
    } else {
        const projectRoot = path.resolve(options.dir ?? process.cwd());
        rows = store.listSessions(projectRoot, Number.MAX_SAFE_INTEGER).map(summaryToCostRow);
        scope = 'project';
    }

    const report: CostReport = {
        scope,
        sessions: rows,
        aggregate: accumulate(rows),
        cacheStats: mergeCacheStatsSummaries(computeCacheStats(rows)),
    };

    renderReport(report, options, dependencies);
    return report;
}

function renderReport(
    report: CostReport,
    options: CostCommandOptions,
    dependencies: CostCommandDependencies,
): void {
    const write = dependencies.writeOutput ?? ((line) => process.stdout.write(`${line}\n`));
    if (options.json) {
        write(JSON.stringify(report, null, 2));
        return;
    }

    if (report.sessions.length === 0) {
        write('no sessions in scope');
        return;
    }

    const header = report.scope === 'session'
        ? 'cost (session)'
        : report.scope === 'total'
            ? 'cost (all sessions)'
            : 'cost (project sessions)';
    write(header);
    for (const row of report.sessions) {
        write([
            `  ${row.sessionId}`,
            `model=${row.model}`,
            `in=${formatTokens(row.input)}`,
            `out=${formatTokens(row.output)}`,
            ...(row.cacheRead > 0 ? [`cache_read=${formatTokens(row.cacheRead)}`] : []),
            ...(row.cacheCreate > 0 ? [`cache_create=${formatTokens(row.cacheCreate)}`] : []),
            `cost=${formatCost(row.costUsd)}`,
            `dur=${formatDurationMs(row.durationMs)}`,
        ].join(' '));
    }
    write([
        'total',
        `sessions=${report.aggregate.sessions}`,
        `in=${formatTokens(report.aggregate.input)}`,
        `out=${formatTokens(report.aggregate.output)}`,
        ...(report.aggregate.cacheRead > 0 ? [`cache_read=${formatTokens(report.aggregate.cacheRead)}`] : []),
        ...(report.aggregate.cacheCreate > 0 ? [`cache_create=${formatTokens(report.aggregate.cacheCreate)}`] : []),
        `cache_hit_rate=${formatCacheHitRate(report.cacheStats.hitRate)}`,
        `cost=${formatCost(report.aggregate.costUsd)}`,
    ].join(' '));
}

function formatDurationMs(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0s';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}m${remaining.toString().padStart(2, '0')}s`;
}
