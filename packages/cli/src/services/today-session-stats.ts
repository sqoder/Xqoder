import {
    SQLiteSessionStore,
    type ClosableSessionStore,
    type PersistedSessionSummary,
    type SessionReadStore,
} from '@xqoder/agent';
import { CostCalculator, getXQoderPaths } from '@xqoder/shared';

export interface TodaySessionStats {
    usd: number;
    messages: number;
}

type TodaySessionStatsCache = {
    dayKey: string;
    usd: number;
    messages: number;
    computedAt: number;
    dirty: boolean;
};

type SessionSummaryStore = Pick<SessionReadStore, 'listSessions'> & Partial<Pick<ClosableSessionStore, 'close'>>;
type SessionSummaryStoreFactory = () => SessionSummaryStore;

const STALE_MS = 10_000;
const COST_CALCULATOR = new CostCalculator();
const TODAY_SESSION_STATS_CACHE: TodaySessionStatsCache = {
    dayKey: '',
    usd: 0,
    messages: 0,
    computedAt: 0,
    dirty: true,
};

let todaySessionStatsStoreFactory: SessionSummaryStoreFactory = () => (
    new SQLiteSessionStore(getXQoderPaths().sessionDbFile)
);

function localDayKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getLocalDayRange(now: Date): { start: Date; end: Date; dayKey: string } {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, dayKey: localDayKey(now) };
}

export function computeTodaySessionStatsFromSummaries(
    summaries: PersistedSessionSummary[],
    now: Date = new Date(),
): TodaySessionStats {
    const { start, end } = getLocalDayRange(now);
    let usd = 0;
    let messages = 0;

    for (const summary of summaries) {
        if (summary.updatedAt < start || summary.updatedAt >= end) {
            continue;
        }
        usd += COST_CALCULATOR.calculate(
            summary.model ?? '',
            summary.usage.promptTokens ?? 0,
            summary.usage.completionTokens ?? 0,
        ).usd;
        messages += summary.messageCount ?? 0;
    }

    return { usd, messages };
}

function loadTodaySessionStats(now: Date = new Date()): TodaySessionStats {
    const store = todaySessionStatsStoreFactory();
    try {
        return computeTodaySessionStatsFromSummaries(store.listSessions(undefined, 5000), now);
    } finally {
        store.close?.();
    }
}

export function getTodaySessionStatsCached(now: Date = new Date()): TodaySessionStats {
    const { dayKey } = getLocalDayRange(now);
    if (TODAY_SESSION_STATS_CACHE.dayKey !== dayKey) {
        TODAY_SESSION_STATS_CACHE.dayKey = dayKey;
        TODAY_SESSION_STATS_CACHE.dirty = true;
    }

    const stale = (Date.now() - TODAY_SESSION_STATS_CACHE.computedAt) > STALE_MS;
    if (!TODAY_SESSION_STATS_CACHE.dirty && !stale) {
        return {
            usd: TODAY_SESSION_STATS_CACHE.usd,
            messages: TODAY_SESSION_STATS_CACHE.messages,
        };
    }

    try {
        const stats = loadTodaySessionStats(now);
        TODAY_SESSION_STATS_CACHE.usd = stats.usd;
        TODAY_SESSION_STATS_CACHE.messages = stats.messages;
    } catch {
        TODAY_SESSION_STATS_CACHE.usd = 0;
        TODAY_SESSION_STATS_CACHE.messages = 0;
    }

    TODAY_SESSION_STATS_CACHE.computedAt = Date.now();
    TODAY_SESSION_STATS_CACHE.dirty = false;
    return {
        usd: TODAY_SESSION_STATS_CACHE.usd,
        messages: TODAY_SESSION_STATS_CACHE.messages,
    };
}

export function markTodaySessionStatsDirty(): void {
    TODAY_SESSION_STATS_CACHE.dirty = true;
}

export function __setTodaySessionStatsStoreFactoryForTest(factory: SessionSummaryStoreFactory): void {
    todaySessionStatsStoreFactory = factory;
    markTodaySessionStatsDirty();
}

export function __resetTodaySessionStatsCacheForTest(): void {
    TODAY_SESSION_STATS_CACHE.dayKey = '';
    TODAY_SESSION_STATS_CACHE.usd = 0;
    TODAY_SESSION_STATS_CACHE.messages = 0;
    TODAY_SESSION_STATS_CACHE.computedAt = 0;
    TODAY_SESSION_STATS_CACHE.dirty = true;
    todaySessionStatsStoreFactory = () => new SQLiteSessionStore(getXQoderPaths().sessionDbFile);
}
