// P15b telemetry barrel.
export {
    CacheStatsTracker,
    formatCacheHitRate,
    mergeCacheStatsSummaries,
    type CacheStatsSummary,
} from './cache-stats.js';
export type { NormalizedUsage } from './normalized-usage.js';
export {
    buildNormalizedUsageFromProviderUsage,
    type ProviderUsageLike,
} from './build-usage.js';
export {
    __resetTelemetrySinkForTests,
    createDatadogSinkStub,
    createInMemorySink,
    createNoopSink,
    emitTelemetry,
    getTelemetrySink,
    setTelemetrySink,
    type HookLifecycleName,
    type TelemetryEvent,
    type TelemetrySink,
} from './sink.js';
