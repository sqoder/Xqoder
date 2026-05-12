import { beforeEach, describe, expect, it } from 'bun:test';
import {
    CacheStatsTracker,
    formatCacheHitRate,
    mergeCacheStatsSummaries,
} from '../../../src/shared/telemetry/cache-stats.js';
import type { NormalizedUsage } from '../../../src/shared/telemetry/normalized-usage.js';

function usage(partial: Partial<NormalizedUsage> & { input: number; output: number }): NormalizedUsage {
    return {
        provider: partial.provider ?? 'openai',
        model: partial.model ?? 'gpt-4o',
        input: partial.input,
        output: partial.output,
        ...(partial.cacheRead !== undefined ? { cacheRead: partial.cacheRead } : {}),
        ...(partial.cacheCreate !== undefined ? { cacheCreate: partial.cacheCreate } : {}),
    };
}

describe('CacheStatsTracker (P15b)', () => {
    let tracker: CacheStatsTracker;

    beforeEach(() => {
        tracker = new CacheStatsTracker();
    });

    it('starts at zero and reports 0 hitRate', () => {
        const summary = tracker.summary();
        expect(summary).toEqual({ hit: 0, miss: 0, create: 0, hitRate: 0 });
    });

    it('accumulates cache_read into hit and input into miss', () => {
        tracker.record(usage({ input: 300, output: 20, cacheRead: 700 }));
        const summary = tracker.summary();
        expect(summary.hit).toBe(700);
        expect(summary.miss).toBe(300);
        expect(summary.hitRate).toBeCloseTo(0.7, 5);
    });

    it('tracks create separately from hit', () => {
        tracker.record(usage({ input: 100, output: 10, cacheCreate: 500 }));
        const summary = tracker.summary();
        expect(summary.create).toBe(500);
        expect(summary.hit).toBe(0);
        expect(summary.miss).toBe(100);
    });

    it('accumulates across multiple records', () => {
        tracker.record(usage({ input: 50, output: 5, cacheRead: 150 }));
        tracker.record(usage({ input: 50, output: 5, cacheRead: 50 }));
        const summary = tracker.summary();
        expect(summary.hit).toBe(200);
        expect(summary.miss).toBe(100);
        expect(summary.hitRate).toBeCloseTo(200 / 300, 5);
    });

    it('reset() clears everything', () => {
        tracker.record(usage({ input: 100, output: 10, cacheRead: 100 }));
        tracker.reset();
        expect(tracker.summary()).toEqual({ hit: 0, miss: 0, create: 0, hitRate: 0 });
    });
});

describe('mergeCacheStatsSummaries (P15b)', () => {
    it('sums buckets and recomputes hitRate', () => {
        const a = { hit: 100, miss: 300, create: 50, hitRate: 0.25 };
        const b = { hit: 300, miss: 100, create: 10, hitRate: 0.75 };
        const merged = mergeCacheStatsSummaries(a, b);
        expect(merged.hit).toBe(400);
        expect(merged.miss).toBe(400);
        expect(merged.create).toBe(60);
        expect(merged.hitRate).toBeCloseTo(0.5, 5);
    });

    it('returns 0 hitRate when merged totals are zero', () => {
        const merged = mergeCacheStatsSummaries({ hit: 0, miss: 0, create: 0, hitRate: 0 });
        expect(merged.hitRate).toBe(0);
    });
});

describe('formatCacheHitRate (P15b)', () => {
    it('formats a percentage with one decimal', () => {
        expect(formatCacheHitRate(0.7512)).toBe('75.1%');
        expect(formatCacheHitRate(0)).toBe('0.0%');
        expect(formatCacheHitRate(1)).toBe('100.0%');
    });

    it('returns n/a for non-finite values', () => {
        expect(formatCacheHitRate(Number.NaN)).toBe('n/a');
        expect(formatCacheHitRate(Number.POSITIVE_INFINITY)).toBe('n/a');
    });
});
