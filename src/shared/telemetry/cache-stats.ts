// P15b — CacheStatsTracker: accumulates cache hit/miss/create counts across a
// session so `xqoder cost` and debug surfaces can report the true cache hit
// rate. Not wired into the turn loop yet (P15c); accepts NormalizedUsage now.

import type { NormalizedUsage } from './normalized-usage.js';

export interface CacheStatsSummary {
    readonly hit: number;
    readonly miss: number;
    readonly create: number;
    /** 0..1; 0 when no input tokens have been recorded. */
    readonly hitRate: number;
}

export class CacheStatsTracker {
    private hit = 0;
    private miss = 0;
    private create = 0;

    record(usage: NormalizedUsage): void {
        const cacheRead = usage.cacheRead ?? 0;
        const cacheCreate = usage.cacheCreate ?? 0;
        this.hit += cacheRead;
        this.create += cacheCreate;
        // usage.input is the regular (non-cache) bucket — that's the "miss".
        this.miss += usage.input;
    }

    summary(): CacheStatsSummary {
        const total = this.hit + this.miss;
        const hitRate = total > 0 ? this.hit / total : 0;
        return {
            hit: this.hit,
            miss: this.miss,
            create: this.create,
            hitRate,
        };
    }

    reset(): void {
        this.hit = 0;
        this.miss = 0;
        this.create = 0;
    }
}

/**
 * Combine two summaries (e.g. session + historical totals) without mutating
 * either tracker.
 */
export function mergeCacheStatsSummaries(
    ...summaries: readonly CacheStatsSummary[]
): CacheStatsSummary {
    let hit = 0;
    let miss = 0;
    let create = 0;
    for (const summary of summaries) {
        hit += summary.hit;
        miss += summary.miss;
        create += summary.create;
    }
    const total = hit + miss;
    return {
        hit,
        miss,
        create,
        hitRate: total > 0 ? hit / total : 0,
    };
}

export function formatCacheHitRate(hitRate: number): string {
    if (!Number.isFinite(hitRate)) return 'n/a';
    return `${(hitRate * 100).toFixed(1)}%`;
}
